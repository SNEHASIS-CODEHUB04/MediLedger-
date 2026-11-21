"use client";

import { useEffect, useState } from "react";
import type {
  RecordSummary,
  SessionProfile,
  WorkspaceMetrics,
  WorkspaceEvent,
  StaffMember,
  VerificationAttempt,
} from "@mediledger/shared";
import {
  ApiError,
  type Health,
  type Page,
  audit,
  attempts,
  staff,
  json,
  request,
  route,
} from "./api-client";
import { RecordTable } from "./record-components";
import {
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  StatCard,
  StatusBadge,
} from "./portal-ui";

export const labels: Record<string, string> = {
  RegisterRecord: "Document registered",
  GrantAccess: "Access granted",
  RevokeAccess: "Access revoked",
  VerifyDocumentHash: "Document verified",
};
export const timestamp = (value: string) => new Date(value).toLocaleString();

function WorkspaceList<T>({
  heading,
  load,
  onExpired,
  revision,
  children,
}: {
  heading: string;
  load: (offset?: number) => Promise<Page<T>>;
  onExpired: () => void;
  revision?: number;
  children: (items: T[]) => React.ReactNode;
}) {
  const [page, setPage] = useState<Page<T>>();
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let current = true;
    load(offset)
      .then((result) => {
        if (current) {
          setPage(result);
          setError("");
        }
      })
      .catch((cause) => {
        if (!current) return;
        if (cause instanceof ApiError && cause.status === 401) onExpired();
        else
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load this workspace.",
          );
      });
    return () => {
      current = false;
    };
  }, [load, offset, revision, refresh, onExpired]);
  function change(next: number) {
    setPage(undefined);
    setError("");
    setOffset(next);
  }
  return (
    <section className="card">
      <div className="card-head">
        <h2>{heading}</h2>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setPage(undefined);
            setError("");
            setRefresh((value) => value + 1);
          }}
        >
          Refresh
        </button>
      </div>
      {error ? (
        <div className="card-body">
          <ErrorState message={error} />
        </div>
      ) : !page ? (
        <LoadingSkeleton />
      ) : page.items.length ? (
        children(page.items)
      ) : (
        <EmptyState title="Nothing to show" />
      )}
      {(offset > 0 || page?.next != null) && (
        <div className="card-body actions">
          <button
            type="button"
            className="secondary"
            disabled={offset === 0}
            onClick={() => change(Math.max(0, offset - 20))}
          >
            Previous
          </button>
          <button
            type="button"
            className="secondary"
            disabled={page?.next == null}
            onClick={() => {
              if (page?.next != null) change(page.next);
            }}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}

import { useCallback } from "react";

export function Overview({
  profile,
  token,
  onExpired,
  revision,
  onOpen,
}: {
  profile: SessionProfile;
  token: string;
  onExpired: () => void;
  revision: number;
  onOpen: (id: string) => void;
}) {
  const [metrics, setMetrics] = useState<WorkspaceMetrics>();
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    route("/workspace/overview", token)
      .then((data) => {
        if (current) {
          setMetrics(data);
          setError("");
        }
      })
      .catch((cause: unknown) => {
        if (!current) return;
        if (cause instanceof ApiError && cause.status === 401) onExpired();
        else
          setError(
            cause instanceof Error ? cause.message : "Metrics are unavailable.",
          );
      });
    return () => {
      current = false;
    };
  }, [token, revision, onExpired]);
  if (error) return <ErrorState message={error} />;
  if (!metrics) return <LoadingSkeleton />;
  return (
    <>
      <div className="stat-grid">
        {profile.role !== "AUDITOR" && (
          <StatCard
            label={
              profile.role === "PROVIDER"
                ? "Authorized reports"
                : "Registered reports"
            }
            value={metrics.records}
          />
        )}
        {profile.role === "PATIENT" ? (
          <StatCard
            label="Active provider grants"
            value={metrics.activeGrants}
          />
        ) : (
          <>
            <StatCard label="Matching verifications" value={metrics.matched} />
            <StatCard
              label="Mismatched verifications"
              value={metrics.mismatched}
            />
          </>
        )}
      </div>
      {profile.role !== "AUDITOR" && (
        <RecentDocuments records={metrics.recent} onOpen={onOpen} />
      )}
    </>
  );
}

function RecentDocuments({
  records,
  onOpen,
}: {
  records: RecordSummary[];
  onOpen: (id: string) => void;
}) {
  return (
    <section className="card recent">
      <div className="card-head">
        <h2>Recent documents</h2>
      </div>
      {records.length ? (
        <RecordTable rows={records} showPatient={false} onOpen={onOpen} />
      ) : (
        <EmptyState title="No recent documents" />
      )}
    </section>
  );
}

export function VerificationHistory({
  token,
  onExpired,
  revision,
}: {
  token: string;
  onExpired: () => void;
  revision: number;
}) {
  const load = useCallback(
    (offset?: number) => attempts(token, offset),
    [token],
  );
  return (
    <WorkspaceList<VerificationAttempt>
      heading="Verification history"
      load={load}
      onExpired={onExpired}
      revision={revision}
    >
      {(rows) => (
        <ul className="event-list">
          {rows.map((row) => (
            <li key={row.id}>
              <div>
                <strong>Verification</strong>
                <small>{timestamp(row.createdAt)}</small>
                <code>{row.recordId}</code>
              </div>
              <StatusBadge tone={row.result === "MATCH" ? "green" : "error"}>
                {row.result}
              </StatusBadge>
            </li>
          ))}
        </ul>
      )}
    </WorkspaceList>
  );
}

