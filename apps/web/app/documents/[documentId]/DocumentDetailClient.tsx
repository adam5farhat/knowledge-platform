"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearStoredSession, fetchWithAuth } from "../../../lib/authClient";

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
    visibility: string;
    createdAt: string;
    createdBy: { id: string; name: string; email: string };
    versions: Version[];
  };
};

export default function DocumentDetailClient({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"loading" | "need-login" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DocumentPayload | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  async function load() {
    const res = await fetchWithAuth(`${API}/documents/${documentId}`);
    if (res.status === 401) {
      clearStoredSession();
      setPhase("need-login");
      router.replace("/login");
      return;
    }
    const body = (await res.json().catch(() => ({}))) as DocumentPayload & { error?: string };
    if (!res.ok) {
      setError(body.error ?? "Could not load document");
      setPhase("error");
      return;
    }
    setData(body);
    setPhase("ready");
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

  return (
    <main style={{ maxWidth: 900 }}>
      <h1>{doc.title}</h1>
      <p style={{ color: "#52525b", fontSize: "0.95rem" }}>
        Visibility: <strong>{doc.visibility}</strong> · Uploaded by {doc.createdBy.name} ·{" "}
        {new Date(doc.createdAt).toLocaleString()}
      </p>
      <nav style={{ margin: "1rem 0", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <Link href="/documents">Documents</Link>
        <Link href="/documents/search">Semantic search</Link>
        <Link href="/dashboard">Dashboard</Link>
      </nav>

      <section style={{ marginTop: "1rem", padding: "1rem", background: "#f4f4f5", borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>Upload new version</h2>
        <form onSubmit={onUploadVersion} style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
          <input type="file" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button
            type="submit"
            disabled={busy || !file}
            style={{
              padding: "0.5rem 0.8rem",
              borderRadius: 6,
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
                  {v.processingStatus === "FAILED" && v.processingError ? ` — ${v.processingError}` : ""}
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
                    borderRadius: 6,
                    background: "#fff",
                    cursor: downloadingId === v.id ? "wait" : "pointer",
                  }}
                >
                  {downloadingId === v.id ? "Downloading..." : "Download"}
                </button>
                {v.processingStatus === "FAILED" ? (
                  <button
                    type="button"
                    onClick={() => void onRetry(v.id)}
                    disabled={busy}
                    style={{
                      padding: "0.42rem 0.66rem",
                      border: "1px solid #d4d4d8",
                      borderRadius: 6,
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
