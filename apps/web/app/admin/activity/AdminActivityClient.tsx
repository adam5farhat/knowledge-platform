"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "../../../lib/authClient";
import dash from "../../components/shellNav.module.css";
import { AdminChromeHeader, type AdminChromeSessionUser } from "../AdminChromeHeader";
import AdminNav from "../AdminNav";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Phase = "checking" | "need-login" | "forbidden" | "load-error" | "ready";

type AuthEventRow = {
  id: string;
  eventType: string;
  createdAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  user: { id: string; email: string; name: string } | null;
};

export default function AdminActivityClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(40);
  const [total, setTotal] = useState(0);
  const [events, setEvents] = useState<AuthEventRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sessionUser, setSessionUser] = useState<AdminChromeSessionUser | null>(null);

  const loadEvents = useCallback(
    async (p: number) => {
      setLoadError(null);
      const res = await fetchWithAuth(`${API}/admin/activity?page=${p}&pageSize=${pageSize}`);
      if (!res.ok) {
        setLoadError("Could not load activity.");
        return;
      }
      const data = (await res.json()) as {
        total?: number;
        page?: number;
        events?: AuthEventRow[];
      };
      if (!Array.isArray(data.events)) {
        setLoadError("Invalid response from server.");
        return;
      }
      setTotal(data.total ?? 0);
      setPage(data.page ?? p);
      setEvents(data.events);
    },
    [pageSize],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const t = await getValidAccessToken();
      if (!t) {
        if (!cancelled) {
          setPhase("need-login");
          router.replace("/login");
        }
        return;
      }
      try {
        const meRes = await fetchWithAuth(`${API}/auth/me`);
        if (meRes.status === 401) {
          clearStoredSession();
          if (!cancelled) {
            setPhase("need-login");
            router.replace("/login");
          }
          return;
        }
        const me = (await meRes.json().catch(() => ({}))) as {
          user?: { name?: string; email?: string; role?: string; profilePictureUrl?: string | null };
        };
        if (!meRes.ok || me.user?.role !== "ADMIN") {
          if (!cancelled) setPhase("forbidden");
          return;
        }
        if (!cancelled) {
          setSessionUser({
            name: me.user?.name ?? "",
            email: me.user?.email ?? "",
            role: me.user?.role ?? "ADMIN",
            profilePictureUrl: me.user?.profilePictureUrl ?? null,
          });
          setPhase("ready");
        }
      } catch {
        if (!cancelled) setPhase("load-error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (phase !== "ready") return;
    void loadEvents(page);
  }, [phase, page, loadEvents]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (phase === "checking") {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }

  if (phase === "need-login") {
    return (
      <main style={{ maxWidth: 640 }}>
        <h1>Auth activity</h1>
        <p style={{ color: "#52525b" }}>Sign in to continue.</p>
        <p style={{ marginTop: "1rem" }}>
          <Link href="/login">Sign in</Link>
        </p>
      </main>
    );
  }

  if (phase === "forbidden") {
    return (
      <main style={{ maxWidth: 640 }}>
        <h1>Auth activity</h1>
        <p style={{ color: "var(--error)" }}>Administrators only.</p>
        <Link href="/dashboard">Dashboard</Link>
      </main>
    );
  }

  if (phase === "load-error") {
    return (
      <main>
        <p style={{ color: "var(--error)" }}>Could not verify access.</p>
        <Link href="/admin">Admin hub</Link>
      </main>
    );
  }

  if (!sessionUser) {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main className={dash.page} data-dashboard-fullscreen="true">
      <AdminChromeHeader user={sessionUser} />
      <div
        style={{
          padding: "0 1rem 2rem",
          maxWidth: 960,
          margin: "0 auto",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
      <h1>Auth activity</h1>
      <p style={{ color: "#52525b", marginTop: 0 }}>Recent authentication events (newest first).</p>
      <AdminNav />
      {loadError ? (
        <p role="alert" style={{ color: "var(--error)" }}>
          {loadError}
        </p>
      ) : null}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #e4e4e7" }}>
              <th style={{ padding: "0.5rem 0.35rem" }}>When</th>
              <th style={{ padding: "0.5rem 0.35rem" }}>Event</th>
              <th style={{ padding: "0.5rem 0.35rem" }}>User</th>
              <th style={{ padding: "0.5rem 0.35rem" }}>IP</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} style={{ borderBottom: "1px solid #f4f4f5" }}>
                <td style={{ padding: "0.45rem 0.35rem", whiteSpace: "nowrap" }}>
                  {new Date(e.createdAt).toLocaleString()}
                </td>
                <td style={{ padding: "0.45rem 0.35rem" }}>{e.eventType}</td>
                <td style={{ padding: "0.45rem 0.35rem" }}>
                  {e.user ? (
                    <>
                      {e.user.name}
                      <br />
                      <span style={{ color: "#71717a" }}>{e.user.email}</span>
                    </>
                  ) : (
                    <span style={{ color: "#71717a" }}>—</span>
                  )}
                </td>
                <td style={{ padding: "0.45rem 0.35rem", fontFamily: "monospace", fontSize: "0.82rem" }}>
                  {e.ipAddress ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          style={{ padding: "0.4rem 0.75rem", borderRadius: 6, border: "1px solid #d4d4d8", background: "#fff" }}
        >
          Previous
        </button>
        <span style={{ color: "#52525b" }}>
          Page {page} of {totalPages} ({total} events)
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
          style={{ padding: "0.4rem 0.75rem", borderRadius: 6, border: "1px solid #d4d4d8", background: "#fff" }}
        >
          Next
        </button>
      </div>
      </div>
    </main>
  );
}
