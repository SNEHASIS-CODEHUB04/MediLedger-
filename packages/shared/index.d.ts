export type Mode = "PUBLIC_DEMO" | "LIVE_FABRIC";
export type Role = "ISSUER" | "PATIENT" | "PROVIDER" | "AUDITOR";
export type Actor = { id: string; role: Role; organization: string };
export type AuditEvent = {
  action: string;
  actor: string;
  at: string;
  mode: Mode;
  txId?: string;
  status: "SIMULATED" | "COMMITTED";
};
export type WorkspaceEvent = {
  recordId: string;
  action: string;
  actor: string;
  organization: string;
  at: string;
  txId: string | null;
  status: "SIMULATED" | "COMMITTED" | "MATCH" | "MISMATCH";
  mode: Mode;
};
export type SessionProfile = Actor & {
  name: string;
  email: string;
  department: string | null;
  mode: Mode;
};
export type StaffMember = {
  id: string;
  email: string;
  role: Role;
  department: string | null;
  active: boolean;
};
export type WorkspaceMetrics = {
  records: number;
  activeGrants: number;
  matched: number;
  mismatched: number;
  recent: RecordSummary[];
};
export type VerificationAttempt = {
  id: string;
  recordId: string;
  result: "MATCH" | "MISMATCH";
  createdAt: string;
};
export type RecordSummary = {
  id: string;
  filename: string;
  issuer: string;
  createdAt: string;
  patientRef?: string;
};
