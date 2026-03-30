"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "../../../lib/authClient";
import { DEFAULT_USER_RESTRICTIONS, restrictedHref, type MeUserDto } from "../../../lib/restrictions";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Result = {
  chunkId: string;
  content: string;
  chunkIndex: number;
  score: number;
  document: { id: string; title: string; visibility: string };
  version: { id: string; fileName: string };
};

export default function SearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQ = searchParams?.get("q") ?? "";

  const [phase, setPhase] = useState<"checking" | "need-login" | "ready">("checking");
  const [query, setQuery] = useState(initialQ);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await getValidAccessToken();
      if (!token) {
        if (!cancelled) {
          setPhase("need-login");
          router.replace("/login");
        }
        return;
      }
      const meRes = await fetchWithAuth(`${API}/auth/me`);
      if (meRes.status === 401) {
        clearStoredSession();
        if (!cancelled) {
          setPhase("need-login");
          router.replace("/login");
        }
        return;
      }
      if (!meRes.ok) {
        if (!cancelled) setPhase("need-login");
        return;
      }
      const body = (await meRes.json()) as { user: MeUserDto };
      const r = body.user.restrictions ?? DEFAULT_USER_RESTRICTIONS;
      if (!r.accessDocumentsAllowed) {
        if (!cancelled) router.replace(restrictedHref("accessDocuments"));
        return;
      }
      if (!r.useAiQueriesAllowed) {
        if (!cancelled) router.replace(restrictedHref("useAiQueries"));
        return;
      }
      if (!cancelled) setPhase("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResults(null);
    const token = await getValidAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await fetchWithAuth(`${API}/search/semantic`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: query.trim(), limit: 15 }),
      });
      if (res.status === 401) {
        clearStoredSession();
        router.replace("/login");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        results?: Result[];
        code?: string;
        feature?: string;
      };
      if (res.status === 403 && data.code === "FEATURE_RESTRICTED" && data.feature) {
        router.replace(restrictedHref(data.feature));
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Search failed");
        return;
      }
      setResults(data.results ?? []);
    } catch {
      setError("Could not reach the API.");
    } finally {
      setLoading(false);
    }
  }

  if (phase === "checking" || phase === "need-login") {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 720 }}>
      <h1>Semantic search</h1>
      <p style={{ color: "#52525b", fontSize: "0.95rem" }}>
        Your question is turned into an embedding and matched to document chunks (pgvector cosine distance). Open a result’s
        title to view the full file. This is not a chatbot—there is no generated answer, only similar passages.
      </p>
      <nav style={{ margin: "1rem 0", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <Link prefetch={false} href="/documents">Documents</Link>
        <Link prefetch={false} href="/dashboard">Dashboard</Link>
      </nav>

      <form onSubmit={(e) => void onSearch(e)} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1rem" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask or describe what you need…"
          style={{
            flex: "1 1 240px",
            padding: "0.5rem 0.6rem",
            borderRadius: 0,
            border: "1px solid #d4d4d8",
          }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: 0,
            border: "none",
            background: "#18181b",
            color: "#fafafa",
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error ? (
        <p role="alert" style={{ color: "#b91c1c", marginTop: "1rem" }}>
          {error}
        </p>
      ) : null}

      {results && results.length === 0 ? (
        <p style={{ marginTop: "1rem", color: "#71717a" }}>No matching chunks yet. Upload documents and wait until status is READY.</p>
      ) : null}

      {results && results.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, marginTop: "1.25rem" }}>
          {results.map((r) => (
            <li
              key={r.chunkId}
              style={{
                marginBottom: "1rem",
                padding: "1rem",
                background: "#f4f4f5",
                borderRadius: 0,
              }}
            >
              <p style={{ margin: "0 0 0.35rem", fontSize: "0.85rem", color: "#52525b" }}>
                <Link prefetch={false} href={`/documents/${r.document.id}`} style={{ fontWeight: 600, color: "#18181b" }}>
                  {r.document.title}
                </Link>
                <span style={{ marginLeft: "0.5rem" }}>({r.version.fileName})</span>
                <span style={{ marginLeft: "0.5rem" }}>· chunk {r.chunkIndex}</span>
                <span style={{ marginLeft: "0.5rem" }}>· score {r.score.toFixed(4)}</span>
              </p>
              <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{r.content}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
