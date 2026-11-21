"use client";

import { useEffect, useState, type FormEvent } from "react";
import { json, request } from "./api-client";
import type { Section } from "./navigation";

export function ManualAuth({
  section,
  go,
  busy,
  signIn,
}: {
  section: Section | undefined;
  go: (section: Section) => void;
  busy: boolean;
  signIn: (email: string, password: string) => void;
}) {
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const mode =
    section === "signup" ||
    section === "forgot-password" ||
    section === "reset-password" ||
    section === "confirm-email" ||
    section === "resend-verification"
      ? section
      : "login";
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get(
      "token",
    );
    if (value) {
      setToken(value);
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    if (mode === "login") {
      signIn(email, password);
      return;
    }
    setPending(true);
    setError("");
    setMessage("");
    try {
      const verification = mode === "confirm-email";
      const reset = mode === "reset-password";
      await request(
        "/auth/" + (verification ? "verify-email" : mode),
        "",
        json(
          verification
            ? { token }
            : reset
              ? { token, password }
              : mode === "signup"
                ? { email, password }
                : { email },
        ),
      );
      setMessage(
        verification
          ? "Email verified. You can sign in."
          : reset
            ? "Password saved. You can sign in with your new password."
            : "If the address is eligible, check your inbox for a link.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request failed.");
    } finally {
      setPending(false);
    }
  }
  const titles = {
    login: "Sign in",
    signup: "Create a patient account",
    "forgot-password": "Request a password reset",
    "reset-password": "Set your password",
    "confirm-email": "Verify your email",
    "resend-verification": "Resend verification email",
  };
  const tokenMode = mode === "confirm-email" || mode === "reset-password";
  return (
    <div>
      <h2 id="sign-in-title">{titles[mode]}</h2>
      {mode === "signup" && (
        <p className="muted">
          Your organization can affiliate your account after verifying your
          identity.
        </p>
      )}
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="message" role="status">
          {message}
        </p>
      )}
      {tokenMode && !token && (
        <p className="message error">Open the complete link from your email.</p>
      )}
      <form className="stack credentials" onSubmit={submit}>
        {!tokenMode && (
          <label>
            Email address
            <input
              name="email"
              type="email"
              maxLength={254}
              autoComplete="username"
              required
            />
          </label>
        )}
        {(mode === "login" ||
          mode === "signup" ||
          mode === "reset-password") && (
          <label>
            Password
            <input
              name="password"
              type="password"
              minLength={mode === "login" ? 1 : 12}
              maxLength={72}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              required
            />
          </label>
        )}
        <button
          className="primary"
          disabled={busy || pending || (tokenMode && (!token || !!message))}
        >
          {pending ? "Submitting…" : titles[mode]}
        </button>
      </form>
      <div className="actions">
        {mode !== "login" && (
          <button
            className="text-button"
            type="button"
            onClick={() => go("login")}
          >
            Back to sign in
          </button>
        )}
        {mode === "login" && (
          <>
            <button
              className="text-button"
              type="button"
              onClick={() => go("signup")}
            >
              Sign up
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => go("forgot-password")}
            >
              Forgot password?
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => go("resend-verification")}
            >
              Resend verification
            </button>
          </>
        )}
      </div>
    </div>
  );
}
