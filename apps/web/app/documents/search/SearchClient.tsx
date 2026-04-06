"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "../../../lib/authClient";
import { DEFAULT_USER_RESTRICTIONS, restrictedHref, type MeUserDto } from "../../../lib/restrictions";
import { API_BASE as API } from "@/lib/apiBase";
import { Spinner } from "@/components/Spinner";
import s from "./search.module.css";

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
        headers: { "Content-Type": "application/json" },
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
      <main className={s.page}>
        <div className={s.loadingWrap}>
          <Spinner size={22} />
          <span>Loading…</span>
        </div>
      </main>
    );
  }

  return (
    <main className={s.page}>
      <h1 className={s.title}>Semantic Search</h1>
      <p className={s.subtitle}>
        Your question is turned into an embedding and matched to document chunks (pgvector cosine distance).
        Open a result&#39;s title to view the full file. This is not a chatbot—there is no generated answer, only similar passages.
      </p>

      <nav className={s.nav} aria-label="Search navigation">
        <Link prefetch={false} href="/documents/ask">Ask the Knowledge Base</Link>
        <Link prefetch={false} href="/documents">Documents</Link>
        <Link prefetch={false} href="/dashboard">Dashboard</Link>
      </nav>

      <form onSubmit={(e) => void onSearch(e)} className={s.form} role="search" aria-label="Semantic search">
        <label htmlFor="search-input" className="sr-only">Search query</label>
        <input
          id="search-input"
          className={s.input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask or describe what you need…"
          aria-label="Search query"
          autoComplete="off"
        />
        <button type="submit" disabled={loading} className={s.searchBtn}>
          {loading ? <><Spinner size={16} label="Searching" /> Searching…</> : "Search"}
        </button>
      </form>

      {error && (
        <p role="alert" className={s.error}>{error}</p>
      )}

      {results && results.length === 0 && (
        <div className={s.empty}>
          <span className={s.emptyIcon} aria-hidden>🔍</span>
          <p>No matching chunks found. Upload documents and wait until processing status is READY.</p>
        </div>
      )}

      {results && results.length > 0 && (
        <ul className={s.results} aria-label={`${results.length} search results`}>
          {results.map((r) => (
            <li key={r.chunkId} className={s.resultItem}>
              <p className={s.resultMeta}>
                <Link prefetch={false} href={`/documents/${r.document.id}`} className={s.resultTitle}>
                  {r.document.title}
                </Link>
                <span className={s.resultFile}>({r.version.fileName})</span>
                <span className={s.resultChunk}>· chunk {r.chunkIndex}</span>
                <span className={s.resultScore}>· score {r.score.toFixed(4)}</span>
              </p>
              <p className={s.resultContent}>{r.content}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
