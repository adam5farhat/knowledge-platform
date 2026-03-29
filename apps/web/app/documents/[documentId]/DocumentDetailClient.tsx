"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearStoredSession, fetchWithAuth } from "../../../lib/authClient";
import { restrictedHref } from "../../../lib/restrictions";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Version = {
  id: string;
  versionNumber: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  processingStatus: string;
  processingError: string | null;
  createdAt: string;
};

type DocumentPayload = {
  document: {
    id: string;
    title: string;
    description?: string | null;
    visibility: string;
    departmentId?: string | null;
    isArchived?: boolean;
    createdAt: string;
    updatedAt?: string;
    createdBy: { id: string; name: string; email: string };
    tags: string[];
    versions: Version[];
  };
  canManage?: boolean;
  canViewAudit?: boolean;
};

type AuditEntry = {
  id: string;
  action: string;
  metadata: unknown;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
};

export default function DocumentDetailClient({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"loading" | "need-login" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DocumentPayload | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState("");
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);

  async function load() {
    const res = await fetchWithAuth(`${API}/documents/${documentId}`);
    if (res.status === 401) {
      clearStoredSession();
      setPhase("need-login");
      router.replace("/login");
      return;
    }
    const body = (await res.json().catch(() => ({}))) as DocumentPayload & {
      error?: string;
      code?: string;
      feature?: string;
    };
    if (res.status === 403 && body.code === "FEATURE_RESTRICTED" && body.feature) {
      router.replace(restrictedHref(body.feature));
      return;
    }
    if (!res.ok) {
      setError(body.error ?? "Could not load document");
      setPhase("error");
      return;
    }
    setData(body);
    setDescDraft(body.document.description?.trim() ?? "");
    setAuditEntries([]);
    if (body.canViewAudit) {
      void loadAuditFor(documentId);
    }
    setPhase("ready");
  }

  async function loadAuditFor(id: string) {
    const res = await fetchWithAuth(`${API}/documents/${id}/audit`);
    if (!res.ok) return;
    const body = (await res.json()) as { entries?: AuditEntry[] };
    setAuditEntries(body.entries ?? []);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  async function onUploadVersion(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetchWithAuth(`${API}/documents/${documentId}/versions`, {
        method: "POST",
        body: fd,
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Upload version failed");
        return;
      }
      setFile(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function onRetry(versionId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API}/documents/${documentId}/versions/${versionId}/reprocess`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Retry failed");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveDescription() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API}/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: descDraft.trim() || null }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Could not save description");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function onDownload(versionId: string, fileName: string) {
    setDownloadingId(versionId);
    try {
      const res = await fetchWithAuth(`${API}/documents/${documentId}/versions/${versionId}/file`);
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Download failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingId(null);
    }
  }

  if (phase === "loading" || phase === "need-login") {
    return (
      <main>
        <p>Loading...</p>
      </main>
    );
  }

  if (phase === "error" || !data) {
    return (
      <main>
        <p style={{ color: "var(--error)" }}>{error ?? "Unable to load document"}</p>
        <p>
          <Link href="/documents">Back to documents</Link>
        </p>
      </main>
    );
  }

  const doc = data.document;
  const canManage = data.canManage ?? false;
  const canViewAudit = data.canViewAudit ?? false;

  return (
    <main style={{ maxWidth: 900 }}>
      <h1>{doc.title}</h1>
      <p style={{ color: "#52525b", fontSize: "0.95rem" }}>
        Visibility: <strong>{doc.visibility}</strong> · Uploaded by {doc.createdBy.name} ·{" "}
        {new Date(doc.createdAt).toLocaleString()}
        {doc.isArchived ? (
          <>
            {" "}
            · <strong style={{ color: "#64748b" }}>Archived</strong> (hidden from the main library for everyone)
          </>
        ) : null}
      </p>
      {doc.tags && doc.tags.length > 0 ? (
        <div style={{ marginTop: "0.65rem", display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.82rem", color: "#52525b", marginRight: "0.15rem" }}>Tags:</span>
          {doc.tags.map((t) => (
            <span
              key={t}
              style={{
                fontSize: "0.78rem",
                fontWeight: 600,
                padding: "0.2rem 0.45rem",
                borderRadius: 0,
                background: "#eef2ff",
                color: "#4338ca",
                border: "1px solid #c7d2fe",
              }}
            >
              {t}
            </span>
          ))}
        </div>
      ) : null}
      <nav style={{ margin: "1rem 0", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <Link href="/documents">Documents</Link>
        <Link href="/documents/search">Semantic search</Link>
        <Link href="/dashboard">Dashboard</Link>
      </nav>

      <section style={{ marginTop: "1rem", padding: "1rem", background: "#f4f4f5", borderRadius: 0 }}>
        <h2 style={{ marginTop: 0 }}>Description</h2>
        {canManage ? (
          <>
            <textarea
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              rows={5}
              style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box", padding: "0.5rem", fontFamily: "inherit" }}
              placeholder="Optional summary or notes for this document…"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveDescription()}
              style={{
                marginTop: "0.5rem",
                padding: "0.45rem 0.85rem",
                borderRadius: 0,
                border: "none",
                background: "#18181b",
                color: "#fff",
                cursor: busy ? "wait" : "pointer",
              }}
            >
              {busy ? "Saving…" : "Save description"}
            </button>
          </>
        ) : doc.description?.trim() ? (
          <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.5, color: "#3f3f46" }}>{doc.description.trim()}</p>
        ) : (
          <p style={{ margin: 0, color: "#71717a", fontSize: "0.9rem" }}>No description.</p>
        )}
      </section>

      {canViewAudit ? (
        <section style={{ marginTop: "1rem", padding: "1rem", background: "#fafafa", borderRadius: 0, border: "1px solid #e4e4e7" }}>
          <h2 style={{ marginTop: 0 }}>Activity</h2>
          {auditEntries.length === 0 ? (
            <p style={{ color: "#71717a", fontSize: "0.9rem" }}>No audit entries yet.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "0.88rem" }}>
              {auditEntries.map((e) => (
                <li
                  key={e.id}
                  style={{
                    padding: "0.45rem 0",
                    borderBottom: "1px solid #e4e4e7",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.35rem",
                    justifyContent: "space-between",
                  }}
                >
                  <span>
                    <strong>{e.action}</strong>
                    {e.user ? (
                      <span style={{ color: "#52525b" }}>
                        {" "}
                        · {e.user.name ?? e.user.email}
                      </span>
                    ) : null}
                  </span>
                  <time style={{ color: "#71717a" }} dateTime={e.createdAt}>
                    {new Date(e.createdAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {canManage ? (
        <section style={{ marginTop: "1rem", padding: "1rem", background: "#f4f4f5", borderRadius: 0 }}>
          <h2 style={{ marginTop: 0 }}>Upload new version</h2>
          <form onSubmit={onUploadVersion} style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
            <input type="file" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <button
              type="submit"
              disabled={busy || !file}
              style={{
                padding: "0.5rem 0.8rem",
                borderRadius: 0,
                border: "none",
                background: "#18181b",
                color: "#fff",
                cursor: busy ? "wait" : "pointer",
              }}
            >
              {busy ? "Uploading..." : "Upload version"}
            </button>
          </form>
        </section>
      ) : null}

      {error ? (
        <p role="alert" style={{ color: "var(--error)", marginTop: "1rem" }}>
          {error}
        </p>
      ) : null}

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Versions</h2>
        {doc.versions.length === 0 ? <p>No versions found.</p> : null}
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {doc.versions.map((v) => (
            <li
              key={v.id}
              style={{
                borderBottom: "1px solid #e4e4e7",
                padding: "0.75rem 0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "1rem",
                flexWrap: "wrap",
              }}
            >
              <div>
                <div>
                  <strong>v{v.versionNumber}</strong> · {v.fileName}
                </div>
                <div style={{ fontSize: "0.87rem", color: "#52525b", marginTop: 4 }}>
                  {Math.round(v.sizeBytes / 1024)} KB · {v.processingStatus}
                  {canManage && v.processingStatus === "FAILED" && v.processingError ? ` — ${v.processingError}` : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.55rem" }}>
                <button
                  type="button"
                  onClick={() => void onDownload(v.id, v.fileName)}
                  disabled={downloadingId === v.id}
                  style={{
                    padding: "0.42rem 0.66rem",
                    border: "1px solid #d4d4d8",
                    borderRadius: 0,
                    background: "#fff",
                    cursor: downloadingId === v.id ? "wait" : "pointer",
                  }}
                >
                  {downloadingId === v.id ? "Downloading..." : "Download"}
                </button>
                {canManage && v.processingStatus === "FAILED" ? (
                  <button
                    type="button"
                    onClick={() => void onRetry(v.id)}
                    disabled={busy}
                    style={{
                      padding: "0.42rem 0.66rem",
                      border: "1px solid #d4d4d8",
                      borderRadius: 0,
                      background: "#fff",
                      cursor: busy ? "wait" : "pointer",
                    }}
                  >
                    Retry processing
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