export function TransactionDetails({ event }: { event: WorkspaceEvent }) {
  return (
    <details>
      <summary>Event details</summary>
      <dl className="event-detail">
        <dt>Record reference</dt>
        <dd>
          <code>{event.recordId}</code>
        </dd>
        <dt>Actor reference</dt>
        <dd>
          <code>{event.actor}</code>
        </dd>
        {event.mode === "LIVE_FABRIC" && event.txId && (
          <>
            <dt>Fabric transaction</dt>
            <dd>
              <code>{event.txId}</code>
            </dd>
          </>
        )}
        {event.action === "VerifyDocumentHash" && (
          <>
            <dt>Source</dt>
            <dd>API verification</dd>
          </>
        )}
      </dl>
    </details>
  );
}

export function AuditHistory({
  token,
  onExpired,
  revision,
}: {
  token: string;
  onExpired: () => void;
  revision: number;
}) {
  const [filter, setFilter] = useState("");
  const load = useCallback(
    (offset?: number) => audit(token, filter || undefined, offset),
    [token, filter],
  );
  return (
    <>
      <label className="filter-label">
        Event type
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="">All events</option>
          {Object.entries(labels).map(([id, label]) => (
            <option value={id} key={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <WorkspaceList<WorkspaceEvent>
        key={filter}
        heading="Audit history"
        load={load}
        onExpired={onExpired}
        revision={revision}
      >
        {(rows) => (
          <ul className="event-list">
            {rows.map((event, index) => (
              <li key={event.txId ?? event.recordId + event.at + index}>
                <div>
                  <strong>{labels[event.action] ?? event.action}</strong>
                  <small>
                    {event.organization} · {timestamp(event.at)}
                  </small>
                  <TransactionDetails event={event} />
                </div>
                <div className="actions">
                  {event.status !== "SIMULATED" && (
                    <StatusBadge
                      tone={event.status === "MISMATCH" ? "error" : "green"}
                    >
                      {event.status}
                    </StatusBadge>
                  )}
                  {event.mode === "PUBLIC_DEMO" && (
                    <StatusBadge tone="purple">SIMULATED</StatusBadge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </WorkspaceList>
    </>
  );
}

export function StaffDirectory({
  token,
  onExpired,
}: {
  token: string;
  onExpired: () => void;
}) {
  const load = useCallback((offset?: number) => staff(token, offset), [token]);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<StaffMember>();
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function changeStatus() {
    if (!selected || submitting) return;
    setSubmitting(true);
    setMessage("");
    setSuccess("");
    try {
      await request(
        "/workspace/staff/" + selected.id,
        token,
        json({ active: !selected.active }, "PATCH"),
      );
      setSuccess(
        selected.active ? "Provider deactivated." : "Provider activated.",
      );
      setRevision((value) => value + 1);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) onExpired();
      else
        setMessage(
          cause instanceof Error
            ? cause.message
            : "Unable to change account status.",
        );
    } finally {
      setSelected(undefined);
      setSubmitting(false);
    }
  }
  return (
    <>
      {message && <ErrorState message={message} />}
      {success && (
        <p className="message" role="status">
          {success}
        </p>
      )}
      <WorkspaceList<StaffMember>
        heading="Organization users"
        load={load}
        onExpired={onExpired}
        revision={revision}
      >
        {(rows) => (
          <ul className="event-list">
            {rows.map((member) => (
              <li key={member.id}>
                <div>
                  <strong>{member.email}</strong>
                  <small>
                    {member.role === "PROVIDER" ? "Doctor" : "Administrator"} ·{" "}
                    {member.department ?? "No department assigned"}
                  </small>
                </div>
                <div className="actions">
                  <StatusBadge tone={member.active ? "green" : "neutral"}>
                    {member.active ? "Active" : "Inactive"}
                  </StatusBadge>
                  {member.role === "PROVIDER" && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={submitting}
                      onClick={() => setSelected(member)}
                    >
                      {member.active ? "Deactivate" : "Activate"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </WorkspaceList>
      {selected && (
        <ConfirmationDialog
          title={
            selected.active ? "Deactivate provider?" : "Activate provider?"
          }
          confirm={
            selected.active ? "Deactivate provider" : "Activate provider"
          }
          danger={selected.active}
          onCancel={() => setSelected(undefined)}
          onConfirm={() => void changeStatus()}
        >
          <p>
            {selected.email}{" "}
            {selected.active
              ? "will be signed out and their app access will be suspended."
              : "will be able to sign in and use any current grants."}
          </p>
        </ConfirmationDialog>
      )}
    </>
  );
}

export function SystemStatus({
  health,
  refresh,
}: {
  health?: Health;
  refresh: () => void;
}) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Service availability</h2>
        <button type="button" className="secondary" onClick={refresh}>
          Refresh status
        </button>
      </div>
      <dl className="card-body data-list">
        <dt>Backend API</dt>
        <dd>{health ? "Responding" : "Unavailable"}</dd>
        <dt>Database</dt>
        <dd>
          {health ? (health.database ? "Available" : "Unavailable") : "Unknown"}
        </dd>
        <dt>Ledger</dt>
        <dd>{health?.ledger ?? "Unknown"}</dd>
        <dt>Environment</dt>
        <dd>{health?.mode ?? "Unknown"}</dd>
      </dl>
    </section>
  );
}
