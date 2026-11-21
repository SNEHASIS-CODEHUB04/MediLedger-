"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  Activity,
  Building2,
  ChevronDown,
  ClipboardCheck,
  FileText,
  HeartPulse,
  Home,
  Menu,
  Settings,
  Shield,
  Upload,
  UserRound,
  Users,
} from "lucide-react";
import type { NavItem, Section } from "./navigation";

const icons = {
  login: UserRound,
  signup: UserRound,
  "forgot-password": UserRound,
  "reset-password": UserRound,
  "confirm-email": UserRound,
  "resend-verification": UserRound,
  overview: Home,
  reports: FileText,
  register: Upload,
  record: FileText,
  access: Shield,
  verify: ClipboardCheck,
  staff: Users,
  audit: Activity,
  settings: Settings,
  status: HeartPulse,
};

export function AppSidebar({
  brand,
  name,
  organization,
  items,
  current,
  go,
}: {
  brand: ReactNode;
  name: string;
  organization: string;
  items: NavItem[];
  current: Section;
  go: (section: Section) => void;
}) {
  const drawer = useRef<HTMLDetailsElement>(null);
  const links = items.map(({ path, label }) => {
    const Icon = icons[path];
    return (
      <button
        key={path}
        type="button"
        aria-current={current === path ? "page" : undefined}
        onClick={() => {
          go(path);
          drawer.current?.removeAttribute("open");
        }}
      >
        <Icon size={18} aria-hidden="true" />
        {label}
      </button>
    );
  });
  return (
    <aside className="sidebar">
      {brand}
      <div className="side-profile">
        <Building2 aria-hidden="true" />
        <div>
          <strong>{organization}</strong>
          <small>{name}</small>
        </div>
      </div>
      <nav className="side-nav desktop-nav" aria-label="Workspace">
        {links}
      </nav>
      <details className="mobile-nav" ref={drawer}>
        <summary>
          <Menu size={18} aria-hidden="true" /> Workspace menu
        </summary>
        <nav className="side-nav" aria-label="Mobile workspace">
          {links}
        </nav>
      </details>
    </aside>
  );
}

export function AppHeader({
  section,
  organization,
  name,
  mode,
  notice,
  go,
  logout,
  busy,
}: {
  section: string;
  organization: string;
  name: string;
  mode: ReactNode;
  notice: string;
  go: (section: Section) => void;
  logout: () => void;
  busy: boolean;
}) {
  return (
    <header className="workspace-top">
      <div className="breadcrumbs">
        <span>{organization}</span>
        <span aria-hidden="true">/</span>
        <strong>{section}</strong>
      </div>
      <div className="header-controls">
        {mode}
        <details className="header-menu">
          <summary>
            <Activity size={17} aria-hidden="true" />
            <span className="sr-only">Notifications</span>
          </summary>
          <div className="menu-popover">
            <strong>Notifications</strong>
            <p>{notice || "No new workspace notifications."}</p>
          </div>
        </details>
        <details className="header-menu">
          <summary aria-label="Profile menu">
            <UserRound size={17} aria-hidden="true" />
            <span>{name}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <div className="menu-popover">
            <button
              type="button"
              className="text-button"
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                go("settings");
              }}
            >
              Profile and settings
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={logout}
            >
              Sign out
            </button>
          </div>
        </details>
      </div>
    </header>
  );
}

export function DashboardLayout({
  sidebar,
  header,
  children,
}: {
  sidebar: ReactNode;
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <a className="skip" href="#workspace">
        Skip to workspace
      </a>
      {sidebar}
      <main className="workspace" id="workspace">
        {header}
        <div className="content">{children}</div>
      </main>
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <article className="card stat">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </article>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={"pill " + tone}>{children}</span>;
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mini-empty">
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}

export function LoadingSkeleton() {
  return (
    <div className="card card-body skeleton" role="status" aria-label="Loading">
      <span />
      <span />
      <span />
    </div>
  );
}

export function NotificationToast({ children }: { children: ReactNode }) {
  return (
    <p className="message" role="status">
      {children}
    </p>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <p className="message error" role="alert">
      {message}
    </p>
  );
}

export function ConfirmationDialog({
  title,
  children,
  confirm,
  danger,
  confirmDisabled,
  onCancel,
  onConfirm,
}: {
  title: string;
  children: ReactNode;
  confirm: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="confirmation-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id="confirmation-title">{title}</h2>
      {children}
      <div className="actions">
        <button
          type="button"
          className="secondary"
          autoFocus
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className={danger ? "primary destructive" : "primary"}
          disabled={confirmDisabled}
          onClick={onConfirm}
        >
          {confirm}
        </button>
      </div>
    </dialog>
  );
}
