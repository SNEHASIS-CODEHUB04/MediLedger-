"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  AppSidebar,
  AppHeader,
  DashboardLayout,
  NotificationToast,
  ErrorState,
} from "./portal-ui";
import {
  Overview,
  AuditHistory,
  StaffDirectory,
  SystemStatus,
  VerificationHistory,
} from "./secondary-pages";
import { navigation, type Section } from "./navigation";
import {
  ApiError,
  getHealth,
  request,
  route,
  json,
  upload,
  record,
  records as fetchRecords,
  type Health,
  type DirectoryEntry,
  type RecordDetail,
} from "./api-client";
import {
  AccessPermissionCard,
  AuditTimeline,
  FileUpload,
  formatDate,
  GrantAccessDialog,
  RecordTable,
  RevokeAccessDialog,
  VerificationResult,
} from "./record-components";
import { RoleGuide } from "./role-guide";
import type {
  SessionProfile,
  AuditEvent,
  RecordSummary,
  Role,
} from "@mediledger/shared";

const demoAccountEntry = process.env.NEXT_PUBLIC_DEMO_ENTRY === "true";
const fixturesOnly = process.env.NEXT_PUBLIC_DEMO_FIXTURES_ONLY === "true";
const profiles = [
  {
    role: "AUDITOR",
    email: "auditor@mediledger.example",
    name: "Auditor",
    action: "Review permitted audit activity",
    nav: "Audit history",
    title: "Audit overview",
    description:
      "Review pseudonymous registration, consent, and verification events.",
    empty: "",
    detail: "",
  },
  {
    role: "PATIENT",
    email: "patient@mediledger.example",
    name: "Patient",
    action: "View reports and manage who can access them",
    nav: "My reports",
    title: "My reports",
    description:
      "Find your reports and manage which providers can download them.",
    empty:
      "Reports will appear here after your issuing organization registers them.",
    detail:
      "Open a report to download it, manage provider access, or review its activity.",
  },
  {
    role: "PROVIDER",
    email: "provider@mediledger.example",
    name: "Receiving provider",
    action: "Open shared reports and verify a PDF",
    nav: "Shared reports",
    title: "Shared reports",
    description:
      "Open reports shared with your account and verify copies against the ledger.",
    empty: "Ask the patient to grant access, then refresh this list.",
    detail: "Open a shared report to download it or verify a copy.",
  },
  {
    role: "ISSUER",
    email: "issuer@mediledger.example",
    name: "Issuing organization",
    action: "Register and review patient reports",
    nav: "Issued reports",
    title: "Issued reports",
    description:
      "Review reports you issued and register new reports for your patients.",
    empty: "Register a synthetic PDF to add a report to this library.",
    detail: "Open a registered report to download it or review its activity.",
  },
] satisfies {
  role: Role;
  email: string;
  name: string;
  action: string;
  nav: string;
  title: string;
  description: string;
  empty: string;
  detail: string;
}[];

function Brand() {
  return (
    <div className="brand">
      <span className="mark" aria-hidden="true">
        +
      </span>
      MediLedger
    </div>
  );
}

function RoleIcon({ kind }: { kind: Role }) {
  return (
    <span className={"role-icon " + kind.toLowerCase()} aria-hidden="true">
      <i />
    </span>
  );
}

