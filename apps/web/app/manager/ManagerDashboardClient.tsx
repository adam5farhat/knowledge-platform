"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/authClient";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import { ProfileAvatarImage } from "@/components/ProfileAvatarImage";
import { profilePictureDisplayUrl } from "@/lib/profilePicture";
import { AdminChromeHeader } from "../admin/AdminChromeHeader";
import {
  ActionIconArchive,
  ActionIconDelete,
  ActionIconDownload,
  ActionIconHeart,
  ActionIconOpen,
  IconSideBackArrow,
  StatusLabel,
} from "../documents/DocumentsClientIcons";
import docStyles from "../documents/page.module.css";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { useManagerGuard } from "./useManagerGuard";
import type { DocRow } from "../documents/documentsTypes";
import dash from "../components/shellNav.module.css";
import styles from "./managerDashboard.module.css";
import { API_BASE as API } from "@/lib/apiBase";

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

function formatDocUpdatedAt(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function MgrActionIconCopy({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
      <path
        d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function MgrActionIconVersions({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 6h16M4 10h16M4 14h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M18 12v8M14 16h8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
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

type DeptSummary = { id: string; name: string; parentDepartmentId: string | null };

export default function ManagerDashboardClient() {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { phase, sessionUser, restrictions } = useManagerGuard();
  const [manageableDepts, setManageableDepts] = useState<DeptSummary[]>([]);
  const [managerDeptsLoaded, setManagerDeptsLoaded] = useState(false);
  const [activeDeptId, setActiveDeptId] = useState<string | null>(null);
  const [deptPayload, setDeptPayload] = useState<DeptPayload | null>(null);
  const [deptError, setDeptError] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);
  const [membersView, setMembersView] = useState<"cards" | "table">("cards");

  const [memberSearch, setMemberSearch] = useState("");
  const [memberStatus, setMemberStatus] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [memberPosition, setMemberPosition] = useState("ALL");

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
  const [panelDoc, setPanelDoc] = useState<DocRow | null>(null);
  const [pdfPreview, setPdfPreview] = useState<{ url: string; title: string; documentId: string } | null>(null);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [pdfPreviewError, setPdfPreviewError] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<{ url: string; title: string } | null>(null);

  const closePdfPreview = useCallback(() => {
    setPdfPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
    setPdfPreviewError(null);
    setPdfPreviewLoading(false);
  }, []);

  useEffect(() => {
    setPanelDoc(null);
  }, [activeDeptId]);

  useEffect(() => {
    if (!panelDoc) return;
    if (!docs.some((x) => x.id === panelDoc.id)) setPanelDoc(null);
  }, [docs, panelDoc]);

  useEffect(() => {
    if (!panelDoc && !pdfPreview && !pdfPreviewLoading && !imagePreview) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (pdfPreview || pdfPreviewLoading) {
        closePdfPreview();
        return;
      }
      if (imagePreview) {
        setImagePreview((prev) => {
          if (prev?.url) URL.revokeObjectURL(prev.url);
          return null;
        });
        return;
      }
      if (panelDoc) setPanelDoc(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panelDoc, pdfPreview, pdfPreviewLoading, imagePreview, closePdfPreview]);

  useEffect(() => {
    if (phase !== "ready") {
      setManagerDeptsLoaded(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(`${API}/manager/departments`);
        const body = (await res.json().catch(() => ({}))) as { departments?: DeptSummary[] };
        if (cancelled) return;
        const list = Array.isArray(body.departments) ? body.departments : [];
        setManageableDepts(list);
        if (list.length > 0) {
          setActiveDeptId((prev) => (prev && list.some((d) => d.id === prev) ? prev : list[0].id));
        } else {
          setActiveDeptId(null);
        }
      } catch {
        if (!cancelled) {
          setManageableDepts([]);
          setActiveDeptId(null);
        }
      } finally {
        if (!cancelled) setManagerDeptsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "ready" || !activeDeptId) return;
    let cancelled = false;
    setDeptError(null);
    setDeptPayload(null);
    void (async () => {
      try {
        const res = await fetchWithAuth(`${API}/manager/department?departmentId=${encodeURIComponent(activeDeptId)}`);
        const body = (await res.json().catch(() => ({}))) as DeptPayload & { error?: string };
        if (!res.ok) {
          if (!cancelled) setDeptError(body.error ?? "Could not load department.");
          return;
        }
        if (!cancelled) setDeptPayload(body);
      } catch {
        if (!cancelled) setDeptError("Could not reach the server.");
      }
    })();
    return () => { cancelled = true; };
  }, [phase, activeDeptId]);

  useEffect(() => {
    if (phase !== "ready" || !activeDeptId) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        setDocsLoading(true);
        setDocsError(null);
        try {
          const params = new URLSearchParams({
            departmentId: activeDeptId,
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
    activeDeptId,
    docSearch,
    docVisibility,
    docStatus,
    docFileType,
    docDateFilter,
    docTag,
  ]);

  async function recordDocumentView(documentId: string) {
    try {
      await fetchWithAuth(`${API}/documents/${documentId}/view`, { method: "POST" });
    } catch {
      /* best-effort */
    }
  }

  async function openDocumentFromPanel(doc: DocRow) {
    const v = doc.latestVersion;
    if (!v || v.processingStatus !== "READY") {
      void recordDocumentView(doc.id);
      router.push(`/documents/${doc.id}`);
      return;
    }
    const isPdf = v.mimeType === "application/pdf" || /\.pdf$/i.test(v.fileName);
    const isImage = v.mimeType.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(v.fileName);
    if (!isPdf && !isImage) {
      void recordDocumentView(doc.id);
      router.push(`/documents/${doc.id}`);
      return;
    }
    if (isImage) {
      setPdfPreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return null;
      });
      setImagePreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return null;
      });
      try {
        const res = await fetchWithAuth(`${API}/documents/${doc.id}/versions/${v.id}/file?inline=1`);
        if (!res.ok) {
          router.push(`/documents/${doc.id}`);
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setImagePreview({ url, title: doc.title });
        void recordDocumentView(doc.id);
      } catch {
        router.push(`/documents/${doc.id}`);
      }
      return;
    }
    setImagePreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
    setPdfPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
    setPdfPreviewLoading(true);
    setPdfPreviewError(null);
    try {
      const res = await fetchWithAuth(`${API}/documents/${doc.id}/versions/${v.id}/file?inline=1`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setPdfPreviewError(body.error ?? "Could not load PDF");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPdfPreview({ url, title: doc.title, documentId: doc.id });
      void recordDocumentView(doc.id);
    } catch {
      setPdfPreviewError("Could not load PDF");
    } finally {
      setPdfPreviewLoading(false);
    }
  }

  async function reloadDepartmentDocuments() {
    if (phase !== "ready" || !activeDeptId) return;
    setDocsLoading(true);
    setDocsError(null);
    try {
      const params = new URLSearchParams({
        departmentId: activeDeptId,
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
        setDocsError(body.error ?? "Could not load department documents.");
        return;
      }
      const list = body.documents ?? [];
      setDocs(list);
      setPanelDoc((p) => (p ? (list.find((x) => x.id === p.id) ?? null) : null));
    } catch {
      setDocsError("Could not reach the server.");
    } finally {
      setDocsLoading(false);
    }
  }

  async function downloadDocument(documentId: string, versionId: string, fileName: string) {
    try {
      const res = await fetchWithAuth(`${API}/documents/${documentId}/versions/${versionId}/file`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast(data.error ?? "Download failed", "error");
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
    } catch {
      toast("Download failed", "error");
    }
  }

  async function toggleFavoriteDocument(documentId: string, favorited: boolean) {
    try {
      const res = await fetchWithAuth(`${API}/documents/${documentId}/favorite`, {
        method: favorited ? "POST" : "DELETE",
      });
      if (res.ok) await reloadDepartmentDocuments();
    } catch { /* network error — silent */ }
  }

  async function setArchivedDocument(documentId: string, archive: boolean) {
    try {
      const res = await fetchWithAuth(`${API}/documents/${documentId}/archive`, { method: archive ? "POST" : "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setDocsError(data.error ?? "Could not update archive state.");
        return;
      }
      await reloadDepartmentDocuments();
    } catch { setDocsError("Could not reach the server."); }
  }

  async function deleteDocument(documentId: string) {
    if (!(await confirm({ message: "Delete this document and all versions?", danger: true }))) return;
    const res = await fetchWithAuth(`${API}/documents/${documentId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast(data.error ?? "Delete failed", "error");
      return;
    }
    setPanelDoc(null);
    await reloadDepartmentDocuments();
  }

  const canManageDocumentsUi = restrictions?.manageDocumentsAllowed !== false;

  function copyDocumentId(id: string) {
    void navigator.clipboard.writeText(id).then(
      () => {},
      () => {
        window.prompt("Copy document ID:", id);
      },
    );
  }

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
      <main className={`${dash.page} ${styles.managerShell}`} data-dashboard-fullscreen="true">
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

  if (managerDeptsLoaded && manageableDepts.length === 0) {
    return (
      <main className={`${dash.page} ${styles.managerShell}`} data-dashboard-fullscreen="true">
        <AdminChromeHeader
          user={sessionUser}
          navVariant="manager"
          className={`${dash.navbar} ${styles.navbarRow}`}
        />
        <div className={styles.main} data-kp-page="manager-dashboard-empty">
          <div className={styles.pageHead}>
            <h1 className={styles.title}>Department overview</h1>
            <p className={styles.subtitle} style={{ maxWidth: "36rem" }}>
              No departments are available to manage with your account. If you were recently given manager access, try
              signing out and back in. Otherwise contact an administrator.
            </p>
            <div className={styles.metaRow} style={{ marginTop: "1rem" }}>
              <Link prefetch={false} href="/dashboard" className={styles.backLink}>
                Dashboard
              </Link>
              <span className={styles.metaDivider} aria-hidden />
              <Link prefetch={false} href="/documents" className={styles.backLink}>
                Documents
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const deptId = activeDeptId ?? deptPayload?.department.id;
  const libraryHref = deptId ? `/documents?dept=${encodeURIComponent(deptId)}` : "/documents";

  return (
    <main className={`${dash.page} ${styles.managerShell}`} data-dashboard-fullscreen="true">
      <AdminChromeHeader
        user={sessionUser}
        navVariant="manager"
        className={`${dash.navbar} ${styles.navbarRow}`}
      />

      <div className={styles.main} data-kp-page="manager-dashboard">
        <div className={styles.pageHead}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>Department overview</h1>
            {manageableDepts.length > 0 ? (
              <select
                className={styles.deptSelect}
                value={activeDeptId ?? ""}
                onChange={(e) => {
                  setActiveDeptId(e.target.value);
                  setMemberSearch("");
                  setMemberStatus("ALL");
                  setMemberPosition("ALL");
                  setDocSearch("");
                  setDocVisibility("ALL");
                  setDocStatus("ALL");
                  setDocFileType("ALL");
                  setDocDateFilter("ALL");
                  setDocTag("");
                }}
                aria-label={manageableDepts.length > 1 ? "Switch department" : "Department"}
              >
                {manageableDepts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <div className={styles.metaRow}>
            <Link prefetch={false} href="/dashboard" className={styles.backLink}>
              <svg className={styles.backLinkIcon} viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M15 18 9 12l6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Dashboard
            </Link>
            <span className={styles.metaDivider} aria-hidden />
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
                  <div className={styles.memberListWell}>
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
                                        width={42}
                                        height={42}
                                        sizes="42px"
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
                  <div className={styles.docsFilterRow}>
                    <div className={`${styles.filterGroup} ${styles.docsFilterActions}`}>
                      <span className={styles.filterLabel} id="mgr-doc-filters-label">
                        Filters
                      </span>
                      <div className={styles.docsFilterLeft} role="group" aria-labelledby="mgr-doc-filters-label">
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
                    </div>
                    <div className={`${styles.filterGroup} ${styles.docsFilterRowSearch}`}>
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
                    <div className={`${styles.filterGroup} ${styles.docsLibrarySlot}`}>
                      <span className={styles.filterLabel}>Browse</span>
                      <Link className={styles.ctaLibrary} href={libraryHref} prefetch={false}>
                        <svg className={styles.ctaLibraryIcon} viewBox="0 0 24 24" fill="none" aria-hidden>
                          <path
                            d="M4 4.5h7l3 3V19.5H4z"
                            stroke="currentColor"
                            strokeWidth="1.35"
                            strokeLinejoin="round"
                          />
                          <path d="M11 4.5v3h3" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
                        </svg>
                        Open library
                      </Link>
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
                          Apply filters
                        </button>
                      </div>
                    </div>
                  ) : null}
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
                  <div className={styles.docTableWrap}>
                    <table className={`${styles.table} ${styles.docTable}`}>
                      <thead>
                        <tr>
                          <th>Document</th>
                          <th>Visibility</th>
                          <th>Status</th>
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
                            <tr
                              key={d.id}
                              className={`${styles.docTableRow} ${panelDoc?.id === d.id ? styles.docTableRowSelected : ""}`}
                              data-interactive="true"
                              tabIndex={0}
                              aria-label={`${d.title}, view details`}
                              onClick={(e) => {
                                if ((e.target as HTMLElement).closest("a[href]")) return;
                                setPanelDoc(d);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setPanelDoc(d);
                                }
                              }}
                            >
                              <td>
                                <div className={styles.docTitleCell}>
                                  {fn ? (
                                    <span className={styles.docIcon}>
                                      <FileTypeIcon fileName={fn} variant="row" className={styles.docFileTypeIcon} />
                                    </span>
                                  ) : null}
                                  <span className={styles.docRowTitle}>{d.title}</span>
                                </div>
                              </td>
                              <td>
                                <span className={styles.visCap}>{d.visibility.toLowerCase()}</span>
                              </td>
                              <td>
                                <span className={`${styles.statusPill} ${pillClass}`}>{st}</span>
                              </td>
                              <td className={styles.cellDate}>{formatDocUpdatedAt(updated)}</td>
                              <td className={styles.actionCell}>
                                <Link
                                  className={styles.actionBtn}
                                  href={`/documents/${d.id}`}
                                  prefetch={false}
                                  onClick={(e) => e.stopPropagation()}
                                >
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

      <aside className={`${docStyles.detailsWrap} ${panelDoc ? docStyles.detailsOpen : ""}`}>
        <div className={docStyles.detailsCard}>
          {panelDoc ? (
            <>
              <div className={docStyles.detailsHeader}>
                <h2 className={docStyles.detailsTitle}>File details</h2>
                <button
                  type="button"
                  className={docStyles.detailsPanelBackBtn}
                  onClick={() => setPanelDoc(null)}
                  aria-label="Close details panel"
                  title="Close"
                >
                  <span className={docStyles.detailsPanelBackIcon} aria-hidden>
                    <IconSideBackArrow />
                  </span>
                </button>
              </div>

              <div className={docStyles.detailsBody}>
                <div className={docStyles.detailsPreviewFrame}>
                  <div className={docStyles.detailsPreview}>
                    <FileTypeIcon fileName={panelDoc.latestVersion?.fileName} variant="detail" />
                  </div>
                </div>

                <div className={docStyles.detailsDocTitleBlock}>
                  <p className={docStyles.detailsDocTitle}>{panelDoc.title}</p>
                </div>

                <div className={styles.mgrPanelCard}>
                  <h3 className={docStyles.detailsFieldLabel}>Description</h3>
                  <table className={styles.mgrMetaTable}>
                    <tbody>
                      <tr>
                        <th scope="row">Department &amp; access</th>
                        <td>
                          {panelDoc.departmentName ?? "General"}
                          <span className={docStyles.detailsDescSep}> · </span>
                          <strong className={styles.mgrAccessEm}>{panelDoc.visibility.toLowerCase()}</strong>
                        </td>
                      </tr>
                      {panelDoc.latestVersion ? (
                        <>
                          <tr>
                            <th scope="row">Latest version</th>
                            <td>Version {panelDoc.latestVersion.versionNumber}</td>
                          </tr>
                          <tr>
                            <th scope="row">Processing status</th>
                            <td>
                              <StatusLabel
                                status={panelDoc.latestVersion.processingStatus}
                                error={null}
                                progress={panelDoc.latestVersion.processingProgress}
                              />
                            </td>
                          </tr>
                          <tr>
                            <th scope="row">Version uploaded</th>
                            <td>
                              <time dateTime={panelDoc.latestVersion.createdAt}>
                                {new Date(panelDoc.latestVersion.createdAt).toLocaleString()}
                              </time>
                            </td>
                          </tr>
                        </>
                      ) : (
                        <tr>
                          <th scope="row">Files</th>
                          <td>No uploads yet.</td>
                        </tr>
                      )}
                      <tr>
                        <th scope="row">Uploaded by</th>
                        <td>
                          {panelDoc.createdBy.name}
                          <span className={docStyles.detailsDescSep}> · </span>
                          <time dateTime={panelDoc.createdAt}>
                            {new Date(panelDoc.createdAt).toLocaleString()}
                          </time>
                          <span className={docStyles.detailsDescSep}> · </span>
                          {panelDoc.createdBy.email}
                        </td>
                      </tr>
                      {panelDoc.description?.trim() ? (
                        <tr>
                          <th scope="row">Summary</th>
                          <td>{panelDoc.description}</td>
                        </tr>
                      ) : null}
                      <tr>
                        <th scope="row">Document ID</th>
                        <td>
                          <code className={styles.mgrDocIdChip}>{panelDoc.id}</code>
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Last updated</th>
                        <td>
                          <time dateTime={panelDoc.updatedAt ?? panelDoc.createdAt}>
                            {formatDocUpdatedAt(panelDoc.updatedAt ?? panelDoc.createdAt)}
                          </time>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  {panelDoc.tags.length > 0 ? (
                    <>
                      <hr className={styles.mgrCardDivider} />
                      <div className={styles.mgrTagRow} role="list">
                        {panelDoc.tags.map((t) => (
                          <span key={t} className={styles.mgrTagPill} role="listitem">
                            {t}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>

                <div className={styles.mgrPanelCard}>
                  <h3 className={docStyles.detailsFieldLabel}>Action</h3>
                  <div className={docStyles.actionsRow}>
                    <button
                      type="button"
                      className={docStyles.actionItem}
                      disabled={pdfPreviewLoading}
                      onClick={() => void openDocumentFromPanel(panelDoc)}
                    >
                      <span className={docStyles.actionIcon} aria-hidden>
                        <ActionIconOpen />
                      </span>
                      <span className={docStyles.actionLabel}>{pdfPreviewLoading ? "Opening…" : "Open"}</span>
                    </button>
                    {panelDoc.latestVersion ? (
                      <button
                        type="button"
                        className={docStyles.actionItem}
                        onClick={() =>
                          void downloadDocument(
                            panelDoc.id,
                            panelDoc.latestVersion!.id,
                            panelDoc.latestVersion!.fileName,
                          )
                        }
                      >
                        <span className={docStyles.actionIcon} aria-hidden>
                          <ActionIconDownload />
                        </span>
                        <span className={docStyles.actionLabel}>Download</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={docStyles.actionItem}
                      onClick={() => copyDocumentId(panelDoc.id)}
                    >
                      <span className={docStyles.actionIcon} aria-hidden>
                        <MgrActionIconCopy className={docStyles.actionIconSvg} />
                      </span>
                      <span className={docStyles.actionLabel}>Copy ID</span>
                    </button>
                    <button
                      type="button"
                      className={`${docStyles.actionItem} ${panelDoc.isFavorited ? docStyles.actionItemFavoriteActive : ""}`}
                      onClick={() => void toggleFavoriteDocument(panelDoc.id, !panelDoc.isFavorited)}
                    >
                      <span className={docStyles.actionIcon} aria-hidden>
                        <ActionIconHeart active={!!panelDoc.isFavorited} />
                      </span>
                      <span className={docStyles.actionLabel}>
                        {panelDoc.isFavorited ? "Unfavorite" : "Favorite"}
                      </span>
                    </button>
                    {canManageDocumentsUi ? (
                      <Link
                        prefetch={false}
                        href={`/documents/${panelDoc.id}`}
                        className={docStyles.actionItem}
                        style={{ textDecoration: "none" }}
                      >
                        <span className={docStyles.actionIcon} aria-hidden>
                          <MgrActionIconVersions className={docStyles.actionIconSvg} />
                        </span>
                        <span className={docStyles.actionLabel}>Versions</span>
                      </Link>
                    ) : null}
                    {canManageDocumentsUi ? (
                      <button
                        type="button"
                        className={docStyles.actionItem}
                        onClick={() => void setArchivedDocument(panelDoc.id, !panelDoc.isArchived)}
                      >
                        <span className={docStyles.actionIcon} aria-hidden>
                          <ActionIconArchive />
                        </span>
                        <span className={docStyles.actionLabel}>
                          {panelDoc.isArchived ? "Unarchive" : "Archive"}
                        </span>
                      </button>
                    ) : null}
                    {canManageDocumentsUi ? (
                      <button
                        type="button"
                        className={`${docStyles.actionItem} ${docStyles.actionItemDanger}`}
                        onClick={() => void deleteDocument(panelDoc.id)}
                      >
                        <span className={docStyles.actionIcon} aria-hidden>
                          <ActionIconDelete />
                        </span>
                        <span className={docStyles.actionLabel}>Delete</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className={docStyles.detailsEmptyState}>
              <p className={docStyles.detailsEmptyHint}>
                Click a file to open details, then use Open in the panel to view the document.
              </p>
            </div>
          )}
        </div>
      </aside>

      {pdfPreview || pdfPreviewLoading ? (
        <div
          className={docStyles.pdfPreviewBackdrop}
          role="presentation"
          onClick={() => {
            if (!pdfPreviewLoading) closePdfPreview();
          }}
        >
          <div
            className={docStyles.pdfPreviewModal}
            role="dialog"
            aria-modal="true"
            aria-label="PDF preview"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={docStyles.pdfPreviewHeader}>
              <h2 className={docStyles.pdfPreviewTitle}>{pdfPreview?.title ?? "Document preview"}</h2>
              <div className={docStyles.pdfPreviewHeaderActions}>
                <button type="button" className={docStyles.pdfPreviewLinkBtn} onClick={() => closePdfPreview()}>
                  Close
                </button>
              </div>
            </div>
            {pdfPreviewError ? <p className={docStyles.pdfPreviewInlineError}>{pdfPreviewError}</p> : null}
            {pdfPreviewLoading ? <p className={docStyles.pdfPreviewLoadingMsg}>Loading…</p> : null}
            {pdfPreview ? (
              <div className={docStyles.pdfPreviewBody}>
                <iframe
                  title="PDF preview"
                  src={`${pdfPreview.url}#view=FitH`}
                  style={{ width: "100%", height: "min(80dvh, 720px)", border: "none" }}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {imagePreview ? (
        <div
          className={docStyles.pdfPreviewBackdrop}
          role="presentation"
          onClick={() => {
            URL.revokeObjectURL(imagePreview.url);
            setImagePreview(null);
          }}
        >
          <div
            className={docStyles.pdfPreviewModal}
            role="dialog"
            aria-modal="true"
            aria-label="Image preview"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={docStyles.pdfPreviewHeader}>
              <h2 className={docStyles.pdfPreviewTitle}>{imagePreview.title}</h2>
              <button
                type="button"
                className={docStyles.pdfPreviewLinkBtn}
                onClick={() => {
                  URL.revokeObjectURL(imagePreview.url);
                  setImagePreview(null);
                }}
              >
                Close
              </button>
            </div>
            <div className={docStyles.pdfPreviewBody} style={{ display: "grid", placeItems: "center", padding: "1rem" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreview.url}
                alt=""
                style={{ maxWidth: "100%", maxHeight: "min(75dvh, 800px)", objectFit: "contain" }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
