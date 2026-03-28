"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "../../../lib/authClient";
import AdminNav from "../AdminNav";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Phase = "checking" | "need-login" | "forbidden" | "ready";

export default function AdminDocumentsClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [exportQ, setExportQ] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [bulkIds, setBulkIds] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [bulkErr, setBulkErr] = useState<string | null>(null);

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
        if (!cancelled) setPhase("ready");
      } catch {
        if (!cancelled) setPhase("forbidden");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onExportCsv() {
    setExportErr(null);
    setExportBusy(true);
    try {
      const params = new URLSearchParams();
      params.set("libraryScope", "ALL");
      if (exportQ.trim()) params.set("q", exportQ.trim());
      if (includeArchived) params.set("includeArchived", "1");
      const res = await fetchWithAuth(`${API}/documents/export?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setExportErr(body.error ?? `Export failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "documents-export.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportErr("Could not download export.");
    } finally {
      setExportBusy(false);
    }
  }

  async function onBulkDelete() {
    setBulkErr(null);
    setBulkMsg(null);
    const raw = bulkIds
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const ids = raw.filter((id) => uuidRe.test(id));
    if (ids.length === 0) {
      setBulkErr("Enter at least one valid document UUID.");
      return;
    }
    if (ids.length > 50) {
      setBulkErr("You can delete at most 50 documents per request. Split into multiple batches.");
      return;
    }
    if (!window.confirm(`Permanently delete ${ids.length} document(s)? This cannot be undone.`)) {
      return;
    }
    setBulkBusy(true);
    try {
      const res = await fetchWithAuth(`${API}/documents/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; deleted?: number };
      if (!res.ok) {
        setBulkErr(data.error ?? "Bulk delete failed.");
        return;
      }
      setBulkMsg(`Deleted ${data.deleted ?? ids.length} document(s).`);
      setBulkIds("");
    } catch {
      setBulkErr("Could not reach the API.");
    } finally {
      setBulkBusy(false);
    }
  }

  if (phase === "checking") {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }

  if (phase === "need-login") {
    return (
      <main style={{ maxWidth: 560 }}>
        <h1>Document tools</h1>
        <p style={{ color: "#52525b" }}>Sign in to continue.</p>
        <Link href="/login">Sign in</Link>
      </main>
    );
  }

  if (phase === "forbidden") {
    return (
      <main style={{ maxWidth: 560 }}>
        <h1>Document tools</h1>
        <p style={{ color: "var(--error)" }}>Administrators only.</p>
        <Link href="/dashboard">Dashboard</Link>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 640 }}>
      <h1>Document tools</h1>
      <p style={{ color: "#52525b", marginTop: 0 }}>
        Export the full document library (admins see every document) or permanently remove multiple documents by ID.
      </p>
      <AdminNav />

      <section style={{ marginTop: "1.5rem", padding: "1rem", border: "1px solid #e4e4e7", borderRadius: 8 }}>
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>CSV export</h2>
        <p style={{ color: "#52525b", fontSize: "0.9rem", marginTop: 0 }}>
          Exports up to 5,000 rows with the current filters. Use “Include archived” to add archived files when the library
          scope is “all”.
        </p>
        <label style={{ display: "grid", gap: 6, marginBottom: "0.75rem" }}>
          <span>Optional title or description search</span>
          <input
            value={exportQ}
            onChange={(e) => setExportQ(e.target.value)}
            style={{ padding: "0.5rem 0.6rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
          />
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: "0.75rem" }}>
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          <span>Include archived documents</span>
        </label>
        {exportErr ? (
          <p role="alert" style={{ color: "var(--error)" }}>
            {exportErr}
          </p>
        ) : null}
        <button
          type="button"
          disabled={exportBusy}
          onClick={() => void onExportCsv()}
          style={{
            padding: "0.55rem 1rem",
            borderRadius: 6,
            border: "none",
            background: "#18181b",
            color: "#fafafa",
            cursor: exportBusy ? "wait" : "pointer",
          }}
        >
          {exportBusy ? "Downloading…" : "Download CSV"}
        </button>
      </section>

      <section style={{ marginTop: "1.25rem", padding: "1rem", border: "1px solid #fecaca", borderRadius: 8 }}>
        <h2 style={{ marginTop: 0, fontSize: "1.05rem", color: "#991b1b" }}>Bulk delete</h2>
        <p style={{ color: "#52525b", fontSize: "0.9rem", marginTop: 0 }}>
          Paste document IDs (UUID), separated by commas or new lines. Maximum 50 per request. Storage files are removed.
        </p>
        <textarea
          value={bulkIds}
          onChange={(e) => setBulkIds(e.target.value)}
          rows={5}
          placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "0.5rem 0.6rem",
            borderRadius: 6,
            border: "1px solid #d4d4d8",
            fontFamily: "monospace",
            fontSize: "0.85rem",
          }}
        />
        {bulkErr ? (
          <p role="alert" style={{ color: "var(--error)" }}>
            {bulkErr}
          </p>
        ) : null}
        {bulkMsg ? (
          <p role="status" style={{ color: "#15803d" }}>
            {bulkMsg}
          </p>
        ) : null}
        <button
          type="button"
          disabled={bulkBusy}
          onClick={() => void onBulkDelete()}
          style={{
            marginTop: "0.5rem",
            padding: "0.55rem 1rem",
            borderRadius: 6,
            border: "none",
            background: "#b91c1c",
            color: "#fff",
            cursor: bulkBusy ? "wait" : "pointer",
          }}
        >
          {bulkBusy ? "Deleting…" : "Delete documents"}
        </button>
      </section>

      <p style={{ marginTop: "1.25rem" }}>
        <Link href="/documents">Open document library</Link>
      </p>
    </main>
  );
}
