import type { AuditEvent, RecordSummary } from "@mediledger/shared";
import type { DirectoryEntry } from "./api-client";
import { ConfirmationDialog, StatusBadge } from "./portal-ui";

export function formatDate(value: string, withTime = false) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
  }).format(new Date(value));
}

export function RecordCard({
  record,
  selected,
  showPatient,
  onOpen,
}: {
  record: RecordSummary;
  selected: boolean;
  showPatient: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="report"
      aria-pressed={selected}
      onClick={onOpen}
    >
      <span className="document-icon" aria-hidden="true" />
      <span className="report-copy">
        <strong>{record.filename}</strong>
        <small>
          {record.issuer} · {formatDate(record.createdAt)}
          {showPatient && record.patientRef && (
            <span> · Patient {record.patientRef.slice(-8)}</span>
          )}
        </small>
        <small>Ref {record.id.slice(-8)}</small>
      </span>
    </button>
  );
}

export function RecordTable({
  rows,
  selected,
  showPatient,
  onOpen,
}: {
  rows: RecordSummary[];
  selected?: string;
  showPatient: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <ul className="report-list">
      {rows.map((row) => (
        <li key={row.id}>
          <RecordCard
            record={row}
            selected={row.id === selected}
            showPatient={showPatient}
            onOpen={() => onOpen(row.id)}
          />
        </li>
      ))}
    </ul>
  );
}

export function FileUpload({
  label,
  onChange,
}: {
  label: string;
  onChange?: () => void;
}) {
  return (
    <div className="field">
      <label htmlFor="report-file">{label}</label>
      <input
        id="report-file"
        name="file"
        type="file"
        accept=".pdf,application/pdf"
        required
        onChange={onChange}
        aria-describedby="pdf-restrictions"
      />
      <small id="pdf-restrictions">PDF only, up to 5 MiB</small>
    </div>
  );
}

export function AccessPermissionCard({
  provider,
  onRevoke,
}: {
  provider: DirectoryEntry;
  onRevoke: () => void;
}) {
  return (
    <li className="provider">
      <div>
        <strong>{provider.organization.name}</strong>
        <small>Provider · {provider.id.slice(-8)}</small>
      </div>
      <StatusBadge tone={provider.active === false ? "neutral" : "green"}>
        {provider.active === false ? "Account suspended" : "Access granted"}
      </StatusBadge>
      <button type="button" className="secondary danger" onClick={onRevoke}>
        Revoke
      </button>
    </li>
  );
}

export function VerificationResult({
  result,
}: {
  result: "MATCH" | "MISMATCH";
}) {
  return (
    <div
      className={"result " + (result === "MATCH" ? "green" : "error")}
      role="status"
    >
      <strong>{result === "MATCH" ? "Match" : "Mismatch"}</strong>
      <p>
        {result === "MATCH"
          ? "This PDF matches the registered file."
          : "This PDF differs from the registered file."}
      </p>
      <small>
        Verification compares file bytes. It does not validate clinical
        information or the issuer’s claims.
      </small>
    </div>
  );
}

const eventLabels: Record<string, string> = {
  RegisterRecord: "Report registered",
  GrantAccess: "Provider access granted",
  RevokeAccess: "Provider access revoked",
};

export function AuditTimeline({ events }: { events: AuditEvent[] }) {
  return (
    <section className="detail-section">
      <h3>Activity</h3>
      {events.length === 0 && <p>No activity recorded yet.</p>}
      <ol className="timeline">
        {[...events].reverse().map((item, index) => (
          <li key={item.txId ?? index}>
            <span className="timeline-dot" aria-hidden="true" />
            <div>
              <strong>{eventLabels[item.action] ?? item.action}</strong>
              <small>{formatDate(item.at, true)}</small>
              {item.mode === "LIVE_FABRIC" && item.txId && (
                <code>{item.txId}</code>
              )}
            </div>
            <StatusBadge
              tone={item.status === "SIMULATED" ? "purple" : "green"}
            >
              {item.status === "SIMULATED" ? "SIMULATED" : "Committed"}
            </StatusBadge>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function RevokeAccessDialog({
  name,
  onCancel,
  onConfirm,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmationDialog
      title="Revoke provider access?"
      confirm="Revoke access"
      danger
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <p>
        {name} will lose access to future downloads. Copies already downloaded
        remain with the provider.
      </p>
    </ConfirmationDialog>
  );
}

export function GrantAccessDialog({
  recipients,
  search,
  onSearch,
  selected,
  onSelect,
  onCancel,
  onConfirm,
}: {
  recipients: DirectoryEntry[];
  search: string;
  onSearch: (value: string) => void;
  selected: DirectoryEntry;
  onSelect: (entry: DirectoryEntry | undefined) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmationDialog
      title="Grant provider access"
      confirm="Confirm grant"
      confirmDisabled={!selected.id}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <div className="stack">
        <label>
          Search providers
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
        </label>
        <div className="field">
          <label htmlFor="consent-recipient">Recipient</label>
          <select
            id="consent-recipient"
            value={selected.id}
            onChange={(event) =>
              onSelect(
                recipients.find((item) => item.id === event.target.value),
              )
            }
          >
            <option value="">Select a provider</option>
            {recipients.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.organization.name} · {entry.id.slice(-8)}
              </option>
            ))}
          </select>
        </div>
        {selected.id && (
          <p>
            {selected.organization.name} can download this report once you
            confirm.
          </p>
        )}
        {!recipients.length && <p>No eligible providers match this search.</p>}
      </div>
    </ConfirmationDialog>
  );
}
