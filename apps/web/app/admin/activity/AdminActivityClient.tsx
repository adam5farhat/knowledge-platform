"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { fetchWithAuth } from "../../../lib/authClient";
import dash from "../../components/shellNav.module.css";
import { useToast } from "@/components/Toast";
import { AdminChromeHeader } from "../AdminChromeHeader";
import { AdminHubGlyph, type AdminHubGlyphType } from "../AdminHubIcons";
import { useAdminGuard } from "../useAdminGuard";
import u from "../users/adminUsers.module.css";
import styles from "./adminActivity.module.css";
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

const EVENT_TYPES = [
  "LOGIN_SUCCESS",
  "LOGIN_FAILURE",
  "LOGIN_LOCKED",
  "REFRESH_SUCCESS",
  "REFRESH_FAILURE",
  "LOGOUT",
  "LOGOUT_ALL",
  "PASSWORD_CHANGE",
  "PASSWORD_RESET_REQUESTED",
  "PASSWORD_RESET_COMPLETED",
] as const;

function eventTypeLabel(t: string): string {
  switch (t) {
    case "LOGIN_SUCCESS":
      return "Login success";
    case "LOGIN_FAILURE":
      return "Login failure";
    case "LOGIN_LOCKED":
      return "Login locked";
    case "REFRESH_SUCCESS":
      return "Refresh success";
    case "REFRESH_FAILURE":
      return "Refresh failure";
    case "LOGOUT":
      return "Logout";
    case "LOGOUT_ALL":
      return "Logout all";
    case "PASSWORD_CHANGE":
      return "Password change";
    case "PASSWORD_RESET_REQUESTED":
      return "Password reset requested";
    case "PASSWORD_RESET_COMPLETED":
      return "Password reset completed";
    default:
      return t;
  }
}

function eventPillClass(t: string): string {
  if (t === "LOGIN_SUCCESS" || t === "REFRESH_SUCCESS" || t === "PASSWORD_RESET_COMPLETED") {
    return `${styles.eventPill} ${styles.eventOk}`;
  }
  if (t === "LOGIN_FAILURE" || t === "REFRESH_FAILURE" || t === "LOGIN_LOCKED") {
    return `${styles.eventPill} ${styles.eventErr}`;
  }
  if (t === "PASSWORD_RESET_REQUESTED") {
    return `${styles.eventPill} ${styles.eventWarn}`;
  }
  return styles.eventPill;
}

type AuthEventRow = {
  id: string;
  eventType: string;
  createdAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  user: { id: string; email: string; name: string } | null;
};

function metadataPretty(meta: unknown): string {
  if (meta == null || meta === undefined) return "—";
  try {
    return JSON.stringify(meta, null, 2);
  } catch {
    return String(meta);
  }
}

/** Match API normalization for older rows still stored as IPv4-mapped IPv6. */
function formatIpDisplay(ip: string | null | undefined): string {
  if (ip == null || ip === "") return "—";
  if (ip.startsWith("::ffff:")) {
    const v4 = ip.slice(7);
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(v4)) return v4;
  }
  return ip;
}

/** Email captured on login attempts when no user row is linked (e.g. wrong email). */
function metadataSignInEmail(metadata: unknown): string | null {
  if (metadata == null || typeof metadata !== "object") return null;
  const email = (metadata as Record<string, unknown>).email;
  return typeof email === "string" && email.includes("@") ? email : null;
}

function eventUserCell(e: AuthEventRow) {
  const attempted = metadataSignInEmail(e.metadata);
  if (e.user) {
    return (
      <>
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
      </>
    );
  }
  if (attempted) {
    return (
      <div>
        <span className={u.cellMuted} style={{ fontSize: "0.72rem", display: "block", marginBottom: "0.15rem" }}>
          Attempted sign-in
        </span>
        <span title="No user account tied to this event; email from the request">{attempted}</span>
      </div>
    );
  }
  return <span className={u.cellMuted}>—</span>;
}

