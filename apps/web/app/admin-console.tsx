"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ApiError, json, read, request, type Page } from "./api-client";
import {
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  StatCard,
  StatusBadge,
} from "./portal-ui";

type Organization = { id: string; name: string; mspId: string; status: string };
type User = {
  id: string;
  email: string;
  role: string;
  active: boolean;
  verifiedAt: string | null;
  organization: { id: string; name: string };
};
type Event = {
  id: number;
  action: string;
  actor: string | null;
  subject: string | null;
  detail: string | null;
  at: string;
  hash: string;
};
type Overview = {
  organizations: number;
  activeOrganizations: number;
  users: number;
  auditEvents: number;
  registrationOpen: boolean;
};
type Confirm = {
  title: string;
  description: string;
  action: () => Promise<unknown>;
};
type Tab = "organizations" | "users" | "security" | "configuration";

export function AdminConsole({
  token,
  onExpired,
}: {
  token: string;
  onExpired: () => void;
}) {
  const [tab, setTab] = useState<Tab>("organizations");
  const [overview, setOverview] = useState<Overview>();
  const [page, setPage] = useState<Page<Organization | User | Event>>();
  const [offset, setOffset] = useState(0);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>();
  const [editing, setEditing] = useState<User>();
  const [recordInfo, setRecordInfo] = useState<{
    id: string;
    issuer: string;
    createdAt: string;
    mode: string;
    permissions: string[];
  }>();
  useEffect(() => {
    let current = true;
    const selected =
      tab === "configuration"
        ? Promise.resolve(undefined)
        : read<Page<Organization | User | Event>>(
            "/admin/" +
              tab +
              "?" +
              new URLSearchParams({ search, offset: String(offset) }),
            token,
          );
    Promise.all([read<Overview>("/admin/overview", token), selected])
      .then(([metrics, rows]) => {
        if (current) {
          setOverview(metrics);
          setPage(rows);
        }
      })
      .catch((cause: unknown) => {
        if (!current) return;
        if (cause instanceof ApiError && cause.status === 401) onExpired();
        else
          setError(
            cause instanceof Error
              ? cause.message
              : "Administration is unavailable.",
          );
      });
    return () => {
      current = false;
    };
  }, [token, tab, search, offset, revision, onExpired]);

  async function run(operation: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
      setNotice(success);
      setRevision((value) => value + 1);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) onExpired();
      else
        setError(
          cause instanceof Error ? cause.message : "The operation failed.",
        );
    } finally {
      setBusy(false);
      setConfirm(undefined);
    }
  }

  function submit(
    event: FormEvent<HTMLFormElement>,
    path: string,
    message: string,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    void run(async () => {
      await request(path, token, json(fields));
      form.reset();
    }, message);
  }

  function patch(path: string, data: object) {
    return request(path, token, json(data, "PATCH"));
  }

  async function exportPage() {
    const response = await read<unknown>(
      "/admin/export?offset=" + offset,
      token,
    );
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(response, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "mediledger-audit-" + offset + ".json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const labels: Record<Tab, string> = {
    organizations: "Organizations",
    users: "Users and invitations",
    security: "Security events",
    configuration: "System settings",
  };
  const transitions: Record<string, [string, string][]> = {
    PENDING: [
      ["ACTIVE", "Approve"],
      ["REJECTED", "Reject"],
    ],
    ACTIVE: [["INACTIVE", "Deactivate"]],
    INACTIVE: [["ACTIVE", "Activate"]],
    REJECTED: [["PENDING", "Reopen"]],
  };
  return (
    <section aria-label="System administration">
      {overview ? (
        <div className="stat-grid">
          <StatCard label="Organizations" value={overview.organizations} />
          <StatCard
            label="Active organizations"
            value={overview.activeOrganizations}
          />
          <StatCard label="Users" value={overview.users} />
          <StatCard label="Audit events" value={overview.auditEvents} />
        </div>
      ) : (
        !error && <LoadingSkeleton />
      )}
      {error && <ErrorState message={error} />}
      {notice && (
        <p className="message" role="status">
          {notice}
        </p>
      )}
      <fieldset disabled={busy}>
        <nav className="actions" aria-label="Administration sections">
          {(Object.keys(labels) as Tab[]).map((value) => (
            <button
              type="button"
              className={tab === value ? "primary" : "secondary"}
              key={value}
              aria-pressed={tab === value}
              onClick={() => {
                setTab(value);
                setPage(undefined);
                setOffset(0);
                setInput("");
                setSearch("");
                setError("");
                setEditing(undefined);
              }}
            >
              {labels[value]}
            </button>
          ))}
        </nav>
        {tab === "organizations" && (
          <form
            className="card card-body stack"
            onSubmit={(event) =>
              submit(
                event,
                "/admin/organizations",
                "Organization filed for approval.",
              )
            }
          >
            <h2>Register organization</h2>
            <label>
              Registered organization name
              <input name="name" required minLength={2} maxLength={120} />
            </label>
            <label>
              Fabric MSP reference
              <input name="mspId" required pattern="[A-Za-z0-9._-]{2,80}" />
            </label>
            <button className="primary">Register organization</button>
          </form>
        )}
        {tab === "users" && (
          <form
            className="card card-body stack"
            onSubmit={(event) =>
              submit(event, "/admin/invitations", "Invitation email sent.")
            }
          >
            <h2>Invite user</h2>
            <label>
              Email address
              <input name="email" type="email" required />
            </label>
            <label>
              Approved organization reference
              <input name="organizationId" required maxLength={80} />
            </label>
            <RoleSelect />
            <button className="primary">Send invitation</button>
          </form>
        )}
        {tab === "configuration" && overview && (
          <section className="card card-body stack">
            <h2>Public registration</h2>
            <p>
              Patient sign-up is currently{" "}
              {overview.registrationOpen ? "open" : "closed"}.
            </p>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                setConfirm({
                  title: overview.registrationOpen
                    ? "Close patient sign-up?"
                    : "Open patient sign-up?",
                  description:
                    "Existing sessions and invitations are unaffected.",
                  action: () =>
                    patch("/admin/settings", {
                      registrationOpen: !overview.registrationOpen,
                    }),
                })
              }
            >
              {overview.registrationOpen ? "Close sign-up" : "Open sign-up"}
            </button>
          </section>
        )}
        {tab === "security" && (
          <div className="actions">
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void run(async () => {
                  const result = await read<{
                    valid: boolean;
                    checkedThrough: number;
                  }>("/admin/security/integrity", token);
                  if (!result.valid)
                    throw new Error("The journal failed its integrity check.");
                }, "Security journal integrity verified.")
              }
            >
              Verify journal integrity
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void run(exportPage, "Audit page exported.")}
            >
              Export audit page
            </button>
          </div>
        )}
        {tab === "security" && (
          <section className="card card-body">
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                const id = String(
                  new FormData(event.currentTarget).get("reference"),
                );
                setRecordInfo(undefined);
                void run(
                  async () =>
                    setRecordInfo(
                      await read(
                        "/admin/records/" + encodeURIComponent(id),
                        token,
                      ),
                    ),
                  "Record permissions retrieved.",
                );
              }}
            >
              <h2>Inspect record permissions</h2>
              <label>
                Record reference
                <input
                  name="reference"
                  required
                  minLength={36}
                  maxLength={36}
                />
              </label>
              <button className="secondary">Inspect metadata</button>
            </form>
            {recordInfo && (
              <dl className="data-list">
                <dt>Issuer</dt>
                <dd>{recordInfo.issuer}</dd>
                <dt>Registered</dt>
                <dd>{new Date(recordInfo.createdAt).toLocaleString()}</dd>
                <dt>Mode</dt>
                <dd>{recordInfo.mode}</dd>
                <dt>Granted providers</dt>
                <dd>
                  {recordInfo.permissions.length ? (
                    <ul>
                      {recordInfo.permissions.map((entry) => (
                        <li key={entry}>
                          <code>{entry}</code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    "No providers have a grant."
                  )}
                </dd>
              </dl>
            )}
          </section>
        )}
        {tab !== "configuration" && (
          <section className="card">
            <form
              className="card-head search-controls"
              onSubmit={(event) => {
                event.preventDefault();
                setPage(undefined);
                setSearch(input.trim());
                setOffset(0);
                setRevision((value) => value + 1);
              }}
            >
              <label>
                <span className="sr-only">Search {labels[tab]}</span>
                <input
                  type="search"
                  maxLength={120}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={"Search " + labels[tab].toLowerCase()}
                />
              </label>
              <button className="secondary">Search</button>
              <button
                type="button"
                className="secondary"
                onClick={() => setRevision((value) => value + 1)}
              >
                Refresh
              </button>
            </form>
            {!page ? (
              !error && <LoadingSkeleton />
            ) : !page.items.length ? (
              <EmptyState
                title="No records found"
                description="Data will appear here after the first successful operation."
              />
            ) : (
              <ul className="event-list">
                {page.items.map((item) => {
                  if ("mspId" in item)
                    return (
                      <li key={item.id}>
                        <div>
                          <strong>{item.name}</strong>
                          <small>
                            {item.mspId} · <code>{item.id}</code>
                          </small>
                        </div>
                        <div className="actions">
                          <StatusBadge>{item.status}</StatusBadge>
                          {transitions[item.status]?.map(([status, label]) => (
                            <button
                              type="button"
                              className="secondary"
                              key={status}
                              onClick={() =>
                                setConfirm({
                                  title: label + " organization?",
                                  description: item.name,
                                  action: () =>
                                    patch("/admin/organizations/" + item.id, {
                                      status,
                                    }),
                                })
                              }
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </li>
                    );
                  if ("email" in item)
                    return (
                      <li key={item.id}>
                        <div>
                          <strong>{item.email}</strong>
                          <small>
                            {item.organization.name} · {item.role}
                          </small>
                        </div>
                        <div className="actions">
                          <StatusBadge>
                            {item.active
                              ? item.verifiedAt
                                ? "Active"
                                : "Awaiting verification"
                              : "Suspended"}
                          </StatusBadge>
                          {item.role !== "AUDITOR" && (
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => setEditing(item)}
                            >
                              Manage account
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  return (
                    <li key={item.id}>
                      <div>
                        <strong>{item.action.replaceAll("_", " ")}</strong>
                        <small>{new Date(item.at).toLocaleString()}</small>
                        <details>
                          <summary>Event references</summary>
                          <dl className="data-list">
                            <dt>Actor</dt>
                            <dd>{item.actor ?? "Unauthenticated"}</dd>
                            <dt>Subject</dt>
                            <dd>{item.subject ?? "None"}</dd>
                            <dt>Journal hash</dt>
                            <dd>
                              <code>{item.hash}</code>
                            </dd>
                            {item.detail && (
                              <>
                                <dt>Change</dt>
                                <dd>{item.detail}</dd>
                              </>
                            )}
                          </dl>
                        </details>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {page && (offset > 0 || page.next != null) && (
              <div className="card-body actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={!offset}
                  onClick={() => {
                    setPage(undefined);
                    setOffset(offset - 20);
                  }}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={page.next == null}
                  onClick={() => {
                    if (page.next != null) {
                      setPage(undefined);
                      setOffset(page.next);
                    }
                  }}
                >
                  Next
                </button>
              </div>
            )}
          </section>
        )}
      </fieldset>
      {editing && (
        <section className="card card-body">
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const role = String(data.get("role"));
              const organizationId = String(data.get("organizationId")).trim();
              const active = data.get("active") === "on";
              setConfirm({
                title: "Apply account changes?",
                description: "Saving revokes this user's existing sessions.",
                action: async () => {
                  await patch("/admin/users/" + editing.id, {
                    ...(active !== editing.active ? { active } : {}),
                    ...(role !== editing.role ? { role } : {}),
                    ...(organizationId &&
                    organizationId !== editing.organization.id
                      ? { organizationId }
                      : {}),
                  });
                  setEditing(undefined);
                },
              });
            }}
          >
            <h2>Manage {editing.email}</h2>
            <RoleSelect value={editing.role} />
            <label>
              Organization reference
              <input
                name="organizationId"
                defaultValue={editing.organization.id}
                maxLength={80}
              />
            </label>
            <label>
              <span>
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={editing.active}
                />{" "}
                Account enabled
              </span>
            </label>
            <div className="actions">
              <button className="primary">Review changes</button>
              <button
                type="button"
                className="secondary"
                onClick={() => setEditing(undefined)}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
      {confirm && (
        <ConfirmationDialog
          title={confirm.title}
          confirm="Confirm"
          confirmDisabled={busy}
          onCancel={() => setConfirm(undefined)}
          onConfirm={() => void run(confirm.action, "Change saved.")}
        >
          <p>{confirm.description}</p>
        </ConfirmationDialog>
      )}
    </section>
  );
}

function RoleSelect({ value = "PATIENT" }: { value?: string }) {
  return (
    <label>
      Account role
      <select name="role" defaultValue={value}>
        <option value="PATIENT">Patient</option>
        <option value="PROVIDER">Doctor</option>
        <option value="ISSUER">Organization administrator</option>
      </select>
    </label>
  );
}
