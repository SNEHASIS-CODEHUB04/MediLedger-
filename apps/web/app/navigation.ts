import type { Role } from "@mediledger/shared";

export const sectionNames = [
  "login",
  "signup",
  "forgot-password",
  "reset-password",
  "confirm-email",
  "resend-verification",
  "overview",
  "reports",
  "register",
  "record",
  "access",
  "verify",
  "staff",
  "audit",
  "settings",
  "status",
] as const;
export type Section = (typeof sectionNames)[number];
export type NavItem = { path: Section; label: string };

export function navigation(
  role: Role,
  canRegister: boolean,
  reportsLabel: string,
): NavItem[] {
  const links: NavItem[] = [{ path: "overview", label: "Overview" }];
  if (role !== "AUDITOR") links.push({ path: "reports", label: reportsLabel });
  if (canRegister) links.push({ path: "register", label: "Register a report" });
  if (role === "PATIENT")
    links.push({ path: "access", label: "Access management" });
  if (role === "PROVIDER")
    links.push({ path: "verify", label: "Verification centre" });
  if (role === "ISSUER")
    links.push({ path: "staff", label: "Organization users" });
  if (role === "ISSUER" || role === "AUDITOR")
    links.push({ path: "audit", label: "Audit history" });
  return links;
}