export default function AdminActivityClient() {
  const router = useRouter();
  const pathname = usePathname();
  const detailTitleId = useId();
  const { toast } = useToast();
  const { phase, sessionUser } = useAdminGuard();
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [events, setEvents] = useState<AuthEventRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filterEventType, setFilterEventType] = useState("");
  const [filterIp, setFilterIp] = useState("");
  const [filterUserId, setFilterUserId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortNewestFirst, setSortNewestFirst] = useState(true);

  const [detailEvent, setDetailEvent] = useState<AuthEventRow | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  const urlHydratedRef = useRef(false);
  const [urlReady, setUrlReady] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(searchInput.trim()), 320);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, filterEventType, filterIp, filterUserId, fromDate, toDate, sortNewestFirst]);

  const buildListParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    if (debouncedQ) params.set("q", debouncedQ);
    if (filterEventType) params.set("eventType", filterEventType);
    if (filterIp.trim()) params.set("ip", filterIp.trim());
    if (filterUserId.trim()) params.set("userId", filterUserId.trim());
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    if (!sortNewestFirst) params.set("sort", "createdAt_asc");
    return params;
  }, [
    page,
    debouncedQ,
    filterEventType,
    filterIp,
    filterUserId,
    fromDate,
    toDate,
    sortNewestFirst,
  ]);

  const buildExportParams = useCallback(() => {
    const params = new URLSearchParams();
    if (debouncedQ) params.set("q", debouncedQ);
    if (filterEventType) params.set("eventType", filterEventType);
    if (filterIp.trim()) params.set("ip", filterIp.trim());
    if (filterUserId.trim()) params.set("userId", filterUserId.trim());
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    if (!sortNewestFirst) params.set("sort", "createdAt_asc");
    return params;
  }, [debouncedQ, filterEventType, filterIp, filterUserId, fromDate, toDate, sortNewestFirst]);

  useEffect(() => {
    if (phase !== "ready" || urlHydratedRef.current) return;
    urlHydratedRef.current = true;
    try {
      const sp = new URLSearchParams(window.location.search);
      const q = sp.get("q");
      if (q) setSearchInput(q);
      const et = sp.get("eventType");
      if (et && (EVENT_TYPES as readonly string[]).includes(et)) setFilterEventType(et);
      const ip = sp.get("ip");
      if (ip) setFilterIp(ip);
      const uid = sp.get("userId");
      if (uid) setFilterUserId(uid);
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
    if (filterEventType) p.set("eventType", filterEventType);
    if (filterIp.trim()) p.set("ip", filterIp.trim());
    if (filterUserId.trim()) p.set("userId", filterUserId.trim());
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
    filterEventType,
    filterIp,
    filterUserId,
    fromDate,
    toDate,
    sortNewestFirst,
    pathname,
    router,
  ]);

  const loadEvents = useCallback(async () => {
    if (phase !== "ready") return;
    setListLoading(true);
    setLoadError(null);
    try {
      const params = buildListParams();
      const res = await fetchWithAuth(`${API}/admin/activity?${params.toString()}`);
      if (!res.ok) {
        setLoadError("Could not load activity.");
        return;
      }
      const data = (await res.json()) as {
        total?: number;
        events?: AuthEventRow[];
      };
      if (!Array.isArray(data.events)) {
        setLoadError("Invalid response from server.");
        return;
      }
      setTotal(data.total ?? 0);
      setEvents(data.events);
    } catch {
      setLoadError("Could not load activity.");
    } finally {
      setListLoading(false);
    }
  }, [phase, buildListParams]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  async function refreshList() {
    await loadEvents();
  }

  async function exportCsv() {
    setExportBusy(true);
    try {
      const params = buildExportParams();
      const res = await fetchWithAuth(`${API}/admin/activity/export?${params.toString()}`);
      if (!res.ok) {
        toast("Export failed.", "error");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `auth-activity-${new Date().toISOString().slice(0, 10)}.csv`;
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
      setDetailEvent(null);
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
        <h1>Activity</h1>
        <p style={{ color: "var(--muted)" }}>Sign in to continue.</p>
        <Link href="/login">Sign in</Link>
      </main>
    );
  }

  if (phase === "forbidden") {
    return (
      <main style={{ maxWidth: 560 }}>
        <h1>Activity</h1>
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
                <h1 className={u.pageTitle}>Activity</h1>
                <p className={u.pageSubtitle}>
                  Authentication and security events. Filter by type, date, IP, or user; search also matches IP and
                  browser string. Click a row for full details. Export applies the same filters (up to 5,000 rows).
                </p>
              </div>
            </div>

            <div className={u.tableCard}>
              <div className={u.cardToolbar}>
                <h2 className={u.cardToolbarTitle}>Event log</h2>
                <div className={u.toolbarRight} role="group" aria-label="Activity filters">
                  <div className={styles.toolbarEventType}>
                    <span className={styles.toolbarEventTypeLabel} id="activity-event-type-label">
                      Event type
                    </span>
                    <select
                      className={styles.toolbarEventSelect}
                      value={filterEventType}
                      onChange={(e) => setFilterEventType(e.target.value)}
                      aria-labelledby="activity-event-type-label"
                    >
                      <option value="">All events</option>
                      {EVENT_TYPES.map((et) => (
                        <option key={et} value={et}>
                          {eventTypeLabel(et)}
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
                      aria-label="Search user, IP, or client string"
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
                  <span className={styles.filterStripLabel}>IP contains</span>
                  <input
                    type="text"
                    className={styles.filterStripInput}
                    value={filterIp}
                    onChange={(e) => setFilterIp(e.target.value)}
                    placeholder="192.168…"
                    aria-label="Filter by IP substring"
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
                      <th scope="col">Event</th>
                      <th scope="col">User</th>
                      <th scope="col">IP</th>
                      <th scope="col" className={styles.hideNarrow}>
                        Client
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {listLoading ? (
                      <tr>
                        <td colSpan={5} className={u.cellMuted} style={{ padding: "1.25rem" }}>
                          Loading…
                        </td>
                      </tr>
                    ) : events.length === 0 ? (
                      <tr>
                        <td colSpan={5} className={u.cellMuted} style={{ padding: "1.25rem" }}>
                          No events match the current filters.
                        </td>
                      </tr>
                    ) : (
                      events.map((e) => (
                        <tr
                          key={e.id}
                          className={`${u.clickableRow} ${styles.clickRow}`}
                          onClick={() => setDetailEvent(e)}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter" || ev.key === " ") {
                              ev.preventDefault();
                              setDetailEvent(e);
                            }
                          }}
                          tabIndex={0}
                          role="button"
                          aria-label={`View details for ${eventTypeLabel(e.eventType)} at ${new Date(e.createdAt).toLocaleString()}`}
                        >
                          <td className={u.cellMuted} style={{ whiteSpace: "nowrap" }}>
                            {new Date(e.createdAt).toLocaleString()}
                          </td>
                          <td>
                            <span className={eventPillClass(e.eventType)}>{eventTypeLabel(e.eventType)}</span>
                          </td>
                          <td onClick={(ev) => ev.stopPropagation()}>{eventUserCell(e)}</td>
                          <td style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.8125rem" }}>
                            {formatIpDisplay(e.ipAddress)}
                          </td>
                          <td className={`${u.cellMuted} ${styles.userAgentCell} ${styles.hideNarrow}`}>
                            {e.userAgent?.trim() ? e.userAgent : "—"}
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
                  Page {page} of {totalPages} ({total} event{total === 1 ? "" : "s"})
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages || listLoading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {detailEvent ? (
        <>
          <button
            type="button"
            className={styles.detailBackdrop}
            aria-label="Close details"
            onClick={() => setDetailEvent(null)}
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
                Event details
              </h2>
              <button type="button" className={styles.detailClose} aria-label="Close" onClick={() => setDetailEvent(null)}>
                ×
              </button>
            </div>
            <div className={styles.detailBody}>
              <dl className={styles.detailDl}>
                <div className={styles.detailRow}>
                  <dt className={styles.detailDt}>When</dt>
                  <dd className={styles.detailDd}>{new Date(detailEvent.createdAt).toLocaleString()}</dd>
                </div>
                <div className={styles.detailRow}>
                  <dt className={styles.detailDt}>Type</dt>
                  <dd className={styles.detailDd}>
                    <span className={eventPillClass(detailEvent.eventType)}>
                      {eventTypeLabel(detailEvent.eventType)}
                    </span>
                  </dd>
                </div>
                <div className={styles.detailRow}>
                  <dt className={styles.detailDt}>Event ID</dt>
                  <dd className={styles.detailDd}>
                    <code style={{ fontSize: "0.8rem" }}>{detailEvent.id}</code>
                  </dd>
                </div>
                <div className={styles.detailRow}>
                  <dt className={styles.detailDt}>User</dt>
                  <dd className={styles.detailDd}>
                    {detailEvent.user ? (
                      <>
                        {detailEvent.user.name} ({detailEvent.user.email})
                        <div style={{ marginTop: "0.35rem" }}>
                          <Link
                            href={`/admin/users?q=${encodeURIComponent(detailEvent.user.email)}`}
                            className={styles.userLink}
                          >
                            Open in Users
                          </Link>
                        </div>
                      </>
                    ) : metadataSignInEmail(detailEvent.metadata) ? (
                      <>
                        <span className={u.cellMuted}>Attempted sign-in: </span>
                        {metadataSignInEmail(detailEvent.metadata)}
                      </>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div className={styles.detailRow}>
                  <dt className={styles.detailDt}>IP</dt>
                  <dd className={styles.detailDd}>{formatIpDisplay(detailEvent.ipAddress)}</dd>
                </div>
                <div className={styles.detailRow}>
                  <dt className={styles.detailDt}>Client</dt>
                  <dd className={styles.detailDd}>{detailEvent.userAgent?.trim() || "—"}</dd>
                </div>
              </dl>
              <div>
                <div className={styles.filterStripLabel} style={{ marginBottom: "0.35rem" }}>
                  Metadata
                </div>
                <pre className={styles.detailCode}>{metadataPretty(detailEvent.metadata)}</pre>
              </div>
              <div className={styles.detailActions}>
                <button type="button" className={styles.toolbarBtn} onClick={() => void copyText(detailEvent.id)}>
                  Copy event ID
                </button>
                <button
                  type="button"
                  className={styles.toolbarBtn}
                  onClick={() => void copyText(metadataPretty(detailEvent.metadata))}
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
