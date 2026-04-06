"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ProfileAvatarImage } from "@/components/ProfileAvatarImage";
import { profilePictureDisplayUrl, userInitialsFromName } from "@/lib/profilePicture";
import { fetchWithAuth } from "../../../lib/authClient";
import dash from "../../components/shellNav.module.css";
import { useToast } from "@/components/Toast";
import { AdminChromeHeader } from "../AdminChromeHeader";
import { AdminHubGlyph, type AdminHubGlyphType } from "../AdminHubIcons";
import { useAdminGuard } from "../useAdminGuard";
import u from "../users/adminUsers.module.css";
import styles from "./adminDocumentAudit.module.css";
import { API_BASE as API } from "@/lib/apiBase";
const PAGE_SIZE = 40;

const ADMIN_SIDEBAR_LINKS: { href: string; label: string; icon: AdminHubGlyphType }[] = [
  { href: "/admin", label: "Hub", icon: "hub" },
  { href: "/admin/users", label: "Users", icon: "users" },
  { href: "/admin/departments", label: "Departments", icon: "departments" },
  { href: "/admin/documents", label: "Documents", icon: "documents" },
  { href: "/admin/activity", label: "Activity", icon: "activity" },
  { href: "/admin/document-audit", label: "Doc audit", icon: "audit" },
  { href: "/admin/system", label: "System", icon: "system" },
];

