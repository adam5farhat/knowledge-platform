"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { UserAvatarNavButton } from "@/components/UserAvatarNavButton";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "../../../lib/authClient";
import { DEFAULT_USER_RESTRICTIONS, restrictedHref, type MeUserDto } from "../../../lib/restrictions";
import styles from "./ask.module.css";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type ConfidenceLevel = "high" | "low" | "none";

type Source = {
  index: number;
  chunkId: string;
  content: string;
  chunkIndex: number;
  sectionTitle?: string | null;
  score: number;
  document: { id: string; title: string; visibility: string };
  version: { fileName: string };
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  confidence?: ConfidenceLevel;
  streaming?: boolean;
};

type ConversationSummary = {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
};

const EXAMPLE_QUERIES = [
  "What are the quantity tolerance rules?",
  "Summarise the buyer's claim obligations",
  "What happens in case of force majeure?",
  "Compare quality vs quantity claim deadlines",
];

export default function AskClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<"checking" | "need-login" | "ready">("checking");
  const [user, setUser] = useState<MeUserDto | null>(null);

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(() => new Set());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await getValidAccessToken();
      if (!token) { if (!cancelled) { setPhase("need-login"); router.replace("/login"); } return; }
      const meRes = await fetchWithAuth(`${API}/auth/me`);
      if (meRes.status === 401) { clearStoredSession(); if (!cancelled) { setPhase("need-login"); router.replace("/login"); } return; }
      if (!meRes.ok) { if (!cancelled) setPhase("need-login"); return; }
      const body = (await meRes.json()) as { user: MeUserDto };
      const r = body.user.restrictions ?? DEFAULT_USER_RESTRICTIONS;
      if (!r.accessDocumentsAllowed) { if (!cancelled) router.replace(restrictedHref("accessDocuments")); return; }
      if (!r.useAiQueriesAllowed) { if (!cancelled) router.replace(restrictedHref("useAiQueries")); return; }
      if (!cancelled) { setUser(body.user); setPhase("ready"); }
    })();
    return () => { cancelled = true; };
  }, [router]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${API}/conversations`);
      if (res.ok) {
        const data = (await res.json()) as { conversations: ConversationSummary[] };
        setConversations(data.conversations);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (phase === "ready") void loadConversations();
  }, [phase, loadConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function signOut() {
    const refreshToken = localStorage.getItem("kp_refresh_token");
    if (refreshToken) {
      try {
        await fetch(`${API}/auth/logout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken }) });
      } catch { /* best-effort */ }
    }
    clearStoredSession();
    router.replace("/login");
    router.refresh();
  }

  const buildHistory = useCallback((): Array<{ role: "user" | "assistant"; content: string }> => {
    return messages
      .filter((m) => !m.streaming && m.content.length > 0)
      .map((m) => ({ role: m.role, content: m.content }));
  }, [messages]);

  async function loadConversation(convId: string) {
    try {
      const res = await fetchWithAuth(`${API}/conversations/${convId}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        conversation: {
          id: string;
          title: string;
          messages: Array<{
            id: string; role: string; content: string;
            sources: Source[] | null; confidence: string | null;
          }>;
        };
      };
      setActiveConvId(data.conversation.id);
      setMessages(
        data.conversation.messages.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          sources: m.sources ?? undefined,
          confidence: (m.confidence as ConfidenceLevel) ?? undefined,
        })),
      );
      setExpandedSources(new Set());
      setError(null);
    } catch { /* ignore */ }
  }

  async function saveMessage(convId: string, msg: { role: string; content: string; sources?: unknown; confidence?: string }) {
    try {
      await fetchWithAuth(`${API}/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(msg),
      });
    } catch { /* ignore */ }
  }

  async function autoTitle(convId: string, question: string) {
    const title = question.length > 60 ? question.slice(0, 57) + "..." : question;
    try {
      await fetchWithAuth(`${API}/conversations/${convId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      void loadConversations();
    } catch { /* ignore */ }
  }

  async function submitQuestion(question: string) {
    if (!question || loading) return;
    setError(null);
    setInput("");

    let convId = activeConvId;
    if (!convId) {
      try {
        const res = await fetchWithAuth(`${API}/conversations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (res.ok) {
          const data = (await res.json()) as { conversation: { id: string } };
          convId = data.conversation.id;
          setActiveConvId(convId);
        }
      } catch { /* ignore */ }
    }

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: question };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = { id: assistantId, role: "assistant", content: "", streaming: true };
    const history = buildHistory();
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setLoading(true);

    if (convId) void saveMessage(convId, { role: "user", content: question });
    if (convId && messages.length === 0) void autoTitle(convId, question);

    try {
      const token = await getValidAccessToken();
      if (!token) { router.replace("/login"); return; }

      const res = await fetch(`${API}/search/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question, history }),
      });

      if (res.status === 401) { clearStoredSession(); router.replace("/login"); return; }
      if (res.status === 403) {
        const data = (await res.json().catch(() => ({}))) as { code?: string; feature?: string };
        if (data.code === "FEATURE_RESTRICTED" && data.feature) { router.replace(restrictedHref(data.feature)); return; }
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Request failed.");
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        return;
      }

      const contentType = res.headers.get("content-type") ?? "";
      let finalSources: Source[] | undefined;
      let finalConfidence: ConfidenceLevel | undefined;
      let finalContent = "";

      if (contentType.includes("text/event-stream")) {
        const reader = res.body?.getReader();
        if (!reader) { setError("Could not read response stream."); return; }
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          let currentEvent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) { currentEvent = line.slice(7).trim(); }
            else if (line.startsWith("data: ")) {
              const raw = line.slice(6);
              try {
                const data = JSON.parse(raw) as Record<string, unknown>;
                if (currentEvent === "sources") {
                  finalSources = Array.isArray(data.sources) ? (data.sources as Source[]) : undefined;
                  finalConfidence = (data.confidence as ConfidenceLevel) ?? "high";
                  setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, sources: finalSources, confidence: finalConfidence } : m));
                } else if (currentEvent === "token" && typeof data.token === "string") {
                  finalContent += data.token;
                  setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: m.content + data.token } : m));
                }
              } catch { /* skip */ }
              currentEvent = "";
            }
          }
        }
        setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, streaming: false } : m));
      } else {
        const data = (await res.json()) as { answer?: string; sources?: Source[] };
        finalContent = data.answer ?? "";
        finalSources = data.sources;
        setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: finalContent, sources: finalSources, streaming: false } : m));
      }

      if (convId && finalContent) {
        void saveMessage(convId, { role: "assistant", content: finalContent, sources: finalSources, confidence: finalConfidence });
        void loadConversations();
      }
    } catch {
      setError("Could not reach the server.");
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleSubmit(e: React.FormEvent) { e.preventDefault(); void submitQuestion(input.trim()); }
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submitQuestion(input.trim()); }
  }

  function newConversation() {
    setActiveConvId(null);
    setMessages([]);
    setError(null);
    setExpandedSources(new Set());
    inputRef.current?.focus();
  }

  function toggleSources(msgId: string) {
    setExpandedSources((prev) => { const next = new Set(prev); if (next.has(msgId)) next.delete(msgId); else next.add(msgId); return next; });
  }

  async function copyAnswer(msgId: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(msgId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { /* ignore */ }
  }

  async function deleteConversation(convId: string) {
    try {
      await fetchWithAuth(`${API}/conversations/${convId}`, { method: "DELETE" });
      if (activeConvId === convId) newConversation();
      void loadConversations();
    } catch { /* ignore */ }
  }

  if (phase === "checking" || phase === "need-login") {
    return <main data-ask-fullscreen="true" style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" }}><p>Loading...</p></main>;
  }

  const isManagerOrAdmin = user && (user.role === "ADMIN" || user.role === "MANAGER");

  return (
    <div className={styles.shell} data-ask-fullscreen="true">
      {/* ── Sidebar ── */}
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`}>
        <div className={styles.sidebarHeader}>
          <button type="button" className={styles.newChatBtn} onClick={newConversation}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
            New chat
          </button>
        </div>
        <div className={styles.sidebarList}>
          {conversations.map((c) => (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              className={`${styles.convItem} ${activeConvId === c.id ? styles.convItemActive : ""}`}
              onClick={() => void loadConversation(c.id)}
              onKeyDown={(e) => { if (e.key === "Enter") void loadConversation(c.id); }}
              title={c.title}
            >
              <svg className={styles.convIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              <span className={styles.convTitle}>{c.title}</span>
              <button
                type="button"
                className={styles.convDelete}
                onClick={(e) => { e.stopPropagation(); void deleteConversation(c.id); }}
                title="Delete"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
              </button>
            </div>
          ))}
          {conversations.length === 0 && (
            <p className={styles.sidebarEmpty}>No conversations yet</p>
          )}
        </div>
        <div className={styles.sidebarFooter}>
          <Link prefetch={false} href="/documents" className={styles.sidebarLink}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Documents
          </Link>
          <Link prefetch={false} href="/dashboard" className={styles.sidebarLink}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            Dashboard
          </Link>
        </div>
      </aside>

      {/* ── Main area ── */}
      <main className={styles.mainArea}>
        {/* ── Navbar (platform style) ── */}
        <header className={styles.navbar}>
          <nav className={styles.navLeft} aria-label="Primary">
            <button type="button" className={styles.menuBtn} onClick={() => setSidebarOpen((v) => !v)} title="Toggle sidebar">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18" /></svg>
            </button>
            <a className={styles.brand} href="/dashboard">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.brandMark} src="/logo-swapped.svg" alt="Platform" />
            </a>
          </nav>

          <div className={styles.profileWrap} ref={menuRef}>
            <UserAvatarNavButton
              className={styles.profileBtn}
              imgClassName={styles.profileBtnImg}
              pictureUrl={user?.profilePictureUrl}
              name={user?.name ?? ""}
              email={user?.email}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              title={`${user?.name} (${user?.role})`}
            />
            {menuOpen && (
              <div className={styles.menu} role="menu">
                <div className={styles.menuHeader}>
                  <div>{user?.name}</div>
                  <div>{user?.email}</div>
                </div>
                <Link prefetch={false} className={styles.menuItem} href="/profile" role="menuitem" onClick={() => setMenuOpen(false)}>
                  View Profile
                </Link>
                {isManagerOrAdmin && (
                  <Link prefetch={false} className={styles.menuItem} href="/dashboard" role="menuitem" onClick={() => setMenuOpen(false)}>
                    Dashboard
                  </Link>
                )}
                {user?.role === "MANAGER" && (
                  <Link prefetch={false} className={styles.menuItem} href="/manager" role="menuitem" onClick={() => setMenuOpen(false)}>
                    Department overview
                  </Link>
                )}
                {user?.role === "ADMIN" && (
                  <>
                    <Link prefetch={false} className={styles.menuItem} href="/admin" role="menuitem" onClick={() => setMenuOpen(false)}>Admin hub</Link>
                    <Link prefetch={false} className={styles.menuItem} href="/admin/users" role="menuitem" onClick={() => setMenuOpen(false)}>Users</Link>
                    <Link prefetch={false} className={styles.menuItem} href="/admin/departments" role="menuitem" onClick={() => setMenuOpen(false)}>Departments</Link>
                    <Link prefetch={false} className={styles.menuItem} href="/admin/documents" role="menuitem" onClick={() => setMenuOpen(false)}>Document tools</Link>
                    <Link prefetch={false} className={styles.menuItem} href="/admin/activity" role="menuitem" onClick={() => setMenuOpen(false)}>Sign-in activity</Link>
                    <Link prefetch={false} className={styles.menuItem} href="/admin/document-audit" role="menuitem" onClick={() => setMenuOpen(false)}>Document audit</Link>
                    <Link prefetch={false} className={styles.menuItem} href="/admin/system" role="menuitem" onClick={() => setMenuOpen(false)}>System stats</Link>
                  </>
                )}
                <button type="button" className={styles.menuItem} onClick={() => { setMenuOpen(false); void signOut(); }} role="menuitem">
                  Logout
                </button>
              </div>
            )}
          </div>
        </header>

        {/* ── Chat area ── */}
        <div className={styles.chatArea}>
          {messages.length === 0 ? (
            <div className={styles.welcome}>
              <div className={styles.welcomeIcon}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h1 className={styles.welcomeTitle}>What can I help you find?</h1>
              <p className={styles.welcomeSub}>
                Ask questions about your documents. I&apos;ll find the relevant sections and give you a precise answer with citations.
              </p>
              <div className={styles.examples}>
                {EXAMPLE_QUERIES.map((q) => (
                  <button key={q} type="button" className={styles.exampleBtn} onClick={() => void submitQuestion(q)} disabled={loading}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className={styles.messageList}>
              {messages.map((msg) => {
                const isAssistant = msg.role === "assistant";
                const inner = (
                  <div className={styles.messageInner}>
                    <div className={styles.avatar}>
                      {msg.role === "user" ? (
                        <div className={styles.avatarUser}>{user?.name?.[0]?.toUpperCase() ?? "U"}</div>
                      ) : (
                        <div className={styles.avatarAssistant}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className={styles.messageContent}>
                      <div className={styles.messageHeader}>
                        <span className={styles.messageRole}>{msg.role === "user" ? "You" : "Assistant"}</span>
                      </div>
                      <div className={styles.messageBody}>
                        {isAssistant ? (
                          <div className={styles.markdown}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {msg.content || (msg.streaming ? "" : "...")}
                            </ReactMarkdown>
                            {msg.streaming && <span className={styles.cursor} />}
                          </div>
                        ) : (
                          <p>{msg.content}</p>
                        )}
                      </div>

                      {isAssistant && !msg.streaming && msg.content && (
                        <div className={styles.messageActions}>
                          <button type="button" className={styles.copyBtn} onClick={() => void copyAnswer(msg.id, msg.content)}>
                            {copiedId === msg.id ? (
                              <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg> Copied</>
                            ) : (
                              <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</>
                            )}
                          </button>
                        </div>
                      )}

                      {isAssistant && !msg.streaming && msg.confidence === "low" && (
                        <p className={styles.lowConfidence}>
                          Low relevance — the answer above may be incomplete or imprecise.
                        </p>
                      )}

                      {isAssistant && msg.sources && msg.sources.length > 0 && !msg.streaming && (
                        <div className={styles.sourcesWrap}>
                          <button type="button" className={styles.sourcesToggle} onClick={() => toggleSources(msg.id)}>
                            {expandedSources.has(msg.id) ? `Hide sources (${msg.sources.length})` : `Show sources (${msg.sources.length})`}
                          </button>
                          {expandedSources.has(msg.id) && (
                            <div className={styles.sourcesGrid}>
                              {msg.sources.map((s) => (
                                <div key={s.chunkId} className={styles.sourceCard}>
                                  <div className={styles.sourceCardHeader}>
                                    <span className={styles.sourceBadge}>[{s.index}]</span>
                                    <Link prefetch={false} href={`/documents/${s.document.id}`} className={styles.sourceTitle}>
                                      {s.document.title}
                                    </Link>
                                    <span className={styles.sourceScore}>{(s.score * 100).toFixed(0)}%</span>
                                  </div>
                                  <p className={styles.sourceMeta}>
                                    {s.sectionTitle ? `${s.sectionTitle} — ${s.version.fileName}` : `${s.version.fileName} · section ${s.chunkIndex + 1}`}
                                  </p>
                                  <p className={styles.sourceSnippet}>
                                    {s.content.length > 200 ? `${s.content.slice(0, 200)}...` : s.content}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );

                return isAssistant ? (
                  <div key={msg.id} className={styles.messageRowAssistant}>
                    {inner}
                  </div>
                ) : (
                  <div key={msg.id} className={styles.messageRow}>
                    {inner}
                  </div>
                );
              })}

              {loading && messages[messages.length - 1]?.content === "" && (
                <div className={styles.thinkingRow}>
                  <div className={styles.thinkingDots}><span /><span /><span /></div>
                  <span>Searching documents...</span>
                </div>
              )}
            </div>
          )}
          {error && <p className={styles.error}>{error}</p>}
          <div ref={bottomRef} />
        </div>

        {/* ── Input bar ── */}
        <div className={styles.inputBar}>
          <form onSubmit={handleSubmit} className={styles.inputInner}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={messages.length > 0 ? "Ask a follow-up..." : "Ask a question about your documents..."}
              className={styles.inputField}
              disabled={loading}
              aria-label="Ask a question"
              autoComplete="off"
              rows={1}
            />
            <button type="submit" disabled={loading || !input.trim()} className={styles.sendBtn} title="Send">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22l-4-9-9-4z" />
              </svg>
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