export default function Dashboard() {
  const [health, setHealth] = useState<Health>();
  const [status, setStatus] = useState("Checking system status");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [profile, setProfile] = useState<SessionProfile>();
  const [records, setRecords] = useState<RecordSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [detail, setDetail] = useState<RecordDetail>();
  const [history, setHistory] = useState<AuditEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showCredentials, setShowCredentials] = useState(false);
  const pathname = usePathname();
  const [progress, setProgress] = useState<number>();
  const [revision, setRevision] = useState(0);
  const [healthRevision, setHealthRevision] = useState(0);
  const [granting, setGranting] = useState<DirectoryEntry>();
  const [recipientQuery, setRecipientQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const requested = pathname.split("/").filter(Boolean)[0] as
    Section | undefined;
  const setView = useCallback((value: Section, id?: string) => {
    window.history.pushState(
      null,
      "",
      "/" + value + "/" + (id ? "?id=" + encodeURIComponent(id) : ""),
    );
  }, []);
  const [search, setSearch] = useState("");
  const [verification, setVerification] = useState<"MATCH" | "MISMATCH">();
  const [revoking, setRevoking] = useState<DirectoryEntry>();

  useEffect(() => {
    const controller = new AbortController();
    getHealth(controller.signal)
      .then((value: Health) => {
        setHealth(value);
        setStatus("");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setHealth(undefined);
          setStatus("API unavailable");
        }
      });
    return () => controller.abort();
  }, [healthRevision]);

  const clearSession = useCallback(() => {
    setToken("");
    setProfile(undefined);
    setDetail(undefined);
    setRecords([]);
    setDirectory([]);
    setHistory([]);
    setCursor(null);
    setSearch("");
    setVerification(undefined);
    setGranting(undefined);
    setRevoking(undefined);
    setRecipientQuery("");
    setNotice("");
    setActiveSearch("");
    setView("login");
  }, [setView]);

  const expire = useCallback(() => {
    clearSession();
    setError("Your session expired. Sign in again to continue.");
  }, [clearSession]);

  useEffect(() => {
    if (!token || profile?.role === "AUDITOR") return;
    let sequence = 0;
    function restoreRecord() {
      const current = ++sequence;
      setDetail(undefined);
      setVerification(undefined);
      if (window.location.pathname.replace(/\/$/, "") !== "/record") return;
      const id = new URLSearchParams(window.location.search).get("id");
      if (!id) return;
      record(id, token)
        .then(([info, events]) => {
          if (current !== sequence) return;
          setDetail(info);
          setHistory(events);
        })
        .catch((cause: unknown) => {
          if (current !== sequence) return;
          if (cause instanceof ApiError && cause.status === 401) expire();
          else
            setError(
              cause instanceof Error
                ? cause.message
                : "Unable to open this record.",
            );
        });
    }
    window.addEventListener("popstate", restoreRecord);
    return () => {
      sequence++;
      window.removeEventListener("popstate", restoreRecord);
    };
  }, [token, profile?.role, expire]);

  async function act(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (cause) {
      if (token && cause instanceof ApiError && cause.status === 401) expire();
      else setError(cause instanceof Error ? cause.message : "Request failed");
    } finally {
      setProgress(undefined);
      setBusy(false);
    }
  }

  async function loadRecords(session: string, next?: string, query = "") {
    const data = await fetchRecords(session, query, next);
    setRecords((current) => (next ? [...current, ...data.items] : data.items));
    setCursor(data.next);
  }

  async function open(id: string, session = token) {
    const [info, events] = await record(id, session);
    setDetail(info);
    setHistory(events);
    setVerification(undefined);
  }

  function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    signIn(email, password);
  }

  function signIn(address: string, secret?: string) {
    void act(async () => {
      const { token: session } =
        secret === undefined
          ? await route(
              "/auth/demo",
              "",
              json({ account: address.split("@")[0] }),
            )
          : await route(
              "/auth/login",
              "",
              json({ email: address, password: secret }),
            );
      const [user, entries] = await Promise.all([
        route("/users/me", session),
        route("/users/directory", session),
      ]);
      if (user.role !== "AUDITOR") await loadRecords(session);
      setDirectory(entries);
      setToken(session);
      setProfile(user);
      setPassword("");
      setShowCredentials(false);
      const id = new URLSearchParams(window.location.search).get("id");
      if (requested === "record" && id && user.role !== "AUDITOR") {
        await open(id, session);
      } else if (
        requested !== "settings" &&
        requested !== "status" &&
        !navigation(
          user.role,
          user.role === "ISSUER" &&
            !(user.mode === "PUBLIC_DEMO" && fixturesOnly),
          "Reports",
        ).some((item) => item.path === requested)
      ) {
        setView("overview");
      }
    });
  }

  function logout() {
    void act(async () => {
      try {
        await request("/auth/logout", token, { method: "POST" });
      } finally {
        clearSession();
      }
    });
  }

  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    void act(async () => {
      const created = await upload<RecordSummary>(
        "/records",
        token,
        form,
        setProgress,
      );
      target.reset();
      setSearch("");
      setActiveSearch("");
      setRevision((value) => value + 1);
      setNotice("Report registered. Reference " + created.id);
      await Promise.all([loadRecords(token), open(created.id)]);
      setView("record", created.id);
    });
  }

  function consent(provider: string, grant: boolean) {
    if (!detail) return;
    const path = "/records/" + detail.id + "/grants";
    void act(async () => {
      await request(
        grant ? path : path + "/" + provider,
        token,
        grant ? json({ subject: provider }) : { method: "DELETE" },
      );
      await open(detail.id);
      setRevision((value) => value + 1);
      setNotice(grant ? "Access granted." : "Access revoked.");
    });
  }

  function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = new FormData(event.currentTarget);
    const id = detail.id;
    void act(async () => {
      setVerification(undefined);
      const result = await upload<{ result: "MATCH" | "MISMATCH" }>(
        "/records/" + id + "/verify",
        token,
        form,
        setProgress,
      );
      setVerification(result.result);
      setRevision((value) => value + 1);
    });
  }

  function download(preview = false) {
    if (!detail) return;
    const popup = preview ? window.open("about:blank", "_blank") : null;
    if (preview && !popup) {
      setError("Allow pop-ups to preview the PDF, or select Download PDF.");
      return;
    }
    if (popup) popup.opener = null;
    void act(async () => {
      let bytes: Blob;
      try {
        bytes = await (
          await request("/records/" + detail.id + "/document", token)
        ).blob();
      } catch (cause) {
        popup?.close();
        throw cause;
      }
      const url = URL.createObjectURL(bytes);
      if (popup) popup.location.href = url;
      else {
        const link = document.createElement("a");
        link.href = url;
        link.download = detail.filename;
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), popup ? 60_000 : 1000);
    });
  }

  const mode = profile?.mode ?? health?.mode;
  const canRegister =
    profile?.role === "ISSUER" && !(mode === "PUBLIC_DEMO" && fixturesOnly);
  const selected = profiles.find((item) => item.role === profile?.role);
  const items = profile
    ? navigation(profile.role, canRegister, selected?.nav ?? "Reports")
    : [];
  const isAllowed =
    items.some((item) => item.path === requested) ||
    requested === "settings" ||
    requested === "status" ||
    (requested === "record" && profile?.role !== "AUDITOR");
  const view: Section = isAllowed && requested ? requested : "overview";
  const title =
    view === "overview"
      ? profile?.role === "AUDITOR"
        ? "Audit overview"
        : profile?.role === "ISSUER"
          ? "Organization overview"
          : profile?.role === "PROVIDER"
            ? "Doctor overview"
            : "Patient overview"
      : view === "record"
        ? "Record details"
        : view === "settings"
          ? "Profile and settings"
          : view === "status"
            ? "System status"
            : items.find((item) => item.path === view)?.label;
  const filtered = records;
  const reportView =
    ["reports", "record", "access", "verify"].includes(view) &&
    profile?.role !== "AUDITOR";
  const recipients = directory.filter(
    (entry) =>
      entry.active !== false &&
      !detail?.grants.includes(entry.id) &&
      (entry.organization.name + " " + entry.id)
        .toLowerCase()
        .includes(recipientQuery.trim().toLowerCase()),
  );
  const unavailable = !health?.database || health?.ledger === "UNAVAILABLE";

  const modeLabel = (
    <span className={"pill " + (mode === "PUBLIC_DEMO" ? "purple" : "blue")}>
      <i aria-hidden="true" />
      {mode === "PUBLIC_DEMO"
        ? "PUBLIC DEMO / SIMULATED"
        : mode === "LIVE_FABRIC"
          ? "Live Fabric"
          : status || "Status unavailable"}
    </span>
  );

  const feedback = (
    <div className="feedback" aria-live="polite">
      {error && <ErrorState message={error} />}
      {notice && <NotificationToast>{notice}</NotificationToast>}
      {busy && (
        <p className="message waiting" role="status">
          {progress === undefined
            ? "Working…"
            : progress < 100
              ? "Uploading " + progress + "%"
              : "Upload complete · Processing…"}
        </p>
      )}
    </div>
  );

  if (!profile || !selected) {
    return (
      <main className="welcome">
        <section className="welcome-hero" aria-labelledby="welcome-title">
          <Brand />
          <div className="welcome-copy">
            <h1 id="welcome-title">Share medical reports with confidence.</h1>
            <p>
              Manage consent, share reports across organizations, and check that
              a PDF matches its registered copy.
            </p>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orbit outer" />
            <div className="orbit inner" />
            <div className="art-paper">
              <div className="art-logo">+</div>
              <div className="art-lines" />
              <div className="art-lines short" />
              <div className="art-lines" />
            </div>
            <div className="art-check">✓</div>
          </div>
        </section>
        <section className="welcome-login" aria-labelledby="sign-in-title">
          <div className="welcome-status">{modeLabel}</div>
          <div className="login-content">
            <h2 id="sign-in-title">Open your workspace</h2>
            <p className="muted">
              {mode === "PUBLIC_DEMO"
                ? "Choose a role to explore with synthetic reports."
                : "Sign in with the account issued to you."}
            </p>
            {feedback}
            <fieldset disabled={busy} aria-busy={busy}>
              {mode === "PUBLIC_DEMO" && (
                <div className="role-list" aria-label="Demo accounts">
                  {profiles.map((item) => (
                    <button
                      type="button"
                      className="role-option"
                      key={item.role}
                      aria-pressed={email === item.email}
                      onClick={() => {
                        setEmail(item.email);
                        setPassword("");
                        if (demoAccountEntry) signIn(item.email);
                        else setShowCredentials(true);
                      }}
                    >
                      <RoleIcon kind={item.role} />
                      <span>
                        <strong>{item.name}</strong>
                        <small>{item.action}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {(mode !== "PUBLIC_DEMO" ||
                showCredentials ||
                requested === "login") && (
                <form className="stack credentials" onSubmit={login}>
                  <label>
                    Email address
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="username"
                      required
                    />
                  </label>
                  <label>
                    Password
                    <input
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                    />
                  </label>
                  <button className="primary">Sign in</button>
                </form>
              )}
              {mode === "PUBLIC_DEMO" &&
                !showCredentials &&
                requested !== "login" && (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      setShowCredentials(true);
                      setView("login");
                    }}
                  >
                    Sign in with email
                  </button>
                )}
            </fieldset>
            {unavailable && (
              <p className="system-warning">
                {health ? "A service is currently unavailable." : status}
              </p>
            )}
          </div>
          <p className="welcome-footer">Use synthetic documents only.</p>
        </section>
      </main>
    );
  }

  return (
    <DashboardLayout
      sidebar={
        <AppSidebar
          brand={<Brand />}
          name={selected.name}
          organization={profile.name}
          items={[...items, { path: "status", label: "System status" }]}
          current={view}
          go={setView}
        />
      }
      header={
        <AppHeader
          section={title ?? "Workspace"}
          organization={profile.name}
          name={selected.name}
          mode={modeLabel}
          notice={notice}
          go={setView}
          logout={logout}
          busy={busy}
        />
      }
    >
      <header className="page-heading">
        <div>
          <h1>{title}</h1>
          <p>
            {view === "register"
              ? "Choose a patient and upload their synthetic PDF."
              : view === "overview" || reportView
                ? selected.description
                : null}
          </p>
        </div>
        {canRegister && (view === "reports" || view === "overview") && (
          <button
            type="button"
            className="primary"
            onClick={() => setView("register")}
          >
            + Register report
          </button>
        )}
      </header>
      {view === "overview" && (
        <RoleGuide
          key={profile.role}
          role={profile.role}
          canRegister={canRegister}
        />
      )}
      {feedback}
      {view === "overview" && (
        <Overview
          profile={profile}
          token={token}
          onExpired={expire}
          revision={revision}
          onOpen={(id) =>
            void act(async () => {
              await open(id);
              setView("record", id);
            })
          }
        />
      )}
      {(view === "audit" ||
        (view === "overview" &&
          ["AUDITOR", "ISSUER"].includes(profile.role))) && (
        <AuditHistory token={token} onExpired={expire} revision={revision} />
      )}
      {view === "staff" && <StaffDirectory token={token} onExpired={expire} />}
      {view === "status" && (
        <SystemStatus
          health={health}
          refresh={() => setHealthRevision((value) => value + 1)}
        />
      )}
      {view === "settings" && (
        <section className="card card-body">
          <h2>Account details</h2>
          <dl className="data-list">
            <dt>Email address</dt>
            <dd>{profile.email}</dd>
            <dt>Role</dt>
            <dd>{selected.name}</dd>
            <dt>Organization</dt>
            <dd>{profile.name}</dd>
            <dt>Department</dt>
            <dd>{profile.department ?? "Unassigned"}</dd>
          </dl>
        </section>
      )}
      <fieldset disabled={busy} aria-busy={busy}>
        {view === "register" && canRegister ? (
          <section className="card upload-card" aria-labelledby="upload-title">
            <div className="card-head">
              <div>
                <h2 id="upload-title">Report details</h2>
                <p>
                  The patient can manage provider access after registration.
                </p>
              </div>
            </div>
            {directory.length ? (
              <form className="stack card-body" onSubmit={register}>
                <div className="field">
                  <label htmlFor="report-patient">Patient</label>
                  <select
                    id="report-patient"
                    name="subject"
                    defaultValue=""
                    required
                  >
                    <option value="" disabled>
                      Choose a patient
                    </option>
                    {directory.map((entry, index) => (
                      <option key={entry.id} value={entry.id}>
                        Patient {index + 1} · {entry.id.slice(-8)}
                      </option>
                    ))}
                  </select>
                </div>
                <FileUpload label="Report PDF" />
                <div className="actions">
                  <button className="primary">Register report</button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setView("reports")}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <p className="card-body muted">
                Your organization has no patients available for registration.
              </p>
            )}
          </section>
        ) : (
          reportView && (
            <div className="board">
              <section
                className="card report-card"
                aria-labelledby="reports-title"
              >
                <div className="card-head">
                  <div>
                    <h2 id="reports-title">Report library</h2>
                    <p>
                      {records.length}{" "}
                      {records.length === 1 ? "report" : "reports"} loaded
                    </p>
                  </div>
                  <button
                    type="button"
                    className="secondary compact"
                    onClick={() =>
                      void act(async () => {
                        await loadRecords(token, undefined, activeSearch);
                        if (detail) {
                          setDetail(undefined);
                          setVerification(undefined);
                        }
                      })
                    }
                  >
                    Refresh
                  </button>
                </div>
                <form
                  className="search-wrap search-controls"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act(async () => {
                      await loadRecords(token, undefined, search.trim());
                      setActiveSearch(search.trim());
                    });
                  }}
                >
                  <label>
                    <span className="sr-only">Search reports</span>
                    <input
                      type="search"
                      maxLength={120}
                      placeholder={
                        profile.role === "PROVIDER"
                          ? "Search reports or patient reference"
                          : "Search reports"
                      }
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                  <button className="secondary">Search</button>
                </form>
                {filtered.length ? (
                  <RecordTable
                    rows={filtered}
                    selected={detail?.id}
                    showPatient={profile.role === "PROVIDER"}
                    onOpen={(id) =>
                      void act(async () => {
                        setDetail(undefined);
                        await open(id);
                        if (
                          view === "overview" ||
                          view === "reports" ||
                          view === "record"
                        )
                          setView("record", id);
                        requestAnimationFrame(() =>
                          document.getElementById("detail-title")?.focus(),
                        );
                      })
                    }
                  />
                ) : (
                  <div className="mini-empty">
                    <strong>
                      {activeSearch.trim()
                        ? "No matching reports"
                        : "No reports available"}
                    </strong>
                    <p>
                      {activeSearch.trim()
                        ? "Try a different name or organization."
                        : selected.empty}
                    </p>
                  </div>
                )}
                {cursor && (
                  <div className="list-end">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        void act(() => loadRecords(token, cursor, activeSearch))
                      }
                    >
                      Load more reports
                    </button>
                  </div>
                )}
              </section>
              <section
                className="card detail-card"
                aria-labelledby="detail-title"
              >
                {detail ? (
                  <>
                    <div className="card-head detail-heading">
                      <div>
                        <h2 id="detail-title" tabIndex={-1}>
                          {detail.filename}
                        </h2>
                        <p>
                          {detail.issuer} · {formatDate(detail.createdAt)}
                          <small>
                            Record reference <code>{detail.id}</code>
                          </small>
                        </p>
                      </div>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => download()}
                      >
                        Download PDF
                      </button>
                      {profile.role === "PROVIDER" && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => download(true)}
                        >
                          Preview PDF
                        </button>
                      )}
                    </div>
                    {profile.role === "PATIENT" && (
                      <section className="detail-section">
                        <h3>Manage provider access</h3>
                        <p>
                          Revoking access blocks future downloads. Providers
                          keep copies they already downloaded.
                        </p>
                        <div className="actions">
                          <button
                            type="button"
                            className="primary"
                            onClick={() => {
                              setRecipientQuery("");
                              setGranting({
                                id: "",
                                organization: { name: "" },
                              });
                            }}
                          >
                            Grant access
                          </button>
                        </div>
                        <ul className="provider-list">
                          {directory
                            .filter((entry) => detail.grants.includes(entry.id))
                            .map((entry) => (
                              <AccessPermissionCard
                                key={entry.id}
                                provider={entry}
                                onRevoke={() => setRevoking(entry)}
                              />
                            ))}
                        </ul>
                      </section>
                    )}
                    {profile.role === "PROVIDER" && (
                      <section className="detail-section">
                        <h3>Verify a copy</h3>
                        <p>
                          Compare a PDF with the registered copy. A match
                          confirms identical file bytes.
                        </p>
                        <form
                          className="stack verification"
                          key={detail.id}
                          onSubmit={verify}
                        >
                          <FileUpload
                            label="PDF to verify"
                            onChange={() => setVerification(undefined)}
                          />
                          <button className="primary">Verify PDF</button>
                        </form>
                        {verification && (
                          <VerificationResult result={verification} />
                        )}
                      </section>
                    )}
                    <AuditTimeline events={history} />
                  </>
                ) : (
                  <div className="detail-empty">
                    <span className="document-icon large" aria-hidden="true" />
                    <h2 id="detail-title" tabIndex={-1}>
                      Select a report
                    </h2>
                    <p>{selected.detail}</p>
                  </div>
                )}
              </section>
            </div>
          )
        )}
      </fieldset>
      {view === "verify" && (
        <VerificationHistory
          token={token}
          onExpired={expire}
          revision={revision}
        />
      )}
      <footer className="workspace-footer">
        <span>Use synthetic documents only.</span>
        <span>
          {health
            ? unavailable
              ? "Service unavailable"
              : "System online"
            : status}
        </span>
      </footer>
      {granting && (
        <GrantAccessDialog
          recipients={recipients}
          search={recipientQuery}
          onSearch={(query) => {
            setRecipientQuery(query);
            setGranting({ id: "", organization: { name: "" } });
          }}
          selected={granting}
          onSelect={(entry) =>
            setGranting(entry ?? { id: "", organization: { name: "" } })
          }
          onCancel={() => setGranting(undefined)}
          onConfirm={() => {
            if (!granting.id) return;
            setGranting(undefined);
            consent(granting.id, true);
          }}
        />
      )}
      {revoking && (
        <RevokeAccessDialog
          name={revoking.organization.name}
          onCancel={() => setRevoking(undefined)}
          onConfirm={() => {
            setRevoking(undefined);
            consent(revoking.id, false);
          }}
        />
      )}
    </DashboardLayout>
  );
}