function adminNavActive(href: string, pathname: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function ToolbarIconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.25" />
      <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

const AUDIT_ACTIONS = [
  "CREATED",
  "VERSION_UPLOADED",
  "UPDATED",
  "DELETED",
  "FAVORITED",
  "UNFAVORITED",
  "ARCHIVED",
  "UNARCHIVED",
  "VIEWED",
  "REPROCESS_REQUESTED",
  "BULK_DELETED",
] as const;

function auditActionLabel(a: string): string {
  return a
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function auditPillClass(a: string): string {
  if (a === "DELETED" || a === "BULK_DELETED") {
    return `${styles.eventPill} ${styles.eventErr}`;
  }
  if (a === "REPROCESS_REQUESTED") {
    return `${styles.eventPill} ${styles.eventWarn}`;
  }
  if (a === "CREATED" || a === "UNARCHIVED" || a === "VERSION_UPLOADED") {
    return `${styles.eventPill} ${styles.eventOk}`;
  }
  return styles.eventPill;
}

type AuditRow = {
  id: string;
  action: string;
  createdAt: string;
  metadata: unknown;
  documentId: string | null;
  document: { id: string; title: string } | null;
  user: { id: string; email: string; name: string; profilePictureUrl?: string | null } | null;
};

function metadataPretty(meta: unknown): string {
  if (meta == null || meta === undefined) return "—";
  try {
    return JSON.stringify(meta, null, 2);
  } catch {
    return String(meta);
  }
}

export default function AdminDocumentAuditClient() {
  const router = useRouter();
  const pathname = usePathname();
  const detailTitleId = useId();
  const { toast } = useToast();
  const { phase, sessionUser } = useAdminGuard();
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [entries, setEntries] = useState<AuditRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterUserId, setFilterUserId] = useState("");
  const [filterDocumentId, setFilterDocumentId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortNewestFirst, setSortNewestFirst] = useState(true);

  const [detailEntry, setDetailEntry] = useState<AuditRow | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  const urlHydratedRef = useRef(false);
  const [urlReady, setUrlReady] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(searchInput.trim()), 320);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, filterAction, filterUserId, filterDocumentId, fromDate, toDate, sortNewestFirst]);

  const buildListParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    if (debouncedQ) params.set("q", debouncedQ);
    if (filterAction) params.set("action", filterAction);
    if (filterUserId.trim()) params.set("userId", filterUserId.trim());
    if (filterDocumentId.trim()) params.set("documentId", filterDocumentId.trim());
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    if (!sortNewestFirst) params.set("sort", "createdAt_asc");
    return params;
  }, [
    page,
    debouncedQ,
    filterAction,
    filterUserId,
    filterDocumentId,
    fromDate,
    toDate,
    sortNewestFirst,
  ]);

  const buildExportParams = useCallback(() => {
    const params = new URLSearchParams();
    if (debouncedQ) params.set("q", debouncedQ);
    if (filterAction) params.set("action", filterAction);
    if (filterUserId.trim()) params.set("userId", filterUserId.trim());
    if (filterDocumentId.trim()) params.set("documentId", filterDocumentId.trim());
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    if (!sortNewestFirst) params.set("sort", "createdAt_asc");
    return params;
  }, [debouncedQ, filterAction, filterUserId, filterDocumentId, fromDate, toDate, sortNewestFirst]);

  useEffect(() => {
    if (phase !== "ready" || urlHydratedRef.current) return;
    urlHydratedRef.current = true;
    try {
      const sp = new URLSearchParams(window.location.search);
      const q = sp.get("q");
      if (q) setSearchInput(q);
      const act = sp.get("action");
      if (act && (AUDIT_ACTIONS as readonly string[]).includes(act)) setFilterAction(act);
      const uid = sp.get("userId");
      if (uid) setFilterUserId(uid);
      const did = sp.get("documentId");
      if (did) setFilterDocumentId(did);
      const from = sp.get("from");
      if (from) setFromDate(from);
      const to = sp.get("to");
      if (to) setToDate(to);
      if (sp.get("sort") === "createdAt_asc") setSortNewestFirst(false);
      const pg = Number.parseInt(sp.get("page") ?? "1", 10);
      if (!Number.isNaN(pg) && pg >= 1) setPage(pg);
    } catch {
      /* ignore */
    }
    setUrlReady(true);
  }, [phase]);

  useEffect(() => {
    if (phase !== "ready" || !urlReady) return;
    const p = new URLSearchParams();
    if (debouncedQ) p.set("q", debouncedQ);
    if (filterAction) p.set("action", filterAction);
    if (filterUserId.trim()) p.set("userId", filterUserId.trim());
    if (filterDocumentId.trim()) p.set("documentId", filterDocumentId.trim());
    if (fromDate) p.set("from", fromDate);
    if (toDate) p.set("to", toDate);
    if (!sortNewestFirst) p.set("sort", "createdAt_asc");
    if (page > 1) p.set("page", String(page));
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [
    phase,
    urlReady,
    page,
    debouncedQ,
    filterAction,
    filterUserId,
    filterDocumentId,
    fromDate,
    toDate,
    sortNewestFirst,
    pathname,
    router,
  ]);

  const loadEntries = useCallback(async () => {
    if (phase !== "ready") return;
    setListLoading(true);
    setLoadError(null);
    try {
      const params = buildListParams();
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
      setEntries(data.entries);
    } catch {
      setLoadError("Could not load audit log.");
    } finally {
      setListLoading(false);
    }
  }, [phase, buildListParams]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  async function refreshList() {
    await loadEntries();
  }

  async function exportCsv() {
    setExportBusy(true);
    try {
      const params = buildExportParams();
      const res = await fetchWithAuth(`${API}/admin/document-audit/export?${params.toString()}`);
      if (!res.ok) {
        toast("Export failed.", "error");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `document-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast("Could not export.", "error");
    } finally {
      setExportBusy(false);
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setDetailEntry(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
        <h1>Document audit</h1>
        <p style={{ color: "#52525b" }}>Sign in to continue.</p>
        <Link href="/login">Sign in</Link>
      </main>
    );
  }

  if (phase === "forbidden") {
    return (
      <main style={{ maxWidth: 560 }}>
        <h1>Document audit</h1>
        <p style={{ color: "var(--error)" }}>Administrators only.</p>
        <Link prefetch={false} href="/dashboard">Dashboard</Link>
      </main>
    );
  }

  if (phase === "load-error") {
    return (
      <main>
        <p style={{ color: "var(--error)" }}>Could not verify access.</p>
        <Link prefetch={false} href="/admin">Admin hub</Link>
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
    <main className={u.shell} data-dashboard-fullscreen="true">
      <AdminChromeHeader user={sessionUser} className={`${dash.navbar} ${u.navbarRow}`} />
      <div className={styles.workspace}>
        <div className={u.adminBody}>
          <aside className={u.adminSidebar} aria-label="Admin sections">
            {ADMIN_SIDEBAR_LINKS.map(({ href, label, icon }) => {
              const active = adminNavActive(href, pathname ?? "");
              return (
                <Link
                  key={href}
                  href={href}
                  className={active ? `${u.sidebarLink} ${u.sidebarLinkActive}` : u.sidebarLink}
                  aria-current={active ? "page" : undefined}
                >
                  <AdminHubGlyph type={icon} className={u.sidebarIcon} />
                  <span className={u.sidebarLabel}>{label}</span>
                </Link>
              );
            })}
          </aside>

          <div className={u.main}>
            <div className={u.pageHead}>
              <div>
                <h1 className={u.pageTitle}>Document audit</h1>
                <p className={u.pageSubtitle}>
                  Library-wide actions: uploads, edits, views, favorites, archive, delete, reprocess. Search matches
                  document title and user name or email. Use exact UUIDs for document or user filters. Click a row for
                  metadata. Export uses the same filters (up to 5,000 rows).
                </p>
              </div>
            </div>

            <div className={u.tableCard}>
              <div className={u.cardToolbar}>
                <h2 className={u.cardToolbarTitle}>Audit log</h2>
                <div className={u.toolbarRight} role="group" aria-label="Document audit filters">
                  <div className={styles.toolbarEventType}>
                    <span className={styles.toolbarEventTypeLabel} id="doc-audit-action-label">
                      Action
                    </span>
                    <select
                      className={styles.toolbarEventSelect}
                      value={filterAction}
                      onChange={(e) => setFilterAction(e.target.value)}
                      aria-labelledby="doc-audit-action-label"
                    >
                      <option value="">All actions</option>
                      {AUDIT_ACTIONS.map((act) => (
                        <option key={act} value={act}>
                          {auditActionLabel(act)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={u.toolbarSearch}>
                    <ToolbarIconSearch />
                    <input
                      type="search"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="Filter list…"
                      aria-label="Search document title or user"
                    />
                  </div>
                  <button
                    type="button"
                    className={styles.toolbarBtn}
                    disabled={listLoading}
                    onClick={() => void refreshList()}
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    className={styles.toolbarBtn}
                    disabled={exportBusy}
                    onClick={() => void exportCsv()}
                  >
                    {exportBusy ? "Exporting…" : "Export CSV"}
                  </button>
                </div>
              </div>

              <div className={styles.filterStrip} role="group" aria-label="More filters">
                <label className={styles.filterStripField}>
                  <span className={styles.filterStripLabel}>From</span>
                  <input
                    type="date"
                    className={styles.filterStripInput}
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    aria-label="From date"
                  />
                </label>
                <label className={styles.filterStripField}>
                  <span className={styles.filterStripLabel}>To</span>
                  <input
                    type="date"
                    className={styles.filterStripInput}
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    aria-label="To date"
                  />
                </label>
                <label className={styles.filterStripField}>
                  <span className={styles.filterStripLabel}>Document ID</span>
                  <input
                    type="text"
                    className={styles.filterStripInput}
                    value={filterDocumentId}
                    onChange={(e) => setFilterDocumentId(e.target.value)}
                    placeholder="Exact UUID"
                    aria-label="Filter by document id"
                  />
                </label>
                <label className={styles.filterStripField}>
                  <span className={styles.filterStripLabel}>User ID</span>
                  <input
                    type="text"
                    className={styles.filterStripInput}
                    value={filterUserId}
                    onChange={(e) => setFilterUserId(e.target.value)}
                    placeholder="UUID"
                    aria-label="Filter by user id"
                  />
                </label>
                <label className={styles.filterStripField}>
                  <span className={styles.filterStripLabel}>Order</span>
                  <select
                    className={styles.filterStripInput}
                    value={sortNewestFirst ? "desc" : "asc"}
                    onChange={(e) => setSortNewestFirst(e.target.value === "desc")}
                    aria-label="Sort order"
                  >
                    <option value="desc">Newest first</option>
                    <option value="asc">Oldest first</option>
                  </select>
                </label>
              </div>

              {loadError ? (
                <p role="alert" style={{ color: "var(--error)", padding: "0 1.1rem" }}>
                  {loadError}
                </p>
              ) : null}

              <div className={u.tableScroll}>
                <table className={u.dataTable}>
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Action</th>
                      <th scope="col">Document</th>
                      <th scope="col">User</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listLoading ? (
                      <tr>
                        <td colSpan={4} className={u.cellMuted} style={{ padding: "1.25rem" }}>
                          Loading…
                        </td>
                      </tr>
                    ) : entries.length === 0 ? (
                      <tr>
                        <td colSpan={4} className={u.cellMuted} style={{ padding: "1.25rem" }}>
                          No entries match the current filters.
                        </td>
                      </tr>
                    ) : (
                      entries.map((e) => (
                        <tr
                          key={e.id}
                          className={`${u.clickableRow} ${styles.clickRow}`}
                          onClick={() => setDetailEntry(e)}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter" || ev.key === " ") {
                              ev.preventDefault();
                              setDetailEntry(e);
                            }
                          }}
                          tabIndex={0}
                          role="button"
                          aria-label={`View details for ${auditActionLabel(e.action)} at ${new Date(e.createdAt).toLocaleString()}`}
                        >
                          <td className={u.cellMuted} style={{ whiteSpace: "nowrap" }}>
                            {new Date(e.createdAt).toLocaleString()}
                          </td>
                          <td>
                            <span className={auditPillClass(e.action)}>{auditActionLabel(e.action)}</span>
                          </td>
                          <td onClick={(ev) => ev.stopPropagation()}>
                            {e.document && e.documentId ? (
                              <Link prefetch={false} href={`/documents/${e.documentId}`} className={styles.userLink}>
                                {e.document.title}
                              </Link>
                            ) : e.documentId ? (
                              <code style={{ fontSize: "0.78rem", wordBreak: "break-all" }}>{e.documentId}</code>
                            ) : (
                              <span className={u.cellMuted}>—</span>
                            )}
                          </td>
                          <td onClick={(ev) => ev.stopPropagation()}>
                            {e.user ? (
                              <div className={u.userCell}>
                                {profilePictureDisplayUrl(e.user.profilePictureUrl ?? null) ? (
                                  <ProfileAvatarImage
                                    className={u.avatar}
                                    src={profilePictureDisplayUrl(e.user.profilePictureUrl ?? null)!}
                                    alt=""
                                    width={36}
                                    height={36}
                                    sizes="36px"
                                  />
                                ) : (
                                  <span className={u.avatarFallback} aria-hidden>
                                    {userInitialsFromName(e.user.name)}
                                  </span>
                                )}
                                <div style={{ minWidth: 0 }}>
                                  <Link
                                    href={`/admin/users?q=${encodeURIComponent(e.user.email)}`}
                                    className={styles.userLink}
                                    title="Open Users with this email"
                                  >
                                    {e.user.name}
                                  </Link>
                                  <div className={u.cellMuted} style={{ fontSize: "0.8125rem" }}>
                                    {e.user.email}
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <span className={u.cellMuted}>—</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className={u.paginationBar}>
                <button type="button" disabled={page <= 1 || listLoading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Previous
                </button>
                <span>
                  Page {page} of {totalPages} ({total} entr{total === 1 ? "y" : "ies"})
                </span>
                <button type="button" disabled={page >= totalPages || listLoading} onClick={() => setPage((p) => p + 1)}>
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {detailEntry ? (
        <>
          <button
            type="button"
            className={styles.detailBackdrop}
            aria-label="Close details"
            onClick={() => setDetailEntry(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={detailTitleId}
            className={styles.detailDialog}
            onClick={(ev) => ev.stopPropagation()}
            onKeyDown={(ev) => ev.stopPropagation()}
          >
            <div className={styles.detailHeader}>
              <h2 id={detailTitleId} className={styles.detailTitle}>
                Audit entry
              </h2>
              <button type="button" className={styles.detailClose} aria-label="Close" onClick={() => setDetailEntry(null)}>
                ×
              </button>
            </div>
            <div className={styles.detailBody}>
              <dl className={styles.detailDl}>
                <div className={styles.detailRow}>
                  <dt className={styles.detailDt}>When</dt>
                  <dd className={styles.detailDd}>{new Date(detailEntry.createdAt).toLocaleString()}</dd>
                </div>
                <div className={styles.detailRow}>
                  <dt className={styles.detailDt}>Action</dt>
                  <dd className={styles.detailDd}>
                    <span className={auditPillClass(detailEntry.action)}>{auditActionLabel(detailEntry.action)}</span>
                  </dd>
                </div>
                <div className={styles.detailRow}>
                  <dt className={styles.detailDt}>Entry ID</dt>
                  <dd className={styles.detailDd}>
                    <code style={{ fontSize: "0.8rem" }}>{detailEntry.id}</code>
                  </dd>
                </div>
                <div className={styles.detailRow}>
                  <dt className={styles.detailDt}>Document</dt>
                  <dd className={styles.detailDd}>
                    {detailEntry.document && detailEntry.documentId ? (
                      <>
                        <Link prefetch={false} href={`/documents/${detailEntry.documentId}`} className={styles.userLink}>
                          {detailEntry.document.title}
                        </Link>
                        <div className={u.cellMuted} style={{ fontSize: "0.8125rem", marginTop: "0.25rem" }}>
                          <code>{detailEntry.documentId}</code>
                        </div>
                      </>
                    ) : detailEntry.documentId ? (
                      <code>{detailEntry.documentId}</code>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div className={styles.detailRow}>
                  <dt className={styles.detailDt}>User</dt>
                  <dd className={styles.detailDd}>
                    {detailEntry.user ? (
                      <>
                        {detailEntry.user.name} ({detailEntry.user.email})
                        <div style={{ marginTop: "0.35rem" }}>
                          <Link
                            href={`/admin/users?q=${encodeURIComponent(detailEntry.user.email)}`}
                            className={styles.userLink}
                          >
                            Open in Users
                          </Link>
                        </div>
                      </>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
              </dl>
              <div>
                <div className={styles.filterStripLabel} style={{ marginBottom: "0.35rem" }}>
                  Metadata
                </div>
                <pre className={styles.detailCode}>{metadataPretty(detailEntry.metadata)}</pre>
              </div>
              <div className={styles.detailActions}>
                <button type="button" className={styles.toolbarBtn} onClick={() => void copyText(detailEntry.id)}>
                  Copy entry ID
                </button>
                <button
                  type="button"
                  className={styles.toolbarBtn}
                  onClick={() => void copyText(metadataPretty(detailEntry.metadata))}
                >
                  Copy metadata
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}
