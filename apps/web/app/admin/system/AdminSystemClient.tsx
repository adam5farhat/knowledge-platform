"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "../../../lib/authClient";
import AdminNav from "../AdminNav";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Phase = "checking" | "need-login" | "forbidden" | "load-error" | "ready";

type Stats = {
  users: { total: number; active: number };
  documents: { total: number; archived: number };
  departments: number;
  documentVersionsFailed: number;
};

export default function AdminSystemClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setError(null);
    const res = await fetchWithAuth(`${API}/admin/stats`);
    if (!res.ok) {
      setError("Could not load statistics.");
      return;
    }
    const data = (await res.json()) as Stats;
    setStats(data);
  }, []);

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
        const me = (await meRes.json().catch(() => ({}))) as { user?: { role?: string } };
        if (!meRes.ok || me.user?.role !== "ADMIN") {
          if (!cancelled) setPhase("forbidden");
          return;
        }
        await loadStats();
        if (!cancelled) setPhase("ready");
      } catch {
        if (!cancelled) setPhase("load-error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, loadStats]);

  if (phase === "checking") {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }

  if (phase === "need-login") {
    return (
      <main style={{ maxWidth: 520 }}>
        <h1>System</h1>
        <p style={{ color: "#52525b" }}>Sign in to continue.</p>
        <Link href="/login">Sign in</Link>
      </main>
    );
  }

  if (phase === "forbidden") {
    return (
      <main style={{ maxWidth: 520 }}>
        <h1>System</h1>
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

  return (
    <main style={{ maxWidth: 560 }}>
      <h1>System overview</h1>
      <p style={{ color: "#52525b", marginTop: 0 }}>Snapshot counts from the database.</p>
      <AdminNav />
      {error ? (
        <p role="alert" style={{ color: "var(--error)" }}>
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void loadStats()}
        style={{
          marginBottom: "1rem",
          padding: "0.45rem 0.9rem",
          borderRadius: 6,
          border: "1px solid #d4d4d8",
          background: "#fff",
          cursor: "pointer",
        }}
      >
        Refresh
      </button>
      {stats ? (
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: "0.35rem 1.5rem",
            margin: 0,
          }}
        >
          <dt style={{ color: "#52525b" }}>Users (total)</dt>
          <dd style={{ margin: 0 }}>{stats.users.total}</dd>
          <dt style={{ color: "#52525b" }}>Users (active)</dt>
          <dd style={{ margin: 0 }}>{stats.users.active}</dd>
          <dt style={{ color: "#52525b" }}>Documents</dt>
          <dd style={{ margin: 0 }}>{stats.documents.total}</dd>
          <dt style={{ color: "#52525b" }}>Archived documents</dt>
          <dd style={{ margin: 0 }}>{stats.documents.archived}</dd>
          <dt style={{ color: "#52525b" }}>Departments</dt>
          <dd style={{ margin: 0 }}>{stats.departments}</dd>
          <dt style={{ color: "#52525b" }}>Failed document versions</dt>
          <dd style={{ margin: 0 }}>{stats.documentVersionsFailed}</dd>
        </dl>
      ) : (
        <p style={{ color: "#71717a" }}>No data yet.</p>
      )}
    </main>
  );
}
