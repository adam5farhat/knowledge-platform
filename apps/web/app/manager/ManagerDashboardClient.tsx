"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/authClient";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import { ProfileAvatarImage } from "@/components/ProfileAvatarImage";
import { profilePictureDisplayUrl } from "@/lib/profilePicture";
import { AdminChromeHeader } from "../admin/AdminChromeHeader";
import { useManagerGuard } from "./useManagerGuard";
import type { DocRow } from "../documents/documentsTypes";
import dash from "../components/shellNav.module.css";
import styles from "./managerDashboard.module.css";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

type DeptPayload = {
  department: { id: string; name: string; parentDepartmentId: string | null };
  members: {
    id: string;
    name: string;
    email: string;
    position: string | null;
    employeeBadgeNumber: string | null;
    isActive: boolean;
    lastLoginAt: string | null;
    profilePictureUrl: string | null;
    role: string;
  }[];
};

export default function ManagerDashboardClient() {
  const { phase, sessionUser } = useManagerGuard();
  const [deptPayload, setDeptPayload] = useState<DeptPayload | null>(null);
  const [deptError, setDeptError] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);
  const [membersView, setMembersView] = useState<"cards" | "table">("cards");

  // Team directory filters (local filtering).
  const [memberSearch, setMemberSearch] = useState("");
  const [memberStatus, setMemberStatus] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [memberPosition, setMemberPosition] = useState("ALL");

  // Department documents filters (server-backed).
  const [docSearch, setDocSearch] = useState("");
  const [docVisibility, setDocVisibility] = useState<"ALL" | "DEPARTMENT" | "PRIVATE">("ALL");
  const [docStatus, setDocStatus] = useState<"ALL" | "READY" | "FAILED" | "PENDING" | "PROCESSING">("ALL");
  const [docFileType, setDocFileType] = useState<"ALL" | "PDF" | "DOC" | "TXT" | "IMG">("ALL");
  const [docDateFilter, setDocDateFilter] = useState<"ALL" | "TODAY" | "WEEK" | "MONTH">("ALL");
  const [docTag, setDocTag] = useState("");
  const [docVisibilityDraft, setDocVisibilityDraft] = useState<"ALL" | "DEPARTMENT" | "PRIVATE">("ALL");
  const [docStatusDraft, setDocStatusDraft] = useState<"ALL" | "READY" | "FAILED" | "PENDING" | "PROCESSING">("ALL");
  const [docFileTypeDraft, setDocFileTypeDraft] = useState<"ALL" | "PDF" | "DOC" | "TXT" | "IMG">("ALL");
  const [docDateFilterDraft, setDocDateFilterDraft] = useState<"ALL" | "TODAY" | "WEEK" | "MONTH">("ALL");
  const [docTagDraft, setDocTagDraft] = useState("");
  const [docFiltersOpen, setDocFiltersOpen] = useState(false);

  useEffect(() => {
    if (phase !== "ready") return;
    let cancelled = false;
    void (async () => {
      setDeptError(null);
      try {
        const res = await fetchWithAuth(`${API}/manager/department`);
        const body = (await res.json().catch(() => ({}))) as DeptPayload & { error?: string };
        if (!res.ok) {
          if (!cancelled) setDeptError(body.error ?? "Could not load your department.");
          return;
        }
        if (!cancelled) setDeptPayload(body);
      } catch {
        if (!cancelled) setDeptError("Could not reach the server.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "ready" || !deptPayload?.department.id) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        setDocsLoading(true);
        setDocsError(null);
        try {
          const params = new URLSearchParams({
            departmentId: deptPayload.department.id,
            libraryScope: "ALL",
            page: "1",
            pageSize: "100",
            sort: "updatedAt_desc",
          });
          if (docSearch.trim()) params.set("q", docSearch.trim());
          if (docVisibility !== "ALL") params.set("visibility", docVisibility);
          if (docStatus !== "ALL") params.set("status", docStatus);
          if (docFileType !== "ALL") params.set("fileType", docFileType);
          if (docDateFilter !== "ALL") params.set("dateFilter", docDateFilter);
          if (docTag.trim()) params.set("tag", docTag.trim());

          const res = await fetchWithAuth(`${API}/documents?${params.toString()}`);
          const body = (await res.json().catch(() => ({}))) as { documents?: DocRow[]; error?: string };
          if (!res.ok) {
            if (!cancelled) setDocsError(body.error ?? "Could not load department documents.");
            return;
          }
          if (!cancelled) setDocs(body.documents ?? []);
        } catch {
          if (!cancelled) setDocsError("Could not reach the server.");
        } finally {
          if (!cancelled) setDocsLoading(false);
        }
      })();
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [
    phase,
    deptPayload?.department.id,
    docSearch,
    docVisibility,
    docStatus,
    docFileType,
    docDateFilter,
    docTag,
  ]);

  const memberPositions = (deptPayload?.members ?? [])
    .map((m) => (m.position ?? "").trim())
    .filter(Boolean);
  const uniquePositions = Array.from(new Set(memberPositions)).sort((a, b) => a.localeCompare(b));

  const filteredMembers = (deptPayload?.members ?? []).filter((m) => {
    const q = memberSearch.trim().toLowerCase();
    const position = (m.position ?? "").trim();
    const matchesSearch =
      !q ||
      m.name.toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q) ||
      position.toLowerCase().includes(q);
    const matchesStatus = memberStatus === "ALL" ? true : memberStatus === "ACTIVE" ? m.isActive : !m.isActive;
    const matchesPosition = memberPosition === "ALL" ? true : position === memberPosition;
    return matchesSearch && matchesStatus && matchesPosition;
  });

  if (phase === "checking") {
    return (
      <main className={dash.page} data-dashboard-fullscreen="true">
        <p style={{ padding: "1rem" }}>Loading…</p>
      </main>
    );
  }

  if (phase === "need-login") {
    return (
      <main style={{ maxWidth: 520 }}>
        <h1>Manager</h1>
        <p style={{ color: "#52525b" }}>Sign in to continue.</p>
        <p style={{ marginTop: "1rem" }}>
          <Link href="/login">Sign in</Link>
          {" · "}
          <Link prefetch={false} href="/documents">Documents</Link>
        </p>
      </main>
    );
  }

  if (phase === "forbidden") {
    return (
      <main style={{ maxWidth: 520 }}>
        <h1>Manager</h1>
        <p style={{ color: "var(--error)" }}>This area is only available to department managers.</p>
        <p style={{ marginTop: "1rem" }}>
          <Link prefetch={false} href="/dashboard">Dashboard</Link>
          {" · "}
          <Link prefetch={false} href="/documents">Documents</Link>
        </p>
      </main>
    );
  }

  if (phase === "load-error") {
    return (
      <main style={{ maxWidth: 520 }}>
        <h1>Manager</h1>
        <p style={{ color: "var(--error)" }}>Could not verify access.</p>
        <p style={{ marginTop: "1rem" }}>
          <Link href="/login">Sign in</Link>
          {" · "}
          <Link prefetch={false} href="/documents">Documents</Link>
        </p>
      </main>
    );
  }

  if (!sessionUser) {
    return null;
  }

  const deptId = deptPayload?.department.id;
  const libraryHref = deptId ? `/documents?dept=${encodeURIComponent(deptId)}` : "/documents";

  return (
    <main className={dash.page} data-dashboard-fullscreen="true">
      <AdminChromeHeader
        user={sessionUser}
        navVariant="manager"
        className={`${dash.navbar} ${styles.navbarRow}`}
      />

      <Link prefetch={false} href="/dashboard" className={styles.backFab} aria-label="Back to dashboard" title="Back to dashboard">
        <svg className={styles.backFabIcon} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M15 18 9 12l6-6"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Link>

      <div className={styles.main}>
        <div className={styles.pageHead}>
          <h1 className={styles.title}>Department overview</h1>
          <p className={styles.subtitle}>
            {deptPayload ? (
              <>
                <strong>{deptPayload.department.name}</strong>
                {" · "}
                {deptPayload.members.length} team member{deptPayload.members.length === 1 ? "" : "s"}
              </>
            ) : deptError ? (
              <span className={styles.muted}>Department could not be loaded.</span>
            ) : (
              <span className={styles.muted}>Loading department…</span>
            )}
          </p>
        </div>

        {deptError ? <div className={styles.errorBox}>{deptError}</div> : null}

        {deptPayload ? (
          <>
            <div className={styles.sectionsGrid}>
              <section className={styles.section} aria-labelledby="mgr-team-heading">
              <div className={styles.sectionCard}>
                <div className={styles.sectionHead}>
                  <h2 id="mgr-team-heading" className={styles.sectionTitle}>
                    Team directory
                  </h2>
                  <span className={styles.sectionCount}>{filteredMembers.length} shown</span>
                </div>
                <p className={styles.sectionHint}>Read-only list of people in your department.</p>

                <div className={styles.viewToggle} role="group" aria-label="Member directory view">
                  <button
                    type="button"
                    className={`${styles.toggleBtn} ${membersView === "cards" ? styles.toggleBtnActive : ""}`}
                    onClick={() => setMembersView("cards")}
                  >
                    Cards
                  </button>
                  <button
                    type="button"
                    className={`${styles.toggleBtn} ${membersView === "table" ? styles.toggleBtnActive : ""}`}
                    onClick={() => setMembersView("table")}
                  >
                    Table
                  </button>
                </div>

                <div className={styles.filtersBar} aria-label="Team directory filters">
                  <div className={styles.teamFiltersRow}>
                    <div className={styles.filterGroup}>
                      <label className={styles.filterLabel} htmlFor="mgr-member-status">
                        Status
                      </label>
                      <select
                        id="mgr-member-status"
                        className={styles.select}
                        value={memberStatus}
                        onChange={(e) => setMemberStatus(e.target.value as typeof memberStatus)}
                      >
                        <option value="ALL">All</option>
                        <option value="ACTIVE">Active</option>
                        <option value="INACTIVE">Inactive</option>
                      </select>
                    </div>

                    <div className={styles.filterGroup}>
                      <label className={styles.filterLabel} htmlFor="mgr-member-position">
                        Position
                      </label>
                      <select
                        id="mgr-member-position"
                        className={styles.select}
                        value={memberPosition}
                        onChange={(e) => setMemberPosition(e.target.value)}
                      >
                        <option value="ALL">All positions</option>
                        {uniquePositions.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className={`${styles.filterGroup} ${styles.filterSearchRight}`}>
                      <label className={styles.filterLabel} htmlFor="mgr-member-search">
                        Search
                      </label>
                      <input
                        id="mgr-member-search"
                        className={styles.searchInput}
                        value={memberSearch}
                        onChange={(e) => setMemberSearch(e.target.value)}
                        placeholder="Name, email, position"
                      />
                    </div>
                    <button
                      type="button"
                      className={`${styles.clearBtn} ${styles.clearBtnInline}`}
                      onClick={() => {
                        setMemberSearch("");
                        setMemberStatus("ALL");
                        setMemberPosition("ALL");
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {deptPayload.members.length === 0 ? (
                  <div className={styles.empty}>No members in this department yet.</div>
                ) : filteredMembers.length === 0 ? (
                  <div className={styles.empty}>No members match your filters.</div>
                ) : membersView === "cards" ? (
                  <div className={styles.memberGrid}>
                    {filteredMembers.map((m) => {
                      const pic = profilePictureDisplayUrl(m.profilePictureUrl);
                      const roleText = m.position?.trim() ? m.position : "—";
                      return (
                        <div key={m.id} className={styles.memberCard} data-interactive="true">
                          <div className={styles.memberTop}>
                            <span className={styles.memberAvatar} aria-hidden>
                              {pic ? (
                                <ProfileAvatarImage
                                  className={styles.memberAvatarImg}
                                  src={pic}
                                  alt=""
                                  width={48}
                                  height={48}
                                  sizes="48px"
                                />
                              ) : (
                                initialsFromName(m.name)
                              )}
                            </span>
                            <div className={styles.memberNameBlock}>
                              <div className={styles.memberName}>{m.name}</div>
                              <div className={styles.memberRole}>{roleText}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Role</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMembers.map((m) => {
                          const pic = profilePictureDisplayUrl(m.profilePictureUrl);
                          const roleText = m.position?.trim() ? m.position : "—";
                          return (
                            <tr key={m.id} data-interactive="true">
                              <td>
                                <div className={styles.nameCell}>
                                  <span className={styles.avatar} aria-hidden>
                                    {pic ? (
                                      <ProfileAvatarImage
                                        className={styles.avatarImg}
                                        src={pic}
                                        alt=""
                                        width={36}
                                        height={36}
                                        sizes="36px"
                                      />
                                    ) : (
                                      initialsFromName(m.name)
                                    )}
                                  </span>
                                  <span>{m.name}</span>
                                </div>
                              </td>
                              <td>{m.email}</td>
                              <td>{roleText}</td>
                              <td>
                                {m.isActive ? (
                                  <span className={styles.badgeActive}>Active</span>
                                ) : (
                                  <span className={styles.badgeInactive}>Inactive</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              </section>

              <section className={styles.section} aria-labelledby="mgr-docs-heading">
              <div className={styles.sectionCard}>
                <div className={styles.sectionHead}>
                  <h2 id="mgr-docs-heading" className={styles.sectionTitle}>
                    Department documents
                  </h2>
                  <span className={styles.sectionCount}>{docsLoading ? "…" : `${docs.length} files`}</span>
                </div>
                <p className={styles.sectionHint}>
                  Files scoped to this department. Use the library for upload, previews, versions, and archive when your
                  permissions allow.
                </p>

                <div className={styles.filtersBar} aria-label="Department documents filters">
                  <div className={styles.docsFilterTopBar}>
                    <div className={styles.docsFilterLeft}>
                      <button
                        type="button"
                        className={styles.filterBtn}
                        onClick={() => setDocFiltersOpen((v) => !v)}
                        aria-expanded={docFiltersOpen}
                        aria-controls="mgr-doc-filters-panel"
                      >
                        <svg className={styles.filterBtnIcon} viewBox="0 0 24 24" fill="none" aria-hidden>
                          <path
                            d="M3 6h18l-7 8v4l-4 2v-6L3 6z"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinejoin="round"
                          />
                        </svg>
                        Filter
                      </button>
                      <button
                        type="button"
                        className={styles.clearBtn}
                        onClick={() => {
                          setDocVisibility("ALL");
                          setDocStatus("ALL");
                          setDocFileType("ALL");
                          setDocDateFilter("ALL");
                          setDocTag("");
                          setDocVisibilityDraft("ALL");
                          setDocStatusDraft("ALL");
                          setDocFileTypeDraft("ALL");
                          setDocDateFilterDraft("ALL");
                          setDocTagDraft("");
                        }}
                      >
                        Reset
                      </button>
                    </div>
                    <div className={`${styles.filterGroup} ${styles.docsSearchRight}`}>
                      <label className={styles.filterLabel} htmlFor="mgr-doc-search">
                        Search
                      </label>
                      <input
                        id="mgr-doc-search"
                        className={styles.searchInput}
                        value={docSearch}
                        onChange={(e) => setDocSearch(e.target.value)}
                        placeholder="Title or description"
                      />
                    </div>
                  </div>

                  {docFiltersOpen ? (
                    <div id="mgr-doc-filters-panel" className={styles.filtersDropdown}>
                      <div className={styles.docsFiltersGrid}>
                        <div className={styles.filterGroup}>
                          <label className={styles.filterLabel} htmlFor="mgr-doc-visibility">
                            Visibility
                          </label>
                          <select
                            id="mgr-doc-visibility"
                            className={styles.select}
                            value={docVisibilityDraft}
                            onChange={(e) => setDocVisibilityDraft(e.target.value as typeof docVisibilityDraft)}
                          >
                            <option value="ALL">All</option>
                            <option value="DEPARTMENT">Department</option>
                            <option value="PRIVATE">Private</option>
                          </select>
                        </div>
                        <div className={styles.filterGroup}>
                          <label className={styles.filterLabel} htmlFor="mgr-doc-status">
                            Processing
                          </label>
                          <select
                            id="mgr-doc-status"
                            className={styles.select}
                            value={docStatusDraft}
                            onChange={(e) => setDocStatusDraft(e.target.value as typeof docStatusDraft)}
                          >
                            <option value="ALL">All</option>
                            <option value="READY">READY</option>
                            <option value="FAILED">FAILED</option>
                            <option value="PENDING">PENDING</option>
                            <option value="PROCESSING">PROCESSING</option>
                          </select>
                        </div>
                        <div className={styles.filterGroup}>
                          <label className={styles.filterLabel} htmlFor="mgr-doc-type">
                            File type
                          </label>
                          <select
                            id="mgr-doc-type"
                            className={styles.select}
                            value={docFileTypeDraft}
                            onChange={(e) => setDocFileTypeDraft(e.target.value as typeof docFileTypeDraft)}
                          >
                            <option value="ALL">All</option>
                            <option value="PDF">PDF</option>
                            <option value="DOC">DOC/DOCX</option>
                            <option value="TXT">TXT</option>
                            <option value="IMG">Images</option>
                          </select>
                        </div>
                        <div className={styles.filterGroup}>
                          <label className={styles.filterLabel} htmlFor="mgr-doc-date">
                            Date
                          </label>
                          <select
                            id="mgr-doc-date"
                            className={styles.select}
                            value={docDateFilterDraft}
                            onChange={(e) => setDocDateFilterDraft(e.target.value as typeof docDateFilterDraft)}
                          >
                            <option value="ALL">All</option>
                            <option value="TODAY">Today</option>
                            <option value="WEEK">Last 7 days</option>
                            <option value="MONTH">Last 30 days</option>
                          </select>
                        </div>
                        <div className={styles.filterGroup}>
                          <label className={styles.filterLabel} htmlFor="mgr-doc-tag">
                            Tag
                          </label>
                          <input
                            id="mgr-doc-tag"
                            className={styles.searchInput}
                            value={docTagDraft}
                            onChange={(e) => setDocTagDraft(e.target.value)}
                            placeholder="e.g. contracts"
                          />
                        </div>
                      </div>
                      <div className={styles.filtersActions}>
                        <button
                          type="button"
                          className={`${styles.clearBtn} ${styles.clearBtnInline}`}
                          onClick={() => {
                            setDocVisibility(docVisibilityDraft);
                            setDocStatus(docStatusDraft);
                            setDocFileType(docFileTypeDraft);
                            setDocDateFilter(docDateFilterDraft);
                            setDocTag(docTagDraft);
                            setDocFiltersOpen(false);
                          }}
                        >
                          Validate
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className={styles.toolbar}>
                  <Link className={styles.ctaPrimary} href={libraryHref} prefetch={false}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M4 4.5h7l3 3V19.5H4z"
                        stroke="currentColor"
                        strokeWidth="1.35"
                        strokeLinejoin="round"
                      />
                      <path d="M11 4.5v3h3" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
                    </svg>
                    Open in document library
                  </Link>
                </div>
                {docsError ? <div className={styles.errorBox}>{docsError}</div> : null}
                {docsLoading ? (
                  <div className={styles.loadingLine}>
                    <span className={styles.loadingDot} aria-hidden />
                    Loading documents…
                  </div>
                ) : null}
                {!docsLoading && !docsError && docs.length === 0 ? (
                  <div className={styles.emptyState}>
                    <svg className={styles.emptyIcon} viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M7 3.5h7l3 3V20.5H7z"
                        stroke="currentColor"
                        strokeWidth="1.25"
                        strokeLinejoin="round"
                      />
                      <path d="M14 3.5v4h3" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
                      <path d="M9.5 12.5h5M9.5 15.5h5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
                    </svg>
                    <p className={styles.emptyTitle}>No department files yet</p>
                    <p className={styles.emptyHint}>
                      When documents are assigned to this department, they will appear here. Upload from the library with
                      department visibility.
                    </p>
                    <Link className={styles.ctaPrimary} href={libraryHref} prefetch={false}>
                      Go to library
                    </Link>
                  </div>
                ) : null}
                {!docsLoading && docs.length > 0 ? (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Document</th>
                          <th>Visibility</th>
                          <th>Processing</th>
                          <th>Updated</th>
                          <th className={styles.actionCell}> </th>
                        </tr>
                      </thead>
                      <tbody>
                        {docs.map((d) => {
                          const st = d.latestVersion?.processingStatus ?? "—";
                          const updated = d.updatedAt ?? d.createdAt;
                          const fn = d.latestVersion?.fileName;
                          const pillClass =
                            st === "READY"
                              ? styles.statusReady
                              : st === "FAILED"
                                ? styles.statusFailed
                                : st === "PENDING" || st === "PROCESSING"
                                  ? styles.statusPending
                                  : styles.statusOther;
                          return (
                            <tr key={d.id} data-interactive="true">
                              <td>
                                <div className={styles.docTitleCell}>
                                  {fn ? (
                                    <span className={styles.docIcon}>
                                      <FileTypeIcon fileName={fn} variant="row" />
                                    </span>
                                  ) : null}
                                  <Link className={styles.docLink} href={`/documents/${d.id}`} prefetch={false}>
                                    {d.title}
                                  </Link>
                                </div>
                              </td>
                              <td>
                                <span className={styles.visCap}>{d.visibility.toLowerCase()}</span>
                              </td>
                              <td>
                                <span className={`${styles.statusPill} ${pillClass}`}>{st}</span>
                              </td>
                              <td className={styles.muted}>
                                {updated ? new Date(updated).toLocaleString() : "—"}
                              </td>
                              <td className={styles.actionCell}>
                                <Link className={styles.actionBtn} href={`/documents/${d.id}`} prefetch={false}>
                                  Open
                                  <svg className={styles.actionIcon} viewBox="0 0 24 24" fill="none" aria-hidden>
                                    <path
                                      d="M7 17 17 7M17 7H9M17 7v8"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </Link>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
              </section>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
