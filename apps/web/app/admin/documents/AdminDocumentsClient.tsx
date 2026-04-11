"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import { ProfileAvatarImage } from "@/components/ProfileAvatarImage";
import { fetchWithAuth } from "../../../lib/authClient";
import { profilePictureDisplayUrl, userInitialsFromName } from "@/lib/profilePicture";
import dash from "../../components/shellNav.module.css";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { AdminChromeHeader } from "../AdminChromeHeader";
import { useAdminGuard } from "../useAdminGuard";
import { AdminHubGlyph, type AdminHubGlyphType } from "../AdminHubIcons";
import u from "../users/adminUsers.module.css";
import styles from "./adminDocuments.module.css";
import { formatSize, normalizeUploadTag } from "../../documents/documentsFormat";
import { MAX_UPLOAD_TAGS } from "../../documents/documentsTypes";
import docStyles from "../../documents/page.module.css";
import { API_BASE as API } from "@/lib/apiBase";

type AdminSortKey =
  | "updatedAt_desc"
  | "updatedAt_asc"
  | "createdAt_desc"
  | "createdAt_asc"
  | "title_asc"
  | "title_desc";

type DeptOption = { id: string; name: string };
type OwnerOption = { id: string; name: string; email: string };


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

function LibraryFabIcon() {
  return (
    <svg className={styles.libraryFabIcon} width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type DocTab = "all" | "active" | "completed" | "archived";

type DocRow = {
  id: string;
  title: string;
  description?: string | null;
  visibility: string;
  departmentId: string | null;
  departmentName: string | null;
  createdAt: string;
  updatedAt?: string;
  isArchived?: boolean;
  isFavorited?: boolean;
  tags: string[];
  createdBy: { id: string; name: string; email: string; profilePictureUrl?: string | null };
  latestVersion: {
    id: string;
    versionNumber: number;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    processingStatus: string;
    processingError: string | null;
    createdAt: string;
  } | null;
};

type DocumentDetailPayload = {
  document: {
    id: string;
    title: string;
    description: string | null;
    visibility: string;
    departmentId: string | null;
    isArchived: boolean;
    createdAt: string;
    updatedAt: string;
    createdBy: { id: string; name: string; email: string };
    tags: string[];
    versions: Array<{
      id: string;
      versionNumber: number;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      processingStatus: string;
      processingError: string | null;
      createdAt: string;
    }>;
  };
  canManage: boolean;
  canViewAudit: boolean;
};

function formatDocSize(bytes: number | undefined) {
  if (!bytes || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploadedDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatRelativeUpdated(iso: string | undefined, fallbackIso: string) {
  const d = new Date(iso ?? fallbackIso);
  const now = Date.now();
  const sec = Math.round((now - d.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (sec < 45) return rtf.format(-Math.max(1, sec), "second");
  const min = Math.round(sec / 60);
  if (min < 60) return rtf.format(-min, "minute");
  const hr = Math.round(min / 60);
  if (hr < 36) return rtf.format(-hr, "hour");
  const day = Math.round(hr / 24);
  if (day < 21) return rtf.format(-day, "day");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function statusLabel(status: string) {
  switch (status) {
    case "READY":
      return "Ready";
    case "PROCESSING":
      return "Processing";
    case "PENDING":
      return "Pending";
    case "FAILED":
      return "Failed";
    default:
      return status || "—";
  }
}

function processingErrorHoverTitle(status: string, error: string | null | undefined) {
  if (status === "FAILED" && error?.trim()) return error.trim();
  return undefined;
}

function statusPillClass(status: string, archived: boolean) {
  if (archived) return styles.statusArchived;
  switch (status) {
    case "READY":
      return styles.statusReady;
    case "PROCESSING":
      return styles.statusProcessing;
    case "PENDING":
      return styles.statusPending;
    case "FAILED":
      return styles.statusFailed;
    default:
      return styles.statusPending;
  }
}

function visibilityShort(v: string) {
  switch (v) {
    case "DEPARTMENT":
      return "Department";
    case "PRIVATE":
      return "Private";
    case "ALL":
    default:
      return "All users";
  }
}

function tagsCellSummary(tags: string[]) {
  if (tags.length === 0) return "—";
  const show = tags.slice(0, 2);
  const rest = tags.length - show.length;
  return (
    <span className={styles.tagsCellInner}>
      {show.map((t) => (
        <span key={t} className={styles.tagChipMini}>
          {t}
        </span>
      ))}
      {rest > 0 ? <span className={styles.tagOverflow}>+{rest}</span> : null}
    </span>
  );
}

function IconDots() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  );
}

function PanelIconChevronLeft() {
  return (
    <svg className={styles.panelBackIcon} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15 18l-6-6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PanelIconOpen() {
  return (
    <svg className={styles.panelActionSvg} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline points="15 3 21 3 21 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PanelIconDownload() {
  return (
    <svg className={styles.panelActionSvg} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline points="7 10 12 15 17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PanelIconCopy() {
  return (
    <svg className={styles.panelActionSvg} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
      <path
        d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArchivesIconDownload() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="7 10 12 15 17 10"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
    </svg>
  );
}

function ArchivesIconCopy() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.65" />
      <path
        d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArchivesIconRefresh() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M23 4v6h-6M1 20v-6h6"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PanelIconRefresh() {
  return (
    <svg className={styles.panelActionSvg} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M23 4v6h-6M1 20v-6h6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PanelIconArchive() {
  return (
    <svg className={styles.panelActionSvg} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 8h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 8V6a1 1 0 0 1 1-1h1l1-2h10l1 2h1a1 1 0 0 1 1 1v2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PanelIconTrash() {
  return (
    <svg className={styles.panelActionSvg} viewBox="0 0 24 24" fill="none" aria-hidden>
      <polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="10" y1="11" x2="10" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="14" y1="11" x2="14" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PanelIconLayers() {
  return (
    <svg className={styles.panelActionSvg} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2L2 7l10 5 10-5-10-5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2 17l10 5 10-5M2 12l10 5 10-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Document record / metadata page (distinct from “open file” quick actions). */
function PanelIconDetails() {
  return (
    <svg className={styles.panelActionSvg} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="14 2 14 8 20 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="8" y1="13" x2="16" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="8" y1="17" x2="14" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function AdminDocumentsClient() {
  const pathname = usePathname();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { phase: authPhase, sessionUser } = useAdminGuard();

  const [tab, setTab] = useState<DocTab>("active");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [documents, setDocuments] = useState<DocRow[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [selectedBulkIds, setSelectedBulkIds] = useState<Set<string>>(() => new Set());

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [panelDetail, setPanelDetail] = useState<DocumentDetailPayload | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [panelActionBusy, setPanelActionBusy] = useState(false);

  const [archivesModalOpen, setArchivesModalOpen] = useState(false);
  const [archivesError, setArchivesError] = useState<string | null>(null);
  const [archivesDownloadingId, setArchivesDownloadingId] = useState<string | null>(null);
  const [archivesReprocessId, setArchivesReprocessId] = useState<string | null>(null);
  const [archivesUploadBusy, setArchivesUploadBusy] = useState(false);
  const archivesFileInputRef = useRef<HTMLInputElement | null>(null);
  const archivesModalTitleId = useId();
  const uploadModalTitleId = useId();

  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [bulkErr, setBulkErr] = useState<string | null>(null);

  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<AdminSortKey>("updatedAt_desc");
  const [filterDepartmentId, setFilterDepartmentId] = useState("");
  const [filterVisibility, setFilterVisibility] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterOwnerId, setFilterOwnerId] = useState("");
  const [filterTag, setFilterTag] = useState("");

  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [owners, setOwners] = useState<OwnerOption[]>([]);

  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadStep, setUploadStep] = useState<1 | 2 | 3>(1);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadVisibility, setUploadVisibility] = useState("ALL");
  const [uploadDepartmentId, setUploadDepartmentId] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadTags, setUploadTags] = useState<string[]>([]);
  const [uploadTagInput, setUploadTagInput] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  const [archivesAfterPanelLoad, setArchivesAfterPanelLoad] = useState(false);
  const newDocFileInputRef = useRef<HTMLInputElement | null>(null);

  const docMenuBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [docMenuBox, setDocMenuBox] = useState<{ top: number; left: number } | null>(null);
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);

  const resetUploadForm = useCallback(() => {
    setUploadStep(1);
    setUploadTitle("");
    setUploadFile(null);
    setUploadVisibility("ALL");
    setUploadDepartmentId(departments[0]?.id ?? "");
    setUploadDescription("");
    setUploadTags([]);
    setUploadTagInput("");
    setTagSuggestions([]);
    setUploadDragActive(false);
    setUploadErr(null);
    if (newDocFileInputRef.current) newDocFileInputRef.current.value = "";
  }, [departments]);

  const closePanel = useCallback(() => {
    setSelectedDocId(null);
    setPanelDetail(null);
    setPanelError(null);
    setOpenMenuId(null);
    setArchivesModalOpen(false);
    setArchivesError(null);
    setArchivesAfterPanelLoad(false);
  }, []);

  const closeArchivesModal = useCallback(() => {
    setArchivesModalOpen(false);
    setArchivesError(null);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(searchInput.trim()), 320);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [
    tab,
    debouncedQ,
    pageSize,
    sort,
    filterDepartmentId,
    filterVisibility,
    filterStatus,
    filterOwnerId,
    filterTag,
  ]);

  useEffect(() => {
    setSelectedBulkIds(new Set());
  }, [tab, page, pageSize, sort, filterDepartmentId, filterVisibility, filterStatus, filterOwnerId, filterTag]);

  useEffect(() => {
    if (authPhase !== "ready") return;
    let cancelled = false;
    void (async () => {
      try {
        const [dr, ur] = await Promise.all([
          fetchWithAuth(`${API}/admin/departments`),
          fetchWithAuth(`${API}/admin/users?page=1&pageSize=200`),
        ]);
        if (cancelled) return;
        if (dr.ok) {
          const dj = (await dr.json().catch(() => ({}))) as { departments?: DeptOption[] };
          if (dj.departments) setDepartments(dj.departments);
        }
        if (ur.ok) {
          const uj = (await ur.json().catch(() => ({}))) as {
            users?: { id: string; name: string; email: string }[];
          };
          if (uj.users) {
            setOwners(
              uj.users.map((x) => ({
                id: x.id,
                name: x.name?.trim() || x.email,
                email: x.email,
              })),
            );
          }
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authPhase]);

  const loadDocuments = useCallback(async () => {
    if (authPhase !== "ready") return;
    setListLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      params.set("sort", sort);
      if (debouncedQ) params.set("q", debouncedQ);
      if (filterTag.trim()) params.set("tag", filterTag.trim());
      if (filterVisibility !== "ALL") params.set("visibility", filterVisibility);
      if (filterDepartmentId === "__general") {
        params.set("departmentId", "__general");
      } else if (filterDepartmentId) {
        params.set("departmentId", filterDepartmentId);
      }
      if (filterOwnerId) params.set("createdById", filterOwnerId);

      if (tab === "archived") {
        params.set("libraryScope", "ARCHIVED");
      } else {
      params.set("libraryScope", "ALL");
        if (tab === "all") {
          params.set("includeArchived", "1");
        }
        if (tab === "completed") {
          params.set("status", "READY");
        } else if (filterStatus !== "ALL") {
          params.set("status", filterStatus);
        }
        if (tab === "active") {
          params.set("needsAttention", "1");
        }
      }

      const res = await fetchWithAuth(`${API}/documents?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Could not load documents (${res.status})`);
      }
      const data = (await res.json()) as { documents: DocRow[]; total: number };
      setDocuments(data.documents);
      setTotal(data.total);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Could not load documents.");
      setDocuments([]);
      setTotal(0);
    } finally {
      setListLoading(false);
    }
  }, [
    authPhase,
    page,
    pageSize,
    sort,
    debouncedQ,
    tab,
    filterDepartmentId,
    filterVisibility,
    filterStatus,
    filterOwnerId,
    filterTag,
  ]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const loadPanelDetail = useCallback(async (documentId: string) => {
    setPanelLoading(true);
    setPanelError(null);
    try {
      const res = await fetchWithAuth(`${API}/documents/${documentId}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Could not load document (${res.status})`);
      }
      const data = (await res.json()) as DocumentDetailPayload;
      setPanelDetail(data);
    } catch (e) {
      setPanelDetail(null);
      setPanelError(e instanceof Error ? e.message : "Could not load document.");
    } finally {
      setPanelLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedDocId) {
      setPanelDetail(null);
      setPanelError(null);
      setPanelLoading(false);
        return;
      }
    void loadPanelDetail(selectedDocId);
  }, [selectedDocId, loadPanelDetail]);

  useEffect(() => {
    if (!archivesAfterPanelLoad || !selectedDocId || panelLoading) return;
    if (panelDetail?.document.id !== selectedDocId) return;
    if (panelError) {
      setArchivesAfterPanelLoad(false);
      return;
    }
    setArchivesModalOpen(true);
    setArchivesAfterPanelLoad(false);
  }, [archivesAfterPanelLoad, selectedDocId, panelLoading, panelDetail, panelError]);

  useEffect(() => {
    if (!uploadModalOpen || uploadVisibility !== "DEPARTMENT") return;
    if (uploadDepartmentId) return;
    if (departments[0]) setUploadDepartmentId(departments[0].id);
  }, [uploadModalOpen, uploadVisibility, uploadDepartmentId, departments]);

  useEffect(() => {
    if (!uploadModalOpen || uploadStep !== 3) {
      setTagSuggestions([]);
      return;
    }
    const q = uploadTagInput.trim();
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetchWithAuth(
            `${API}/documents/tags/suggestions?q=${encodeURIComponent(q)}`,
          );
          if (!res.ok) return;
          const body = (await res.json()) as { tags?: string[] };
          const list = body.tags ?? [];
          setTagSuggestions(list.filter((x) => !uploadTags.includes(x)).slice(0, 16));
    } catch {
          setTagSuggestions([]);
        }
      })();
    }, 220);
    return () => clearTimeout(handle);
  }, [uploadModalOpen, uploadStep, uploadTagInput, uploadTags]);

  useLayoutEffect(() => {
    if (!openMenuId) {
      setDocMenuBox(null);
      return;
    }
    const openForId = openMenuId;
    const menuW = 208;
    function updatePosition() {
      const btn = docMenuBtnRefs.current.get(openForId);
      if (!btn) {
        setDocMenuBox(null);
        return;
      }
      const rect = btn.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.right - menuW, window.innerWidth - menuW - 8));
      setDocMenuBox({ top: rect.bottom + 4, left });
    }
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [openMenuId]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-admin-documents-row-menu]")) return;
      if (openMenuId) setOpenMenuId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (uploadModalOpen) {
        setUploadModalOpen(false);
        resetUploadForm();
        return;
      }
      if (openMenuId) {
        setOpenMenuId(null);
        return;
      }
      if (archivesModalOpen) {
        closeArchivesModal();
        return;
      }
      if (selectedDocId) closePanel();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [openMenuId, archivesModalOpen, selectedDocId, closePanel, closeArchivesModal, uploadModalOpen, resetUploadForm]);

  async function bulkDeleteByIds(ids: string[]) {
    const unique = [...new Set(ids)];
    setBulkErr(null);
    setBulkMsg(null);
    if (unique.length === 0) {
      setBulkErr("Select at least one document.");
      return;
    }
    if (unique.length > 50) {
      setBulkErr("You can delete at most 50 documents per request. Clear selection and try a smaller batch.");
      return;
    }
    if (!(await confirm({ title: "Delete", message: `Permanently delete ${unique.length} document(s)? This cannot be undone.`, danger: true }))) {
      return;
    }
    setBulkBusy(true);
    try {
      const res = await fetchWithAuth(`${API}/documents/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: unique }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; deleted?: number };
      if (!res.ok) {
        setBulkErr(data.error ?? "Bulk delete failed.");
        return;
      }
      setBulkMsg(`Deleted ${data.deleted ?? unique.length} document(s).`);
      setSelectedBulkIds(new Set());
      if (selectedDocId && unique.includes(selectedDocId)) closePanel();
      void loadDocuments();
    } catch {
      setBulkErr("Could not reach the API.");
    } finally {
      setBulkBusy(false);
    }
  }

  function toggleBulkSelected(id: string) {
    setSelectedBulkIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function toggleSelectAllOnPage() {
    const ids = documents.map((d) => d.id);
    const allOn = ids.length > 0 && ids.every((id) => selectedBulkIds.has(id));
    setSelectedBulkIds((prev) => {
      const n = new Set(prev);
      if (allOn) ids.forEach((i) => n.delete(i));
      else ids.forEach((i) => n.add(i));
      return n;
    });
  }

  function clearBulkSelection() {
    setSelectedBulkIds(new Set());
  }

  async function copyId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      /* ignore */
    }
    setOpenMenuId(null);
  }

  async function toggleArchive(doc: DocRow) {
    setRowBusyId(doc.id);
    setOpenMenuId(null);
    try {
      const path = `${API}/documents/${doc.id}/archive`;
      const method = doc.isArchived === true ? "DELETE" : "POST";
      const res = await fetchWithAuth(path, { method });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast(body.error ?? "Request failed.", "error");
        return;
      }
      void loadDocuments();
      if (selectedDocId === doc.id) void loadPanelDetail(doc.id);
    } catch {
      toast("Could not reach the server.", "error");
    } finally {
      setRowBusyId(null);
    }
  }

  async function toggleArchivePanel(documentId: string, currentlyArchived: boolean) {
    setPanelActionBusy(true);
    try {
      const path = `${API}/documents/${documentId}/archive`;
      const method = currentlyArchived ? "DELETE" : "POST";
      const res = await fetchWithAuth(path, { method });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast(body.error ?? "Request failed.", "error");
        return;
      }
      void loadDocuments();
      void loadPanelDetail(documentId);
    } catch {
      toast("Could not reach the server.", "error");
    } finally {
      setPanelActionBusy(false);
    }
  }

  async function deleteDocument(id: string, title: string) {
    if (!(await confirm({ title: "Delete", message: `Permanently delete “${title}”? This cannot be undone.`, danger: true }))) return;
    setRowBusyId(id);
    setOpenMenuId(null);
    try {
      const res = await fetchWithAuth(`${API}/documents/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast(body.error ?? "Delete failed.", "error");
        return;
      }
      if (selectedDocId === id) closePanel();
      void loadDocuments();
    } catch {
      toast("Could not reach the server.", "error");
    } finally {
      setRowBusyId(null);
    }
  }

  async function downloadFile(documentId: string, versionId: string, fileName: string) {
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
      toast("Download failed.", "error");
    }
  }

  async function reprocessVersion(
    documentId: string,
    versionId: string,
    context: "panel" | "archives" = "panel",
  ) {
    if (context === "archives") setArchivesReprocessId(versionId);
    else setPanelActionBusy(true);
    try {
      const res = await fetchWithAuth(`${API}/documents/${documentId}/versions/${versionId}/reprocess`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const msg = body.error ?? "Reprocess failed.";
        if (context === "archives") setArchivesError(msg);
        else toast(msg, "error");
        return;
      }
      void loadDocuments();
      void loadPanelDetail(documentId);
      if (context === "archives") setArchivesError(null);
    } catch {
      if (context === "archives") setArchivesError("Could not reach the server.");
      else toast("Could not reach the server.", "error");
    } finally {
      if (context === "archives") setArchivesReprocessId(null);
      else setPanelActionBusy(false);
    }
  }

  async function downloadVersionFromArchives(documentId: string, versionId: string, fileName: string) {
    setArchivesDownloadingId(versionId);
    try {
      await downloadFile(documentId, versionId, fileName);
    } finally {
      setArchivesDownloadingId(null);
    }
  }

  async function uploadArchivesVersion(documentId: string, file: File) {
    setArchivesUploadBusy(true);
    setArchivesError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetchWithAuth(`${API}/documents/${documentId}/versions`, {
        method: "POST",
        body: fd,
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setArchivesError(body.error ?? "Upload failed.");
        return;
      }
      void loadDocuments();
      void loadPanelDetail(documentId);
      if (archivesFileInputRef.current) archivesFileInputRef.current.value = "";
    } catch {
      setArchivesError("Could not reach the server.");
    } finally {
      setArchivesUploadBusy(false);
    }
  }

  async function copyVersionId(versionId: string) {
    try {
      await navigator.clipboard.writeText(versionId);
    } catch {
      /* ignore */
    }
  }

  async function submitNewDocument(e: React.FormEvent) {
    e.preventDefault();
    setUploadErr(null);
    if (!uploadFile || !uploadTitle.trim()) {
      setUploadErr("Choose a file and enter a title.");
      return;
    }
    if (uploadVisibility === "DEPARTMENT" && !uploadDepartmentId) {
      setUploadErr("Pick a department for department-only visibility.");
      return;
    }
    setUploadBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      fd.append("title", uploadTitle.trim());
      fd.append("visibility", uploadVisibility);
      if (uploadVisibility === "DEPARTMENT" && uploadDepartmentId) {
        fd.append("departmentId", uploadDepartmentId);
      }
      if (uploadDescription.trim()) {
        fd.append("description", uploadDescription.trim());
      }
      if (uploadTags.length > 0) {
        fd.append("tags", JSON.stringify(uploadTags));
      }
      const res = await fetchWithAuth(`${API}/documents/upload`, { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setUploadErr(data.error ?? "Upload failed.");
        return;
      }
      setUploadModalOpen(false);
      resetUploadForm();
      void loadDocuments();
    } catch {
      setUploadErr("Could not reach the API.");
    } finally {
      setUploadBusy(false);
    }
  }

  function openVersionsForRow(doc: DocRow) {
    setOpenMenuId(null);
    setArchivesError(null);
    if (
      selectedDocId === doc.id &&
      panelDetail?.document.id === doc.id &&
      !panelLoading &&
      !panelError
    ) {
      setArchivesModalOpen(true);
      return;
    }
    setSelectedDocId(doc.id);
    setArchivesAfterPanelLoad(true);
  }

  function cycleSort(col: "title" | "createdAt" | "updatedAt") {
    setSort((prev) => {
      if (col === "title") {
        return prev === "title_asc" ? "title_desc" : "title_asc";
      }
      if (col === "createdAt") {
        return prev === "createdAt_asc" ? "createdAt_desc" : "createdAt_asc";
      }
      return prev === "updatedAt_asc" ? "updatedAt_desc" : "updatedAt_asc";
    });
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const listRowForPanel = selectedDocId ? documents.find((d) => d.id === selectedDocId) : undefined;

  const pageAllSelected = documents.length > 0 && documents.every((d) => selectedBulkIds.has(d.id));
  const pageSomeSelected = documents.some((d) => selectedBulkIds.has(d.id));

  useLayoutEffect(() => {
    const el = headerCheckboxRef.current;
    if (el) el.indeterminate = pageSomeSelected && !pageAllSelected;
  }, [pageSomeSelected, pageAllSelected]);

  if (authPhase === "checking") {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }

  if (authPhase === "need-login") {
    return (
      <main style={{ maxWidth: 560 }}>
        <h1>Document administration</h1>
        <p style={{ color: "var(--muted)" }}>Sign in to continue.</p>
        <Link href="/login">Sign in</Link>
      </main>
    );
  }

  if (authPhase === "forbidden") {
    return (
      <main style={{ maxWidth: 560 }}>
        <h1>Document administration</h1>
        <p style={{ color: "var(--error)" }}>Administrators only.</p>
        <Link prefetch={false} href="/dashboard">Dashboard</Link>
      </main>
    );
  }

  if (authPhase === "load-error") {
  return (
      <main style={{ maxWidth: 560 }}>
        <h1>Document administration</h1>
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
                <h1 className={u.pageTitle}>Documents</h1>
                <p className={u.pageSubtitle}>
                  Search, filter, and manage the library. Click a row for the side panel. Use New document to upload from
                  here, or the floating button to open the member library view.
                </p>
              </div>
            </div>

            <div className={u.tableCard}>
              <div className={u.cardToolbar}>
                <div className={styles.cardToolbarLeft}>
                  <h2 className={u.cardToolbarTitle}>Document list</h2>
                  <div className={styles.tabs} role="tablist" aria-label="Document filters">
                    {(
                      [
                        ["all", "All"],
                        ["active", "Active"],
                        ["completed", "Completed"],
                        ["archived", "Archived"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={tab === key}
                        className={`${styles.tab} ${tab === key ? styles.tabActive : ""}`}
                        onClick={() => setTab(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={u.toolbarRight}>
                  <button
                    type="button"
                    className={u.btnPrimary}
                    onClick={() => {
                      resetUploadForm();
                      setUploadModalOpen(true);
                    }}
                  >
                    New document
                  </button>
                  <button
                    type="button"
                    className={styles.toolbarDeleteBtn}
                    disabled={
                      listLoading || bulkBusy || selectedBulkIds.size === 0 || selectedBulkIds.size > 50
                    }
                    title={
                      selectedBulkIds.size > 50
                        ? "Select at most 50 documents per delete"
                        : selectedBulkIds.size === 0
                          ? "Select documents with the row checkboxes"
                          : `Permanently delete ${selectedBulkIds.size} selected`
                    }
                    onClick={() => void bulkDeleteByIds([...selectedBulkIds])}
                  >
                    Delete
                  </button>
                  <div className={u.toolbarSearch}>
                    <ToolbarIconSearch />
          <input
                      type="search"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="Filter list…"
                      aria-label="Filter document list"
                    />
                  </div>
                </div>
              </div>

              <div className={styles.filterBar} role="group" aria-label="List filters">
                <label className={styles.filterField}>
                  <span className={styles.filterLabel}>Department</span>
                  <select
                    className={styles.filterSelect}
                    value={filterDepartmentId}
                    onChange={(e) => setFilterDepartmentId(e.target.value)}
                    aria-label="Filter by department"
                  >
                    <option value="">All departments</option>
                    <option value="__general">General (no department)</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
        </label>
                <label className={styles.filterField}>
                  <span className={styles.filterLabel}>Visibility</span>
                  <select
                    className={styles.filterSelect}
                    value={filterVisibility}
                    onChange={(e) => setFilterVisibility(e.target.value)}
                    aria-label="Filter by visibility"
                  >
                    <option value="ALL">All users</option>
                    <option value="DEPARTMENT">Department</option>
                    <option value="PRIVATE">Private</option>
                  </select>
                </label>
                <label className={styles.filterField}>
                  <span className={styles.filterLabel}>Processing</span>
                  <select
                    className={styles.filterSelect}
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    disabled={tab === "completed"}
                    aria-label="Filter by processing status"
                  >
                    <option value="ALL">Any status</option>
                    <option value="PENDING">Pending</option>
                    <option value="PROCESSING">Processing</option>
                    <option value="READY">Ready</option>
                    <option value="FAILED">Failed</option>
                  </select>
                </label>
                <label className={styles.filterField}>
                  <span className={styles.filterLabel}>Owner</span>
                  <select
                    className={styles.filterSelect}
                    value={filterOwnerId}
                    onChange={(e) => setFilterOwnerId(e.target.value)}
                    aria-label="Filter by document owner"
                  >
                    <option value="">Any owner</option>
                    {owners.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.filterField}>
                  <span className={styles.filterLabel}>Tag</span>
          <input
                    type="search"
                    className={styles.filterTagInput}
                    value={filterTag}
                    onChange={(e) => setFilterTag(e.target.value)}
                    placeholder="Exact tag…"
                    aria-label="Filter by tag name"
                  />
        </label>
                <label className={styles.filterField}>
                  <span className={styles.filterLabel}>Sort</span>
                  <select
                    className={styles.filterSelect}
                    value={sort}
                    onChange={(e) => setSort(e.target.value as AdminSortKey)}
                    aria-label="Sort list"
                  >
                    <option value="updatedAt_desc">Last updated · Newest</option>
                    <option value="updatedAt_asc">Last updated · Oldest</option>
                    <option value="createdAt_desc">Uploaded · Newest</option>
                    <option value="createdAt_asc">Uploaded · Oldest</option>
                    <option value="title_asc">Title A–Z</option>
                    <option value="title_desc">Title Z–A</option>
                  </select>
                </label>
                <label className={styles.filterField}>
                  <span className={styles.filterLabel}>Page size</span>
                  <select
                    className={styles.filterSelect}
                    value={String(pageSize)}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    aria-label="Rows per page"
                  >
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                </label>
              </div>

              {selectedBulkIds.size > 0 ? (
                <div className={styles.bulkSelectionBar}>
                  <span className={styles.bulkSelectionCount}>
                    {selectedBulkIds.size} selected
                    {selectedBulkIds.size > 50 ? (
                      <span className={styles.bulkSelectionWarn}> (max 50 per delete)</span>
                    ) : null}
                  </span>
                  <button type="button" className={u.btnGhost} onClick={clearBulkSelection}>
                    Clear selection
                  </button>
                </div>
              ) : null}

              {bulkErr ? (
                <p role="alert" className={styles.tableFeedbackErr}>
                  {bulkErr}
          </p>
        ) : null}
              {bulkMsg ? (
                <p role="status" className={styles.tableFeedbackOk}>
                  {bulkMsg}
                </p>
              ) : null}

              {listError ? (
                <p role="alert" style={{ color: "var(--error)", padding: "0 1.1rem" }}>
                  {listError}
                </p>
              ) : null}

              <div className={`${u.tableScroll} ${styles.docTableWrap}`}>
                <table className={u.dataTable}>
                  <thead>
                    <tr>
                      <th className={u.checkboxTh} scope="col">
                        <input
                          ref={headerCheckboxRef}
                          type="checkbox"
                          checked={pageAllSelected}
                          onChange={() => toggleSelectAllOnPage()}
                          aria-label="Select all documents on this page"
                        />
                      </th>
                      <th scope="col">
        <button
          type="button"
                          className={styles.sortThBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            cycleSort("title");
                          }}
                          aria-label={`Sort by title; current: ${sort.startsWith("title") ? sort : "other"}`}
                        >
                          Document
                          {sort === "title_asc" ? " ↑" : sort === "title_desc" ? " ↓" : ""}
        </button>
                      </th>
                      <th scope="col">Tags</th>
                      <th scope="col">Department</th>
                      <th scope="col">Visibility</th>
                      <th scope="col">
                        <button
                          type="button"
                          className={styles.sortThBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            cycleSort("createdAt");
                          }}
                          aria-label="Sort by upload date"
                        >
                          Uploaded
                          {sort === "createdAt_asc" ? " ↑" : sort === "createdAt_desc" ? " ↓" : ""}
                        </button>
                      </th>
                      <th scope="col">
                        <button
                          type="button"
                          className={styles.sortThBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            cycleSort("updatedAt");
                          }}
                          aria-label="Sort by last updated"
                        >
                          Last updated
                          {sort === "updatedAt_asc" ? " ↑" : sort === "updatedAt_desc" ? " ↓" : ""}
                        </button>
                      </th>
                      <th scope="col">Owner</th>
                      <th scope="col">Status</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.length === 0 ? (
                      <tr>
                        <td colSpan={10} className={u.cellMuted} style={{ padding: "1.25rem" }}>
                          {listLoading ? "Loading…" : "No documents match the current filters."}
                        </td>
                      </tr>
                    ) : (
                      documents.map((d) => {
                        const fileName = d.latestVersion?.fileName ?? "—";
                        const st = d.latestVersion?.processingStatus ?? "";
                        const archived = d.isArchived === true;
                        const ownerSrc = profilePictureDisplayUrl(d.createdBy.profilePictureUrl ?? null);
                        const busy = rowBusyId === d.id;
                        const panelOpen = selectedDocId === d.id;
                        const bulkOn = selectedBulkIds.has(d.id);

                        return (
                          <tr
                            key={d.id}
                            className={`${u.clickableRow}${bulkOn ? ` ${u.rowSelected}` : ""}${
                              panelOpen ? ` ${styles.rowPanelOpen}` : ""
                            }`}
                            onClick={() => {
                              setSelectedDocId(d.id);
                              setOpenMenuId(null);
                            }}
                          >
                            <td
                              className={u.checkboxCell}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={bulkOn}
                                onChange={() => toggleBulkSelected(d.id)}
                                aria-label={`Select ${d.title}`}
                              />
                            </td>
                            <td className={styles.docCell}>
                              <div className={styles.docRow}>
                                <span className={styles.docIcon}>
                                  <FileTypeIcon fileName={fileName} variant="row" />
                                </span>
                                <div className={styles.docText}>
                                  <p className={styles.docTitle}>
                                    <Link
                                      href={`/documents/${d.id}`}
                                      className={styles.docTitleLink}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {d.title}
                                    </Link>
                                  </p>
                                  <p className={styles.docMeta}>
                                    {fileName} · {formatDocSize(d.latestVersion?.sizeBytes)}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className={styles.tagsCell}>{tagsCellSummary(d.tags)}</td>
                            <td className={u.cellMuted}>{d.departmentName ?? "General"}</td>
                            <td className={u.cellMuted}>{visibilityShort(d.visibility)}</td>
                            <td className={u.cellMuted}>{formatUploadedDate(d.createdAt)}</td>
                            <td className={u.cellMuted}>{formatRelativeUpdated(d.updatedAt, d.createdAt)}</td>
                            <td className={styles.ownerCell}>
                              <div className={styles.owner}>
                                {ownerSrc ? (
                                  <ProfileAvatarImage
                                    className={styles.ownerAvatar}
                                    src={ownerSrc}
                                    alt=""
                                    width={36}
                                    height={36}
                                    sizes="36px"
                                  />
                                ) : (
                                  <span className={styles.ownerFallback} aria-hidden>
                                    {userInitialsFromName(d.createdBy.name, d.createdBy.email)}
                                  </span>
                                )}
                                <span className={styles.ownerName} title={d.createdBy.name}>
                                  {d.createdBy.name || d.createdBy.email}
                                </span>
                              </div>
                            </td>
                            <td>
                              <span className={`${styles.statusPill} ${statusPillClass(st, archived)}`}>
                                {archived ? "Archived" : statusLabel(st)}
                              </span>
                            </td>
                            <td onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                              <div className={styles.menuWrap} data-admin-documents-row-menu>
                                <button
                                  type="button"
                                  ref={(el) => {
                                    const m = docMenuBtnRefs.current;
                                    if (el) m.set(d.id, el);
                                    else m.delete(d.id);
                                  }}
                                  className={u.rowMenuBtn}
                                  aria-expanded={openMenuId === d.id}
                                  aria-haspopup="menu"
                                  aria-label={`Actions for ${d.title}`}
                                  disabled={busy}
                                  onClick={() => setOpenMenuId((prev) => (prev === d.id ? null : d.id))}
                                >
                                  <IconDots />
                                </button>
                                {openMenuId === d.id && docMenuBox ? (
                                  <div
                                    className={styles.menuPanelFixed}
                                    style={{ top: docMenuBox.top, left: docMenuBox.left, minWidth: 208 }}
                                    role="menu"
                                  >
                                    <Link
                                      href={`/documents/${d.id}`}
                                      className={styles.menuItem}
                                      role="menuitem"
                                      onClick={() => setOpenMenuId(null)}
                                    >
                                      Open document
                                    </Link>
                                    <button
                                      type="button"
                                      className={styles.menuItem}
                                      role="menuitem"
                                      onClick={() => void copyId(d.id)}
                                    >
                                      Copy document ID
                                    </button>
                                    <button
                                      type="button"
                                      className={styles.menuItem}
                                      role="menuitem"
                                      disabled={busy}
                                      onClick={() => openVersionsForRow(d)}
                                    >
                                      Versions…
                                    </button>
                                    <button
                                      type="button"
                                      className={styles.menuItem}
                                      role="menuitem"
                                      disabled={busy}
                                      onClick={() => void toggleArchive(d)}
                                    >
                                      {archived ? "Restore from archive" : "Archive"}
                                    </button>
                                    <button
                                      type="button"
                                      className={`${styles.menuItem} ${styles.menuItemDanger}`}
                                      role="menuitem"
                                      disabled={busy}
                                      onClick={() => void deleteDocument(d.id, d.title)}
                                    >
                                      Delete permanently
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className={u.paginationBar}>
                <button type="button" disabled={page <= 1 || listLoading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Previous
                </button>
                <span>
                  Page {page} of {totalPages} ({total} document{total === 1 ? "" : "s"})
                </span>
                <button type="button" disabled={page >= totalPages || listLoading} onClick={() => setPage((p) => p + 1)}>
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>

        {uploadModalOpen ? (
          <div
            className={styles.uploadModalBackdrop}
            role="presentation"
            onClick={() => !uploadBusy && (setUploadModalOpen(false), resetUploadForm())}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={uploadModalTitleId}
              className={styles.uploadModal}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={styles.uploadModalHeader}>
                <div>
                  <h2 id={uploadModalTitleId} className={styles.uploadModalTitle}>
                    Upload document
                  </h2>
                  <p className={styles.uploadModalSubtitle}>
                    {uploadStep === 1
                      ? "Choose a file, then add document details and tags."
                      : uploadStep === 2
                        ? "Set title and who can see this document."
                        : "Add tags to help others find this document (optional)."}
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.uploadModalClose}
                  aria-label="Close"
                  onClick={() => !uploadBusy && (setUploadModalOpen(false), resetUploadForm())}
                >
                  ×
                </button>
              </div>

              <div className={docStyles.uploadStepper} aria-label="Upload progress">
                <div className={docStyles.uploadStepperBadgeRow}>
                  <div
                    className={docStyles.uploadStepperTrack}
          style={{
                      background: `linear-gradient(to right, var(--interactive) 0%, var(--interactive) ${
                        uploadStep === 1 ? 0 : uploadStep === 2 ? 50 : 100
                      }%, var(--nav-border) ${uploadStep === 1 ? 0 : uploadStep === 2 ? 50 : 100}%, var(--nav-border) 100%)`,
                    }}
                    aria-hidden
                  />
                  <div className={`${docStyles.uploadStepperBadgeSlot} ${uploadStep >= 1 ? docStyles.uploadStepperItemActive : ""}`}>
                    <span className={docStyles.uploadStepperBadge}>1</span>
                  </div>
                  <div className={`${docStyles.uploadStepperBadgeSlot} ${uploadStep >= 2 ? docStyles.uploadStepperItemActive : ""}`}>
                    <span className={docStyles.uploadStepperBadge}>2</span>
                  </div>
                  <div className={`${docStyles.uploadStepperBadgeSlot} ${uploadStep >= 3 ? docStyles.uploadStepperItemActive : ""}`}>
                    <span className={docStyles.uploadStepperBadge}>3</span>
                  </div>
                </div>
                <div className={docStyles.uploadStepperLabelRow}>
                  <div className={`${docStyles.uploadStepperLabelCell} ${uploadStep >= 1 ? docStyles.uploadStepperItemActive : ""}`}>
                    <span className={docStyles.uploadStepperLabel}>File</span>
                  </div>
                  <div className={`${docStyles.uploadStepperLabelCell} ${uploadStep >= 2 ? docStyles.uploadStepperItemActive : ""}`}>
                    <span className={docStyles.uploadStepperLabel}>Details</span>
                  </div>
                  <div className={`${docStyles.uploadStepperLabelCell} ${uploadStep >= 3 ? docStyles.uploadStepperItemActive : ""}`}>
                    <span className={docStyles.uploadStepperLabel}>Tags</span>
                  </div>
                </div>
              </div>

              {uploadStep === 1 ? (
                <div className={styles.uploadModalBody}>
                  <p className={docStyles.uploadStepIntro}>Drop a file here or browse. Office documents and PDFs are supported.</p>
                  <div
                    className={`${docStyles.uploadDropZone} ${uploadDragActive ? docStyles.uploadDropZoneActive : ""} ${uploadFile ? docStyles.uploadDropZoneHasFile : ""}`}
                    onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setUploadDragActive(true); }}
                    onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setUploadDragActive(false); }}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setUploadDragActive(false);
                      const f = e.dataTransfer.files?.[0];
                      if (f) setUploadFile(f);
                    }}
                  >
                    <input
                      ref={newDocFileInputRef}
                      id="admin-upload-file-input"
                      type="file"
                      className={docStyles.uploadFileInput}
                      accept=".pdf,.doc,.docx,.txt,.html,.htm,.md,.csv,.xlsx,.xls,.pptx,.png,.jpg,.jpeg,.gif,.webp"
                      onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                    />
                    <label htmlFor="admin-upload-file-input" className={docStyles.uploadDropLabel}>
                      <span className={docStyles.uploadDropIcon} aria-hidden>
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M12 16V4m0 0 4 4m-4-4L8 8" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" strokeLinecap="round" />
                        </svg>
                      </span>
                      <span className={docStyles.uploadDropTitle}>{uploadFile ? "Replace file" : "Select or drop file"}</span>
                      <span className={docStyles.uploadDropHint}>Click to browse your device</span>
                    </label>
                  </div>
                  {uploadFile ? (
                    <div className={docStyles.uploadFilePreview}>
                      <div className={docStyles.uploadFilePreviewMain}>
                        <span className={docStyles.uploadFilePreviewName}>{uploadFile.name}</span>
                        <span className={docStyles.uploadFilePreviewMeta}>{formatSize(uploadFile.size)}</span>
                      </div>
                      <button
                        type="button"
                        className={docStyles.uploadFileRemove}
                        onClick={() => { setUploadFile(null); if (newDocFileInputRef.current) newDocFileInputRef.current.value = ""; }}
                      >
                        Remove
                      </button>
                    </div>
                  ) : null}
                  {uploadErr ? <p role="alert" className={styles.uploadModalErr}>{uploadErr}</p> : null}
                  <div className={styles.uploadModalActions}>
                    <button type="button" className={u.btnGhost} disabled={uploadBusy} onClick={() => { setUploadModalOpen(false); resetUploadForm(); }}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={u.btnPrimary}
                      disabled={!uploadFile || uploadBusy}
                      onClick={() => {
                        if (!uploadFile) return;
                        setUploadErr(null);
                        if (!uploadTitle.trim()) {
                          const stem = uploadFile.name.replace(/\.[^/.]+$/, "");
                          setUploadTitle(stem.length > 0 ? stem : uploadFile.name);
                        }
                        setUploadStep(2);
                      }}
                    >
                      Continue
                    </button>
                  </div>
                </div>
              ) : uploadStep === 2 ? (
                <div className={styles.uploadModalBody}>
                  <p className={docStyles.uploadStepIntro}>Document information stored with this file in the library.</p>
                  <label className={styles.uploadModalField}>
                    <span className={styles.uploadModalLabel}>Title</span>
                    <input
                      type="text"
                      className={styles.uploadModalInput}
                      value={uploadTitle}
                      onChange={(e) => setUploadTitle(e.target.value)}
                      autoComplete="off"
                      placeholder="Document title"
                      required
                    />
                  </label>
                  <label className={styles.uploadModalField}>
                    <span className={styles.uploadModalLabel}>Description (optional)</span>
                    <textarea
                      className={styles.uploadModalTextarea}
                      value={uploadDescription}
                      onChange={(e) => setUploadDescription(e.target.value)}
                      rows={3}
                      placeholder="Short summary or notes…"
                    />
                  </label>
                  <label className={styles.uploadModalField}>
                    <span className={styles.uploadModalLabel}>Visibility</span>
                    <select
                      className={styles.uploadModalInput}
                      value={uploadVisibility}
                      onChange={(e) => setUploadVisibility(e.target.value)}
                    >
                      <option value="ALL">Everyone (all users)</option>
                      <option value="DEPARTMENT">Department only</option>
                      <option value="PRIVATE">Private (only you)</option>
                    </select>
                  </label>
                  {uploadVisibility === "DEPARTMENT" ? (
                    <label className={styles.uploadModalField}>
                      <span className={styles.uploadModalLabel}>Department</span>
                      <select
                        className={styles.uploadModalInput}
                        value={uploadDepartmentId}
                        onChange={(e) => setUploadDepartmentId(e.target.value)}
                        required
                      >
                        {departments.length === 0 ? (
                          <option value="">Loading…</option>
                        ) : (
                          departments.map((d) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))
                        )}
                      </select>
                    </label>
                  ) : null}
                  <div className={docStyles.uploadSummary}>
                    <span className={docStyles.uploadSummaryLabel}>Attached file</span>
                    <span className={docStyles.uploadSummaryValue}>{uploadFile?.name ?? "—"}</span>
                  </div>
                  {uploadErr ? <p role="alert" className={styles.uploadModalErr}>{uploadErr}</p> : null}
                  <div className={styles.uploadModalActions}>
                    <button type="button" className={u.btnGhost} disabled={uploadBusy} onClick={() => { setUploadStep(1); setUploadErr(null); }}>
                      Back
                    </button>
                    <button
                      type="button"
                      className={u.btnPrimary}
                      disabled={uploadBusy || !uploadTitle.trim()}
                      onClick={() => {
                        if (!uploadTitle.trim()) { setUploadErr("Enter a title."); return; }
                        setUploadErr(null);
                        setUploadStep(3);
                      }}
                    >
                      Continue
                    </button>
                  </div>
                </div>
              ) : (
                <form className={styles.uploadModalBody} onSubmit={(e) => void submitNewDocument(e)}>
                  <p className={docStyles.uploadStepIntro}>
                    Type a tag and press Enter, or pick a suggestion. Lowercase letters, numbers, spaces, and{" "}
                    <code className={docStyles.uploadTagCode}>._+-</code> only.
                  </p>
                  <div className={docStyles.uploadTagField}>
                    <label htmlFor="admin-upload-tag-input" className={docStyles.uploadFieldLabel}>
                      Tags ({uploadTags.length}/{MAX_UPLOAD_TAGS})
                    </label>
                    <div className={docStyles.uploadTagInputWrap}>
                      {uploadTags.map((t) => (
                        <span key={t} className={docStyles.uploadTagChip}>
                          {t}
                          <button
                            type="button"
                            className={docStyles.uploadTagChipRemove}
                            onClick={() => setUploadTags((prev) => prev.filter((x) => x !== t))}
                            aria-label={`Remove tag ${t}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      <input
                        id="admin-upload-tag-input"
                        type="text"
                        className={docStyles.uploadTagTextInput}
                        value={uploadTagInput}
                        onChange={(e) => setUploadTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const n = normalizeUploadTag(uploadTagInput.replace(/,/g, " ").trim());
                            setUploadTagInput("");
                            if (!n) return;
                            if (uploadTags.includes(n)) return;
                            if (uploadTags.length >= MAX_UPLOAD_TAGS) return;
                            setUploadTags((prev) => [...prev, n]);
                          }
                        }}
                        placeholder={uploadTags.length >= MAX_UPLOAD_TAGS ? "Tag limit reached" : "Add tag…"}
                        disabled={uploadTags.length >= MAX_UPLOAD_TAGS}
                        autoComplete="off"
                      />
                    </div>
                    {tagSuggestions.length > 0 ? (
                      <ul className={docStyles.uploadTagSuggest} role="listbox" aria-label="Suggested tags">
                        {tagSuggestions.map((s) => (
                          <li key={s}>
                            <button
                              type="button"
                              className={docStyles.uploadTagSuggestBtn}
                              onClick={() => {
                                if (uploadTags.includes(s) || uploadTags.length >= MAX_UPLOAD_TAGS) return;
                                setUploadTags((prev) => [...prev, s]);
                                setUploadTagInput("");
                              }}
                            >
                              {s}
                            </button>
                          </li>
                        ))}
                      </ul>
        ) : null}
                  </div>
                  <div className={docStyles.uploadSummary}>
                    <span className={docStyles.uploadSummaryLabel}>Title</span>
                    <span className={docStyles.uploadSummaryValue}>{uploadTitle.trim() || "—"}</span>
                  </div>
                  {uploadErr ? <p role="alert" className={styles.uploadModalErr}>{uploadErr}</p> : null}
                  <div className={styles.uploadModalActions}>
                    <button type="button" className={u.btnGhost} disabled={uploadBusy} onClick={() => { setUploadStep(2); setUploadErr(null); }}>
                      Back
                    </button>
                    <button type="submit" disabled={uploadBusy} className={u.btnPrimary}>
                      {uploadBusy ? "Uploading…" : "Upload document"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        ) : null}

        <Link
          prefetch={false}
          href="/documents"
          className={styles.libraryFab}
          aria-label="Open document library"
          title="Document library"
        >
          <span className={styles.libraryFabInner}>
            <LibraryFabIcon />
          </span>
        </Link>

        <button
          type="button"
          className={`${styles.panelBackdrop} ${selectedDocId ? styles.panelBackdropVisible : ""}`}
          aria-label="Close document panel"
          tabIndex={selectedDocId ? 0 : -1}
          onClick={closePanel}
        />

        <aside
          className={`${styles.panelWrap} ${selectedDocId ? styles.panelOpen : ""}`}
          aria-hidden={!selectedDocId}
        >
          <div className={styles.panelCard}>
            {selectedDocId ? (
              <>
                <div className={styles.panelHeader}>
                  <h2 className={styles.panelHeaderTitle}>File details</h2>
                  <button type="button" className={styles.panelBackBtn} onClick={closePanel} aria-label="Close panel">
                    <PanelIconChevronLeft />
                  </button>
                </div>

                {panelLoading ? (
                  <div className={styles.panelBody}>
                    <div className={styles.panelLoading}>Loading…</div>
                  </div>
                ) : panelError ? (
                  <div className={styles.panelBody}>
                    <div className={styles.panelError} role="alert">
                      {panelError}
                    </div>
                  </div>
                ) : panelDetail ? (
                  (() => {
                    const doc = panelDetail.document;
                    const latest = doc.versions[0];
                    const deptName =
                      listRowForPanel?.departmentName ??
                      (doc.departmentId ? "Department" : "General");
                    const archived = doc.isArchived;

                    return (
                      <div className={styles.panelBody}>
                        <div className={styles.panelHero}>
                          <div className={styles.panelPreview}>
                            <div className={styles.panelPreviewInner}>
                              <FileTypeIcon fileName={latest?.fileName} variant="detail" />
                            </div>
                          </div>
                          <h3 className={styles.panelDocTitle}>{doc.title}</h3>
                          {latest?.fileName ? (
                            <p className={styles.panelFileSubtitle}>{latest.fileName}</p>
                          ) : null}
                          <hr className={styles.panelTitleDivider} />
                        </div>

                        <section className={styles.panelBlock}>
                          <h4 className={styles.panelBlockTitle}>Description</h4>
                          <dl className={styles.panelDescList}>
                            <div className={styles.panelDescRow}>
                              <dt className={styles.panelDescDt}>Department &amp; access</dt>
                              <dd className={styles.panelDescDd}>
                                {deptName}
                                <span className={styles.panelDescMuted}> · </span>
                                <span className={styles.panelAccessVal}>{doc.visibility}</span>
                                {archived ? <span className={styles.panelArchivedBadge}>Archived</span> : null}
                              </dd>
                            </div>
                            {latest ? (
                              <>
                                <div className={styles.panelDescRow}>
                                  <dt className={styles.panelDescDt}>Latest version</dt>
                                  <dd className={styles.panelDescDd}>Version {latest.versionNumber}</dd>
                                </div>
                                <div className={styles.panelDescRow}>
                                  <dt className={styles.panelDescDt}>Processing status</dt>
                                  <dd
                                    className={`${styles.panelDescDd} ${
                                      latest.processingStatus === "FAILED" ? styles.panelStatusFailed : ""
                                    }`}
                                    title={processingErrorHoverTitle(latest.processingStatus, latest.processingError)}
                                  >
                                    {statusLabel(latest.processingStatus)}
                                  </dd>
                                </div>
                                <div className={styles.panelDescRow}>
                                  <dt className={styles.panelDescDt}>Version uploaded</dt>
                                  <dd className={styles.panelDescDd}>
                                    <time dateTime={latest.createdAt}>
                                      {new Date(latest.createdAt).toLocaleString()}
                                    </time>
                                  </dd>
                                </div>
                              </>
                            ) : (
                              <div className={styles.panelDescRow}>
                                <dt className={styles.panelDescDt}>Files</dt>
                                <dd className={styles.panelDescDd}>No uploads yet.</dd>
                              </div>
                            )}
                            <div className={styles.panelDescRow}>
                              <dt className={styles.panelDescDt}>Uploaded by</dt>
                              <dd className={styles.panelDescDd}>
                                {doc.createdBy.name}
                                <span className={styles.panelDescMuted}> · </span>
                                <time dateTime={doc.createdAt}>{formatUploadedDate(doc.createdAt)}</time>
                                <span className={styles.panelDescMuted}>
                                  {" "}
                                  · {doc.createdBy.email}
                                </span>
                              </dd>
                            </div>
                            {doc.description?.trim() ? (
                              <div className={styles.panelDescRow}>
                                <dt className={styles.panelDescDt}>Summary</dt>
                                <dd className={styles.panelDescDd}>{doc.description}</dd>
                              </div>
                            ) : null}
                            <div className={styles.panelDescRow}>
                              <dt className={styles.panelDescDt}>Document ID</dt>
                              <dd className={styles.panelDescDd}>
                                <code className={styles.panelIdCode}>{doc.id}</code>
                              </dd>
                            </div>
                            <div className={styles.panelDescRow}>
                              <dt className={styles.panelDescDt}>Last updated</dt>
                              <dd className={styles.panelDescDd}>
                                <time dateTime={doc.updatedAt}>{new Date(doc.updatedAt).toLocaleString()}</time>
                              </dd>
                            </div>
                          </dl>
                          {doc.tags.length > 0 ? (
                            <div className={styles.tagList}>
                              {doc.tags.map((t) => (
                                <span key={t} className={styles.tagChip}>
                                  {t}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </section>

                        {doc.versions.length > 1 ? (
                          <section className={styles.panelBlock}>
                            <h4 className={styles.panelBlockTitle}>All versions</h4>
                            <ul className={styles.versionsList}>
                              {doc.versions.map((v) => (
                                <li key={v.id} className={styles.versionRow}>
                                  <div className={styles.versionRowInner}>
                                    <span className={styles.docIcon}>
                                      <FileTypeIcon fileName={v.fileName} variant="row" />
                                    </span>
                                    <div className={styles.docText}>
                                      <p className={styles.docTitle}>{v.fileName}</p>
                                      <p className={styles.docMeta}>
                                        v{v.versionNumber} · {formatDocSize(v.sizeBytes)} · {statusLabel(v.processingStatus)}
                                      </p>
                                    </div>
                                  </div>
                                  <time className={styles.versionRowTime} dateTime={v.createdAt}>
                                    {formatUploadedDate(v.createdAt)}
                                  </time>
                                </li>
                              ))}
                            </ul>
                          </section>
        ) : null}

                        <section className={styles.panelBlock}>
                          <h4 className={styles.panelBlockTitle}>Action</h4>
                          <div className={styles.panelActionsRow}>
                            <Link prefetch={false} href={`/documents/${doc.id}`} className={styles.panelActionItem}>
                              <span className={styles.panelActionIcon}>
                                <PanelIconOpen />
                              </span>
                              <span className={styles.panelActionLabel}>Open</span>
                            </Link>
                            {latest ? (
        <button
          type="button"
                                className={styles.panelActionItem}
                                disabled={panelActionBusy}
                                onClick={() => void downloadFile(doc.id, latest.id, latest.fileName)}
                              >
                                <span className={styles.panelActionIcon}>
                                  <PanelIconDownload />
                                </span>
                                <span className={styles.panelActionLabel}>Download</span>
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className={styles.panelActionItem}
                              disabled={panelActionBusy}
                              onClick={() => void copyId(doc.id)}
                            >
                              <span className={styles.panelActionIcon}>
                                <PanelIconCopy />
                              </span>
                              <span className={styles.panelActionLabel}>Copy ID</span>
                            </button>
                            <button
                              type="button"
                              className={styles.panelActionItem}
                              disabled={panelActionBusy}
                              onClick={() => {
                                setArchivesError(null);
                                setArchivesModalOpen(true);
                              }}
                              aria-label="Open version archive"
                            >
                              <span className={styles.panelActionIcon}>
                                <PanelIconLayers />
                              </span>
                              <span className={styles.panelActionLabel}>Versions</span>
        </button>
                            <Link
                              prefetch={false}
                              href={`/documents/${doc.id}`}
                              className={styles.panelActionItem}
                              title="Open full document page (metadata, versions, tags)"
                            >
                              <span className={styles.panelActionIcon}>
                                <PanelIconDetails />
                              </span>
                              <span className={styles.panelActionLabel}>Details</span>
                            </Link>
                            {panelDetail.canManage && latest && latest.processingStatus === "FAILED" ? (
                              <button
                                type="button"
                                className={styles.panelActionItem}
                                disabled={panelActionBusy}
                                onClick={() => void reprocessVersion(doc.id, latest.id, "panel")}
                              >
                                <span className={styles.panelActionIcon}>
                                  <PanelIconRefresh />
                                </span>
                                <span className={styles.panelActionLabel}>Reprocess</span>
                              </button>
                            ) : null}
                            {panelDetail.canManage ? (
                              <button
                                type="button"
                                className={styles.panelActionItem}
                                disabled={panelActionBusy}
                                onClick={() => void toggleArchivePanel(doc.id, archived)}
                              >
                                <span className={styles.panelActionIcon}>
                                  <PanelIconArchive />
                                </span>
                                <span className={styles.panelActionLabel}>{archived ? "Restore" : "Archive"}</span>
                              </button>
                            ) : null}
                            {panelDetail.canManage ? (
                              <button
                                type="button"
                                className={`${styles.panelActionItem} ${styles.panelActionItemDanger}`}
                                disabled={panelActionBusy}
                                onClick={() => void deleteDocument(doc.id, doc.title)}
                              >
                                <span className={`${styles.panelActionIcon} ${styles.panelActionIconDanger}`}>
                                  <PanelIconTrash />
                                </span>
                                <span className={styles.panelActionLabel}>Delete</span>
                              </button>
                            ) : null}
                          </div>
      </section>
                      </div>
                    );
                  })()
                ) : null}
              </>
            ) : null}
          </div>
        </aside>

        {archivesModalOpen && selectedDocId && panelDetail ? (
          <>
            <button
              type="button"
              className={styles.archivesBackdrop}
              aria-label="Close version archive"
              onClick={closeArchivesModal}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={archivesModalTitleId}
              className={styles.archivesDialog}
            >
              <div className={styles.archivesDialogHeader}>
                <h2 id={archivesModalTitleId} className={styles.archivesDialogTitle}>
                  Version archive
                </h2>
                <button
                  type="button"
                  className={styles.archivesDialogClose}
                  onClick={closeArchivesModal}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <p className={styles.archivesDialogSubtitle}>{panelDetail.document.title}</p>
              <p className={styles.archivesDialogHint}>
                All file versions for this document. Download any revision, re-run processing, or add a new upload.
              </p>
              {archivesError ? (
                <div className={styles.archivesError} role="alert">
                  {archivesError}
                </div>
              ) : null}

              {panelDetail.canManage ? (
                <div className={styles.archivesUploadBar}>
                  <div className={styles.archivesUploadHead}>
                    <span className={styles.archivesUploadLabel}>New version</span>
                    <p className={styles.archivesUploadLead}>
                      Upload a new file to create the next revision.
                    </p>
                  </div>
                  <div className={styles.archivesUploadActions}>
                    <input
                      ref={archivesFileInputRef}
                      type="file"
                      className={styles.archivesFileInput}
                      accept=".pdf,.doc,.docx,.txt,.html,.htm,.md,.csv,.xlsx,.xls,.pptx,.png,.jpg,.jpeg,.gif,.webp"
                      disabled={archivesUploadBusy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadArchivesVersion(selectedDocId, f);
                      }}
                    />
                    <button
                      type="button"
                      className={styles.archivesUploadBtn}
                      disabled={archivesUploadBusy}
                      onClick={() => archivesFileInputRef.current?.click()}
                    >
                      {archivesUploadBusy ? "Uploading…" : "Upload file…"}
                    </button>
                  </div>
                  <p className={styles.archivesUploadHint}>
                    Same rules as the document library (supported types, max 50 MB).
                  </p>
                </div>
              ) : null}

              <div className={styles.archivesTableWrap}>
                <table className={styles.archivesTable}>
                  <thead>
                    <tr>
                      <th className={styles.archivesTh}>File</th>
                      <th className={styles.archivesTh}>Status</th>
                      <th className={styles.archivesTh}>Uploaded</th>
                      <th className={styles.archivesTh}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {panelDetail.document.versions.length === 0 ? (
                      <tr>
                        <td className={styles.archivesTd} colSpan={4}>
                          No versions yet.
                        </td>
                      </tr>
                    ) : (
                      panelDetail.document.versions.map((v, idx) => {
                        const isLatest = idx === 0;
                        const rowBusy =
                          archivesDownloadingId === v.id || archivesReprocessId === v.id || archivesUploadBusy;
                        return (
                          <tr
                            key={v.id}
                            className={`${styles.archivesTr} ${isLatest ? styles.archivesTrLatest : ""}`}
                          >
                            <td className={`${styles.archivesTd} ${styles.archivesFileCell}`}>
                              <div className={styles.docRow}>
                                <span className={styles.docIcon}>
                                  <FileTypeIcon fileName={v.fileName} variant="row" />
                                </span>
                                <div className={styles.docText}>
                                  <p className={styles.docTitle}>{v.fileName}</p>
                                  <p className={styles.docMeta}>
                                    v{v.versionNumber} · {formatDocSize(v.sizeBytes)}
                                    {isLatest ? (
                                      <>
                                        {" "}
                                        · <span className={styles.archivesLatestBadge}>Latest</span>
                                      </>
                                    ) : null}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className={styles.archivesTd}>
                              <span
                                className={`${styles.statusPill} ${statusPillClass(v.processingStatus, false)}`}
                                title={processingErrorHoverTitle(v.processingStatus, v.processingError)}
                              >
                                {statusLabel(v.processingStatus)}
                              </span>
                            </td>
                            <td className={styles.archivesTd}>
                              <time className={styles.archivesTime} dateTime={v.createdAt}>
                                {formatUploadedDate(v.createdAt)}
                              </time>
                            </td>
                            <td className={styles.archivesTd}>
                              <div className={styles.archivesActions}>
                                <button
                                  type="button"
                                  className={styles.archivesIconBtn}
                                  title="Download this version"
                                  aria-label={`Download ${v.fileName}`}
                                  disabled={!!archivesDownloadingId || archivesUploadBusy}
                                  onClick={() =>
                                    void downloadVersionFromArchives(selectedDocId, v.id, v.fileName)
                                  }
                                >
                                  {archivesDownloadingId === v.id ? (
                                    <span className={styles.archivesIconSpinner} aria-hidden />
                                  ) : (
                                    <ArchivesIconDownload />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  className={styles.archivesIconBtn}
                                  title="Copy version ID"
                                  aria-label="Copy version ID to clipboard"
                                  disabled={rowBusy}
                                  onClick={() => void copyVersionId(v.id)}
                                >
                                  <ArchivesIconCopy />
                                </button>
                                {panelDetail.canManage && v.processingStatus !== "PROCESSING" ? (
                                  <button
                                    type="button"
                                    className={styles.archivesIconBtn}
                                    title="Reprocess this version"
                                    aria-label="Reprocess file"
                                    disabled={!!archivesReprocessId || archivesUploadBusy}
                                    onClick={() =>
                                      void reprocessVersion(selectedDocId, v.id, "archives")
                                    }
                                  >
                                    {archivesReprocessId === v.id ? (
                                      <span className={styles.archivesIconSpinner} aria-hidden />
                                    ) : (
                                      <ArchivesIconRefresh />
                                    )}
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className={styles.archivesFooter}>
                <button type="button" className={styles.archivesDoneBtn} onClick={closeArchivesModal}>
                  Done
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
