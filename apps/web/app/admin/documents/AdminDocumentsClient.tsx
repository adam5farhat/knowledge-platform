"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import { ProfileAvatarImage } from "@/components/ProfileAvatarImage";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "../../../lib/authClient";
import { profilePictureDisplayUrl, userInitialsFromName } from "@/lib/profilePicture";
import dash from "../../components/shellNav.module.css";
import { AdminChromeHeader, type AdminChromeSessionUser } from "../AdminChromeHeader";
import AdminNav from "../AdminNav";
import styles from "./adminDocuments.module.css";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const PAGE_SIZE = 25;

type Phase = "checking" | "need-login" | "forbidden" | "ready";

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

function IconSearch() {
  return (
    <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm9 2-4.35-4.35"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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

export default function AdminDocumentsClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [sessionUser, setSessionUser] = useState<AdminChromeSessionUser | null>(null);

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

  const [includeArchived, setIncludeArchived] = useState(false);
  const [exportQ, setExportQ] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [bulkIds, setBulkIds] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [bulkErr, setBulkErr] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement | null>(null);

  const closePanel = useCallback(() => {
    setSelectedDocId(null);
    setPanelDetail(null);
    setPanelError(null);
    setOpenMenuId(null);
    setArchivesModalOpen(false);
    setArchivesError(null);
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
  }, [tab, debouncedQ]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const t = await getValidAccessToken();
      if (!t) {
        if (!cancelled) {
          setPhase("need-login");
          router.replace("/login");
        }
        return;
      }
      try {
        const meRes = await fetchWithAuth(`${API}/auth/me`);
        if (meRes.status === 401) {
          clearStoredSession();
          if (!cancelled) {
            setPhase("need-login");
            router.replace("/login");
          }
          return;
        }
        const me = (await meRes.json().catch(() => ({}))) as {
          user?: { name?: string; email?: string; role?: string; profilePictureUrl?: string | null };
        };
        if (!meRes.ok || me.user?.role !== "ADMIN") {
          if (!cancelled) setPhase("forbidden");
          return;
        }
        if (!cancelled) {
          setSessionUser({
            name: me.user?.name ?? "",
            email: me.user?.email ?? "",
            role: me.user?.role ?? "ADMIN",
            profilePictureUrl: me.user?.profilePictureUrl ?? null,
          });
          setPhase("ready");
        }
      } catch {
        if (!cancelled) setPhase("forbidden");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const loadDocuments = useCallback(async () => {
    if (phase !== "ready") return;
    setListLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      params.set("sort", "updatedAt_desc");
      if (debouncedQ) params.set("q", debouncedQ);

      if (tab === "archived") {
        params.set("libraryScope", "ARCHIVED");
      } else {
        params.set("libraryScope", "ALL");
        if (tab === "all") {
          params.set("includeArchived", "1");
        }
        if (tab === "completed") {
          params.set("status", "READY");
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
  }, [phase, page, debouncedQ, tab]);

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
    const onDown = (e: MouseEvent) => {
      if (!openMenuId) return;
      const el = menuRef.current;
      if (el && !el.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
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
  }, [openMenuId, archivesModalOpen, selectedDocId, closePanel, closeArchivesModal]);

  async function onExportCsv() {
    setExportErr(null);
    setExportBusy(true);
    try {
      const params = new URLSearchParams();
      params.set("libraryScope", "ALL");
      if (exportQ.trim()) params.set("q", exportQ.trim());
      if (includeArchived) params.set("includeArchived", "1");
      const res = await fetchWithAuth(`${API}/documents/export?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setExportErr(body.error ?? `Export failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "documents-export.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportErr("Could not download export.");
    } finally {
      setExportBusy(false);
    }
  }

  async function onBulkDelete() {
    setBulkErr(null);
    setBulkMsg(null);
    const raw = bulkIds
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const ids = raw.filter((id) => uuidRe.test(id));
    if (ids.length === 0) {
      setBulkErr("Enter at least one valid document UUID.");
      return;
    }
    if (ids.length > 50) {
      setBulkErr("You can delete at most 50 documents per request. Split into multiple batches.");
      return;
    }
    if (!window.confirm(`Permanently delete ${ids.length} document(s)? This cannot be undone.`)) {
      return;
    }
    setBulkBusy(true);
    try {
      const res = await fetchWithAuth(`${API}/documents/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; deleted?: number };
      if (!res.ok) {
        setBulkErr(data.error ?? "Bulk delete failed.");
        return;
      }
      setBulkMsg(`Deleted ${data.deleted ?? ids.length} document(s).`);
      setBulkIds("");
      if (selectedDocId && ids.includes(selectedDocId)) closePanel();
      void loadDocuments();
    } catch {
      setBulkErr("Could not reach the API.");
    } finally {
      setBulkBusy(false);
    }
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
        window.alert(body.error ?? "Request failed.");
        return;
      }
      void loadDocuments();
      if (selectedDocId === doc.id) void loadPanelDetail(doc.id);
    } catch {
      window.alert("Could not reach the server.");
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
        window.alert(body.error ?? "Request failed.");
        return;
      }
      void loadDocuments();
      void loadPanelDetail(documentId);
    } catch {
      window.alert("Could not reach the server.");
    } finally {
      setPanelActionBusy(false);
    }
  }

  async function deleteDocument(id: string, title: string) {
    if (!window.confirm(`Permanently delete “${title}”? This cannot be undone.`)) return;
    setRowBusyId(id);
    setOpenMenuId(null);
    try {
      const res = await fetchWithAuth(`${API}/documents/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        window.alert(body.error ?? "Delete failed.");
        return;
      }
      if (selectedDocId === id) closePanel();
      void loadDocuments();
    } catch {
      window.alert("Could not reach the server.");
    } finally {
      setRowBusyId(null);
    }
  }

  async function downloadFile(documentId: string, versionId: string, fileName: string) {
    try {
      const res = await fetchWithAuth(`${API}/documents/${documentId}/versions/${versionId}/file`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        window.alert(data.error ?? "Download failed");
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
      window.alert("Download failed.");
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
        else window.alert(msg);
        return;
      }
      void loadDocuments();
      void loadPanelDetail(documentId);
      if (context === "archives") setArchivesError(null);
    } catch {
      if (context === "archives") setArchivesError("Could not reach the server.");
      else window.alert("Could not reach the server.");
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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const listRowForPanel = selectedDocId ? documents.find((d) => d.id === selectedDocId) : undefined;

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
        <h1>Document administration</h1>
        <p style={{ color: "#52525b" }}>Sign in to continue.</p>
        <Link href="/login">Sign in</Link>
      </main>
    );
  }

  if (phase === "forbidden") {
    return (
      <main style={{ maxWidth: 560 }}>
        <h1>Document administration</h1>
        <p style={{ color: "var(--error)" }}>Administrators only.</p>
        <Link href="/dashboard">Dashboard</Link>
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
    <main className={dash.page} data-dashboard-fullscreen="true">
      <AdminChromeHeader user={sessionUser} />
      <div className={styles.workspace}>
        <div className={styles.shell}>
          <header className={styles.pageHead}>
            <h1 className={styles.title}>Document administration</h1>
            <p className={styles.subtitle}>
              Click a row to open details and management in the side panel—same flow as the document library explorer.
              Use the row menu for quick actions, or export and bulk tools below.
            </p>
          </header>

          <div className={styles.navSlot}>
            <AdminNav />
          </div>

          <div className={styles.toolbar}>
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
            <div className={styles.searchWrap}>
              <IconSearch />
              <input
                className={styles.searchInput}
                type="search"
                placeholder="Search documents…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="Search documents"
              />
            </div>
          </div>

          <p className={styles.countLine}>
            {listLoading ? "Loading…" : `${total.toLocaleString()} document${total === 1 ? "" : "s"}`}
          </p>

          {listError ? (
            <div className={styles.errorBanner} role="alert">
              {listError}
            </div>
          ) : null}

          <div className={styles.tableCard}>
            {listLoading && documents.length === 0 ? (
              <div className={styles.loading}>Loading documents…</div>
            ) : documents.length === 0 ? (
              <div className={styles.emptyState}>No documents match the current filters.</div>
            ) : (
              <>
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.th}>Document</th>
                        <th className={styles.th}>Uploaded</th>
                        <th className={styles.th}>Last updated</th>
                        <th className={styles.th}>Owner</th>
                        <th className={styles.th}>Status</th>
                        <th className={styles.th} aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {documents.map((d) => {
                        const fileName = d.latestVersion?.fileName ?? "—";
                        const st = d.latestVersion?.processingStatus ?? "";
                        const archived = d.isArchived === true;
                        const ownerSrc = profilePictureDisplayUrl(d.createdBy.profilePictureUrl ?? null);
                        const busy = rowBusyId === d.id;
                        const selected = selectedDocId === d.id;

                        return (
                          <tr
                            key={d.id}
                            className={`${styles.row} ${selected ? styles.rowSelected : ""}`}
                            onClick={() => {
                              setSelectedDocId(d.id);
                              setOpenMenuId(null);
                            }}
                          >
                            <td className={`${styles.td} ${styles.docCell}`}>
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
                            <td className={`${styles.td} ${styles.dateCell}`}>{formatUploadedDate(d.createdAt)}</td>
                            <td className={`${styles.td} ${styles.dateCell}`}>
                              {formatRelativeUpdated(d.updatedAt, d.createdAt)}
                            </td>
                            <td className={`${styles.td} ${styles.ownerCell}`}>
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
                            <td className={styles.td}>
                              <span className={`${styles.statusPill} ${statusPillClass(st, archived)}`}>
                                {archived ? "Archived" : statusLabel(st)}
                              </span>
                            </td>
                            <td
                              className={`${styles.td} ${styles.actionsCell}`}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              <div className={styles.menuWrap} ref={openMenuId === d.id ? menuRef : undefined}>
                                <button
                                  type="button"
                                  className={styles.menuBtn}
                                  aria-expanded={openMenuId === d.id}
                                  aria-haspopup="menu"
                                  aria-label={`Actions for ${d.title}`}
                                  disabled={busy}
                                  onClick={() => setOpenMenuId((prev) => (prev === d.id ? null : d.id))}
                                >
                                  <IconDots />
                                </button>
                                {openMenuId === d.id ? (
                                  <div className={styles.menuPanel} role="menu">
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
                      })}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 ? (
                  <div className={styles.pagination}>
                    <span className={styles.pageInfo}>
                      Page {page} of {totalPages}
                    </span>
                    <div className={styles.pageBtns}>
                      <button
                        type="button"
                        className={styles.pageBtn}
                        disabled={page <= 1 || listLoading}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        className={styles.pageBtn}
                        disabled={page >= totalPages || listLoading}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>

          <details className={styles.advanced}>
            <summary className={styles.advancedSummary}>CSV export & bulk delete</summary>
            <div className={styles.advancedBody}>
              <div className={styles.toolBlock}>
                <h2 className={styles.toolTitle}>CSV export</h2>
                <p className={styles.toolDesc}>
                  Exports up to 5,000 rows. Optional search filter; include archived to add archived files when the library
                  scope is “all”.
                </p>
                <label className={styles.fieldLabel}>
                  Optional title or description search
                  <input
                    className={styles.textInput}
                    value={exportQ}
                    onChange={(e) => setExportQ(e.target.value)}
                  />
                </label>
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={includeArchived}
                    onChange={(e) => setIncludeArchived(e.target.checked)}
                  />
                  <span>Include archived documents</span>
                </label>
                {exportErr ? (
                  <p className={styles.toolError} role="alert">
                    {exportErr}
                  </p>
                ) : null}
                <button
                  type="button"
                  className={styles.primaryBtn}
                  disabled={exportBusy}
                  onClick={() => void onExportCsv()}
                >
                  {exportBusy ? "Downloading…" : "Download CSV"}
                </button>
              </div>

              <div className={styles.toolBlock}>
                <h2 className={styles.toolTitle}>Bulk delete by ID</h2>
                <p className={styles.toolDesc}>
                  Paste document UUIDs, separated by commas or new lines. Maximum 50 per request. Storage files are removed.
                </p>
                <textarea
                  className={styles.textarea}
                  value={bulkIds}
                  onChange={(e) => setBulkIds(e.target.value)}
                  rows={5}
                  placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                  aria-label="Document IDs for bulk delete"
                />
                {bulkErr ? (
                  <p className={styles.toolError} role="alert">
                    {bulkErr}
                  </p>
                ) : null}
                {bulkMsg ? (
                  <p className={styles.toolOk} role="status">
                    {bulkMsg}
                  </p>
                ) : null}
                <button
                  type="button"
                  className={styles.dangerBtn}
                  disabled={bulkBusy}
                  onClick={() => void onBulkDelete()}
                >
                  {bulkBusy ? "Deleting…" : "Delete documents"}
                </button>
              </div>
            </div>
          </details>

          <p className={styles.libraryLink}>
            <Link href="/documents">Open document library (user view)</Link>
          </p>
        </div>

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
                                <li
                                  key={v.id}
                                  className={`${styles.versionRow} ${v.processingStatus === "FAILED" ? styles.versionRowFailed : ""}`}
                                >
                                  <div className={styles.versionMain}>
                                    <div className={styles.versionTitle}>
                                      v{v.versionNumber} {v.fileName}
                                    </div>
                                    <div className={styles.versionMeta}>
                                      {formatDocSize(v.sizeBytes)} · {statusLabel(v.processingStatus)}
                                    </div>
                                    {panelDetail.canManage && v.processingError ? (
                                      <div className={styles.procErrBox}>{v.processingError}</div>
                                    ) : null}
                                  </div>
                                  <div className={styles.versionMeta}>
                                    <time dateTime={v.createdAt}>{new Date(v.createdAt).toLocaleString()}</time>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </section>
                        ) : latest && panelDetail.canManage && latest.processingError ? (
                          <section className={styles.panelBlock}>
                            <h4 className={styles.panelBlockTitle}>Processing detail</h4>
                            <div className={styles.procErrBox}>{latest.processingError}</div>
                          </section>
                        ) : null}

                        <section className={styles.panelBlock}>
                          <h4 className={styles.panelBlockTitle}>Action</h4>
                          <div className={styles.panelActionsRow}>
                            <Link href={`/documents/${doc.id}`} className={styles.panelActionItem}>
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

              <div className={styles.archivesTableWrap}>
                <table className={styles.archivesTable}>
                  <thead>
                    <tr>
                      <th className={styles.archivesTh}>Ver</th>
                      <th className={styles.archivesTh}>File</th>
                      <th className={styles.archivesTh}>Size</th>
                      <th className={styles.archivesTh}>Status</th>
                      <th className={styles.archivesTh}>Uploaded</th>
                      <th className={styles.archivesTh}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {panelDetail.document.versions.length === 0 ? (
                      <tr>
                        <td className={styles.archivesTd} colSpan={6}>
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
                            <td className={styles.archivesTd}>
                              <span className={styles.archivesVer}>v{v.versionNumber}</span>
                              {isLatest ? (
                                <span className={styles.archivesLatestBadge}>Latest</span>
                              ) : null}
                            </td>
                            <td className={styles.archivesTd}>
                              <span className={styles.archivesFileName}>{v.fileName}</span>
                            </td>
                            <td className={styles.archivesTd}>{formatDocSize(v.sizeBytes)}</td>
                            <td className={styles.archivesTd}>
                              <span
                                className={
                                  v.processingStatus === "FAILED"
                                    ? styles.archivesStatusFailed
                                    : styles.archivesStatus
                                }
                              >
                                {statusLabel(v.processingStatus)}
                              </span>
                            </td>
                            <td className={styles.archivesTd}>
                              <time className={styles.archivesTime} dateTime={v.createdAt}>
                                {new Date(v.createdAt).toLocaleString()}
                              </time>
                            </td>
                            <td className={styles.archivesTd}>
                              <div className={styles.archivesActions}>
                                <button
                                  type="button"
                                  className={styles.archivesBtn}
                                  disabled={!!archivesDownloadingId || archivesUploadBusy}
                                  onClick={() =>
                                    void downloadVersionFromArchives(selectedDocId, v.id, v.fileName)
                                  }
                                >
                                  {archivesDownloadingId === v.id ? "…" : "Download"}
                                </button>
                                <button
                                  type="button"
                                  className={styles.archivesBtn}
                                  disabled={rowBusy}
                                  onClick={() => void copyVersionId(v.id)}
                                >
                                  Copy ver. ID
                                </button>
                                {panelDetail.canManage && v.processingStatus !== "PROCESSING" ? (
                                  <button
                                    type="button"
                                    className={styles.archivesBtn}
                                    disabled={!!archivesReprocessId || archivesUploadBusy}
                                    onClick={() =>
                                      void reprocessVersion(selectedDocId, v.id, "archives")
                                    }
                                  >
                                    {archivesReprocessId === v.id ? "…" : "Reprocess"}
                                  </button>
                                ) : null}
                              </div>
                              {panelDetail.canManage && v.processingError ? (
                                <p className={styles.archivesRowErr}>{v.processingError}</p>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {panelDetail.canManage ? (
                <div className={styles.archivesUploadBar}>
                  <span className={styles.archivesUploadLabel}>New version</span>
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
                  <span className={styles.archivesUploadHint}>
                    Same rules as the document library (supported types, max 50 MB).
                  </span>
                </div>
              ) : null}

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
