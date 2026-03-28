"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "../../../lib/authClient";
import AdminNav from "../AdminNav";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Phase = "checking" | "need-login" | "forbidden" | "load-error" | "ready";

type AuditRow = {
  id: string;
  action: string;
  createdAt: string;
  metadata: unknown;
  documentId: string | null;
  document: { id: string; title: string } | null;
  user: { id: string; email: string; name: string } | null;
};

export default function AdminDocumentAuditClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(40);
  const [total, setTotal] = useState(0);
  const [entries, setEntries] = useState<AuditRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterDraft, setFilterDraft] = useState("");
  const [appliedDocId, setAppliedDocId] = useState("");

  const loadEntries = useCallback(
    async (p: number, docId: string) => {
      setLoadError(null);
      const params = new URLSearchParams();
      params.set("page", String(p));
      params.set("pageSize", String(pageSize));
      const trimmed = docId.trim();
      if (trimmed) params.set("documentId", trimmed);
      const res = await fetchWithAuth(`${API}/admin/document-audit?${params.toString()}`);
      if (!res.ok) {
        setLoadError("Could not load audit log.");
        return;
      }
      const data = (await res.json()) as {
        total?: number;
        page?: number;
        entries?: AuditRow[];
      };
      if (!Array.isArray(data.entries)) {
        setLoadError("Invalid response from server.");
        return;
      }
      setTotal(data.total ?? 0);
      setPage(data.page ?? p);
      setEntries(data.entries);
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
        const me = (await meRes.json().catch(() => ({}))) as { user?: { role?: string } };
        if (!meRes.ok || me.user?.role !== "ADMIN") {
          if (!cancelled) setPhase("forbidden");
          return;
        }
        if (!cancelled) setPhase("ready");
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
    void loadEntries(page, appliedDocId);
  }, [phase, page, appliedDocId, loadEntries]);

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
        <h1>Document audit</h1>
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
        <h1>Document audit</h1>
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
    <main style={{ maxWidth: 960 }}>
      <h1>Document audit</h1>
      <p style={{ color: "#52525b", marginTop: 0 }}>
        Library-wide actions (uploads, edits, views, favorites, archive, delete, reprocess).
      </p>
      <AdminNav />
      <div style={{ marginBottom: "1rem", display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.9rem" }}>
          <span>Document ID</span>
          <input
            value={filterDraft}
            onChange={(e) => setFilterDraft(e.target.value)}
            placeholder="UUID (optional)"
            style={{ padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid #d4d4d8", minWidth: 280 }}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setAppliedDocId(filterDraft.trim());
            setPage(1);
          }}
          style={{ padding: "0.4rem 0.75rem", borderRadius: 6, border: "1px solid #d4d4d8", background: "#fff" }}
        >
          Apply filter
        </button>
        {appliedDocId ? (
          <button
            type="button"
            onClick={() => {
              setFilterDraft("");
              setAppliedDocId("");
              setPage(1);
            }}
            style={{ padding: "0.4rem 0.75rem", borderRadius: 6, border: "none", background: "transparent", color: "#2563eb" }}
          >
            Clear
          </button>
        ) : null}
      </div>
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
              <th style={{ padding: "0.5rem 0.35rem" }}>Action</th>
              <th style={{ padding: "0.5rem 0.35rem" }}>Document</th>
              <th style={{ padding: "0.5rem 0.35rem" }}>User</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} style={{ borderBottom: "1px solid #f4f4f5" }}>
                <td style={{ padding: "0.45rem 0.35rem", whiteSpace: "nowrap" }}>
                  {new Date(e.createdAt).toLocaleString()}
                </td>
                <td style={{ padding: "0.45rem 0.35rem" }}>{e.action}</td>
                <td style={{ padding: "0.45rem 0.35rem" }}>
                  {e.document && e.documentId ? (
                    <Link href={`/documents/${e.documentId}`} style={{ color: "#2563eb" }}>
                      {e.document.title}
                    </Link>
                  ) : e.documentId ? (
                    <span style={{ fontFamily: "monospace", fontSize: "0.82rem" }}>{e.documentId}</span>
                  ) : (
                    <span style={{ color: "#71717a" }}>—</span>
                  )}
                </td>
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
          Page {page} of {totalPages} ({total} entries)
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
    </main>
  );
}
