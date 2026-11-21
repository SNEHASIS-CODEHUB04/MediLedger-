"use client";
import { useEffect, useState } from "react";
import { ApiError, read, request } from "./api-client";
import { EmptyState, ErrorState, LoadingSkeleton } from "./portal-ui";

type Session = { id: string; expiresAt: string; current: boolean };
export function Sessions({
  token,
  onExpired,
  onEnded,
}: {
  token: string;
  onExpired: () => void;
  onEnded: () => void;
}) {
  const [data, setData] = useState<Session[]>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    read<Session[]>("/auth/sessions", token)
      .then((sessions) => {
        if (current) setData(sessions);
      })
      .catch((cause: unknown) => {
        if (current) {
          if (cause instanceof ApiError && cause.status === 401) onExpired();
          else
            setError(
              cause instanceof Error
                ? cause.message
                : "Unable to load sessions.",
            );
        }
      });
    return () => {
      current = false;
    };
  }, [token, onExpired]);
  async function revoke(session: Session) {
    setBusy(true);
    setError("");
    try {
      await request("/auth/sessions/" + session.id, token, {
        method: "DELETE",
      });
      if (session.current) onEnded();
      else setData((items) => items?.filter((item) => item.id !== session.id));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) onExpired();
      else
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to end this session.",
        );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <div className="card-head">
        <h2>Active sessions</h2>
      </div>
      {error && <ErrorState message={error} />}
      {!data ? (
        !error && <LoadingSkeleton />
      ) : !data.length ? (
        <EmptyState title="No active sessions" />
      ) : (
        <ul className="event-list">
          {data.map((session) => (
            <li key={session.id}>
              <div>
                <strong>
                  {session.current ? "Current session" : "Other session"}
                </strong>
                <small>
                  Expires {new Date(session.expiresAt).toLocaleString()}
                </small>
              </div>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void revoke(session)}
              >
                End session
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
