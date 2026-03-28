"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "../../lib/authClient";
import styles from "./page.module.css";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const MAX_UPLOAD_TAGS = 24;
const TAG_NAME_RE = /^[a-z0-9]+(?:[ .+_-][a-z0-9]+)*$/;

function normalizeUploadTag(raw: string): string | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 40)
    .trim();
  if (!s || !TAG_NAME_RE.test(s)) return null;
  return s;
}

type Me = {
  user: { id: string; email: string; name?: string; role: string; department: { id: string; name: string } };
};
type DocRow = {
  id: string;
  title: string;
  description?: string | null;
  visibility: string;
  departmentId: string | null;
  departmentName: string | null;
  createdAt: string;
  updatedAt?: string;
  createdBy: { name: string; email: string };
  tags: string[];
  isFavorited?: boolean;
  isArchived?: boolean;
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

type LibraryScope = "ALL" | "RECENT" | "FAVORITES" | "ARCHIVED";
type Dept = { id: string; name: string };

const TABLE_TAGS_VISIBLE = 3;

function initialsFromPerson(name: string | undefined, email: string) {
  const n = name?.trim();
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
    }
    if (parts[0] && parts[0].length >= 2) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    if (parts[0]) {
      return parts[0][0]!.toUpperCase();
    }
  }
  const e = email.trim();
  return (e[0] ?? "?").toUpperCase();
}

function formatUploadedOnLine(iso: string) {
  const d = new Date(iso);
  const day = d.getDate();
  const mon = d.toLocaleDateString(undefined, { month: "short" });
  return `Uploaded on ${day} ${mon}`;
}

function formatModifiedTable(iso: string | undefined, fallbackIso: string) {
  const d = new Date(iso ?? fallbackIso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function DocumentsClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<"checking" | "need-login" | "ready">("checking");
  const [me, setMe] = useState<Me["user"] | null>(null);
  const [documents, setDocuments] = useState<DocRow[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [visibility, setVisibility] = useState("ALL");
  const [departmentId, setDepartmentId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadOk, setUploadOk] = useState<string | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState<string>(() => {
    if (typeof window === "undefined") return "__all";
    return new URLSearchParams(window.location.search).get("dept") ?? "__all";
  });
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [visibilityFilter, setVisibilityFilter] = useState("ALL");
  const [fileTypeFilter, setFileTypeFilter] = useState("ALL");
  const [dateFilter, setDateFilter] = useState("ALL");
  const [tagFilter, setTagFilter] = useState("");
  const [sort, setSort] = useState("updatedAt_desc");
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadStep, setUploadStep] = useState<1 | 2 | 3>(1);
  const [uploadTags, setUploadTags] = useState<string[]>([]);
  const [uploadTagInput, setUploadTagInput] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const [pdfPreview, setPdfPreview] = useState<{ url: string; title: string; documentId: string } | null>(null);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [pdfPreviewError, setPdfPreviewError] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<{ url: string; title: string } | null>(null);
  const [libraryScope, setLibraryScope] = useState<LibraryScope>(() => {
    if (typeof window === "undefined") return "ALL";
    const sc = new URLSearchParams(window.location.search).get("scope")?.toLowerCase() ?? "";
    if (sc === "recent") return "RECENT";
    if (sc === "favorites") return "FAVORITES";
    if (sc === "archived") return "ARCHIVED";
    return "ALL";
  });
  const [listPage, setListPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);
  const [listHasMore, setListHasMore] = useState(false);
  const [departmentCountsMeta, setDepartmentCountsMeta] = useState<{ id: string; name: string; count: number }[] | null>(
    null,
  );
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkErr, setBulkErr] = useState<string | null>(null);
  const statusNotifyRef = useRef<Map<string, string>>(new Map());

  const isAdmin = useMemo(() => me?.role === "ADMIN", [me?.role]);

  const closePdfPreview = useCallback(() => {
    setPdfPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
    setPdfPreviewError(null);
    setPdfPreviewLoading(false);
  }, []);

  const loadDocuments = useCallback(
    async (pageNum: number, forDeptGridOnly?: boolean) => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (visibilityFilter !== "ALL") params.set("visibility", visibilityFilter);
      if (fileTypeFilter !== "ALL") params.set("fileType", fileTypeFilter);
      if (dateFilter !== "ALL") params.set("dateFilter", dateFilter);
      if (tagFilter.trim()) params.set("tag", tagFilter.trim());
      params.set("sort", sort);
      params.set("libraryScope", libraryScope);
      if (selectedDepartment !== "__all") {
        params.set("departmentId", selectedDepartment);
      }
      params.set("page", String(pageNum));
      params.set("pageSize", forDeptGridOnly ? "1" : "50");
      if (forDeptGridOnly || (libraryScope === "ALL" && selectedDepartment === "__all")) {
        params.set("includeMeta", "1");
      }
      const res = await fetchWithAuth(`${API}/documents?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Could not load documents");
      }
      const data = (await res.json()) as {
        documents: DocRow[];
        total: number;
        page: number;
        hasMore: boolean;
        meta?: { departmentCounts: { id: string; name: string; count: number }[] };
      };
      setDocuments(data.documents);
      setListTotal(data.total);
      setListPage(data.page);
      setListHasMore(data.hasMore);
      if (data.meta?.departmentCounts) {
        setDepartmentCountsMeta(data.meta.departmentCounts);
      }

      const nextMap = new Map(statusNotifyRef.current);
      for (const d of data.documents) {
        const st = d.latestVersion?.processingStatus ?? "";
        const prev = nextMap.get(d.id);
        if (prev && prev !== "READY" && st === "READY") {
          window.alert(`Ready: ${d.title}`);
        }
        nextMap.set(d.id, st);
      }
      statusNotifyRef.current = nextMap;
    },
    [
      q,
      sort,
      statusFilter,
      visibilityFilter,
      fileTypeFilter,
      dateFilter,
      tagFilter,
      libraryScope,
      selectedDepartment,
    ],
  );

  useEffect(() => {
    if (phase !== "ready" || typeof window === "undefined") return;
    const u = new URL(window.location.href);
    u.searchParams.delete("scope");
    u.searchParams.delete("dept");
    if (libraryScope !== "ALL") u.searchParams.set("scope", libraryScope.toLowerCase());
    if (selectedDepartment !== "__all") u.searchParams.set("dept", selectedDepartment);
    const qs = u.searchParams.toString();
    window.history.replaceState({}, "", `${u.pathname}${qs ? `?${qs}` : ""}`);
  }, [phase, libraryScope, selectedDepartment]);

  useEffect(() => {
    if (phase !== "ready") return;
    void loadDocuments(1, libraryScope === "ALL" && selectedDepartment === "__all");
  }, [
    phase,
    loadDocuments,
    libraryScope,
    selectedDepartment,
    q,
    sort,
    statusFilter,
    visibilityFilter,
    fileTypeFilter,
    dateFilter,
    tagFilter,
  ]);

  useEffect(() => {
    if (phase !== "ready") return;
    const busy = documents.some(
      (d) =>
        d.latestVersion?.processingStatus === "PENDING" ||
        d.latestVersion?.processingStatus === "PROCESSING",
    );
    if (!busy) return;
    const id = window.setInterval(() => {
      void loadDocuments(listPage, false).catch(() => {});
    }, 10000);
    return () => window.clearInterval(id);
  }, [phase, documents, listPage, loadDocuments]);

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
        if (!meRes.ok) throw new Error("me");
        const meJson = (await meRes.json()) as Me;
        if (!cancelled) setMe(meJson.user);

        if (meJson.user.role === "ADMIN") {
          const dr = await fetchWithAuth(`${API}/admin/departments`);
          if (dr.ok) {
            const d = (await dr.json()) as { departments: Dept[] };
            if (!cancelled) {
              setDepartments(d.departments);
              if (d.departments[0]) setDepartmentId(d.departments[0].id);
            }
          }
        }

        if (!cancelled) setPhase("ready");
      } catch {
        if (!cancelled) setLoadError("Could not load data.");
        if (!cancelled) setPhase("ready");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

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
        const res = await fetchWithAuth(
          `${API}/documents/${doc.id}/versions/${v.id}/file?inline=1`,
        );
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

  useEffect(() => {
    if (!pdfPreview && !pdfPreviewLoading && !imagePreview) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      closePdfPreview();
      setImagePreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return null;
      });
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pdfPreview, pdfPreviewLoading, imagePreview, closePdfPreview]);

  async function bulkDeleteSelected() {
    if (!isAdmin) return;
    const ids = Array.from(bulkSelected);
    if (ids.length === 0) return;
    if (ids.length > 50) {
      window.alert("You can delete at most 50 documents per request.");
      return;
    }
    if (!window.confirm(`Permanently delete ${ids.length} document(s)? This cannot be undone.`)) return;
    setBulkErr(null);
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
      setBulkSelected(new Set());
      if (selectedFileId && ids.includes(selectedFileId)) setSelectedFileId(null);
      closePdfPreview();
      setImagePreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return null;
      });
      await loadDocuments(listPage, false);
    } catch {
      setBulkErr("Could not reach the API.");
    } finally {
      setBulkBusy(false);
    }
  }

  useEffect(() => {
    if (!uploadModalOpen) return;
    setUploadStep(1);
    setUploadDragActive(false);
    setUploadError(null);
    setUploadOk(null);
    setUploadTags([]);
    setUploadTagInput("");
    setUploadDescription("");
    setTagSuggestions([]);
  }, [uploadModalOpen]);

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

  useEffect(() => {
    if (!uploadModalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setUploadModalOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [uploadModalOpen]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!profileMenuRef.current) return;
      if (!profileMenuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    }
    if (profileMenuOpen) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [profileMenuOpen]);

  async function signOut() {
    const refreshToken = localStorage.getItem("kp_refresh_token");
    if (refreshToken) {
      try {
        await fetch(`${API}/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
      } catch {
        // best-effort
      }
    }
    clearStoredSession();
    router.replace("/login");
    router.refresh();
  }

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    setUploadError(null);
    setUploadOk(null);
    const token = await getValidAccessToken();
    if (!token || !file || !title.trim()) {
      setUploadError("Choose a file and enter a title.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", title.trim());
      fd.append("visibility", visibility);
      if (visibility === "DEPARTMENT" && me?.role === "ADMIN" && departmentId) {
        fd.append("departmentId", departmentId);
      }
      if (uploadTags.length > 0) {
        fd.append("tags", JSON.stringify(uploadTags));
      }
      if (uploadDescription.trim()) {
        fd.append("description", uploadDescription.trim());
      }
      const res = await fetchWithAuth(`${API}/documents/upload`, {
        method: "POST",
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setUploadError(data.error ?? "Upload failed");
        return;
      }
      setUploadOk("Uploaded. Processing for search runs in the background.");
      setTitle("");
      setFile(null);
      setUploadTags([]);
      setUploadTagInput("");
      setUploadStep(1);
      setUploadModalOpen(false);
      await loadDocuments(1, libraryScope === "ALL" && selectedDepartment === "__all");
    } catch {
      setUploadError("Could not reach the API.");
    } finally {
      setUploading(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this document and all versions?")) return;
    const token = await getValidAccessToken();
    if (!token) return;
    const res = await fetchWithAuth(`${API}/documents/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      alert(data.error ?? "Delete failed");
      return;
    }
    await loadDocuments(listPage, false);
  }

  async function toggleFavoriteFor(documentId: string, favorited: boolean) {
    const res = await fetchWithAuth(`${API}/documents/${documentId}/favorite`, {
      method: favorited ? "POST" : "DELETE",
    });
    if (res.ok) await loadDocuments(listPage, false);
  }

  async function archiveDoc(documentId: string) {
    const res = await fetchWithAuth(`${API}/documents/${documentId}/archive`, { method: "POST" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      alert(data.error ?? "Could not archive this document.");
      return;
    }
    await loadDocuments(listPage, false);
  }

  async function unarchiveDoc(documentId: string) {
    const res = await fetchWithAuth(`${API}/documents/${documentId}/archive`, { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      alert(data.error ?? "Could not unarchive this document.");
      return;
    }
    await loadDocuments(listPage, false);
  }

  async function onDownload(documentId: string, versionId: string, fileName: string) {
    try {
      const res = await fetchWithAuth(`${API}/documents/${documentId}/versions/${versionId}/file`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        alert(data.error ?? "Download failed");
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
      // no-op
    }
  }

  const isManagerOrAdmin = me?.role === "ADMIN" || me?.role === "MANAGER";
  const canUploadDocuments = isManagerOrAdmin;

  const departmentItems = useMemo(() => {
    if (departmentCountsMeta && departmentCountsMeta.length > 0) {
      return departmentCountsMeta;
    }
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const d of documents) {
      const id = d.departmentId ?? "__general";
      const name = d.departmentName ?? (d.departmentId ? "Department" : "General");
      const prev = map.get(id);
      map.set(id, { id, name, count: (prev?.count ?? 0) + 1 });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [departmentCountsMeta, documents]);

  const scopeHeading =
    libraryScope === "RECENT"
      ? "Recent"
      : libraryScope === "FAVORITES"
        ? "Favorites"
        : libraryScope === "ARCHIVED"
          ? "Archived"
          : null;

  const departmentLabel =
    selectedDepartment === "__all"
      ? scopeHeading ?? "Departments"
      : departmentItems.find((d) => d.id === selectedDepartment)?.name ?? "Files";

  const breadcrumbForFolder =
    selectedDepartment === "__all"
      ? scopeHeading
        ? `Home › Documents › ${scopeHeading}`
        : "Home › Documents"
      : `Home › ${departmentLabel}`;

  const breadcrumbForFileCards = selectedDepartment === "__all" ? "" : `Home › ${departmentLabel}`;

  const selectedDoc = documents.find((d) => d.id === selectedFileId) ?? null;

  const profileInitials = useMemo(() => {
    if (!me) return "U";
    const name = me.name?.trim();
    if (name) {
      const parts = name.split(/\s+/);
      return ((parts[0]?.[0] ?? "U") + (parts[1]?.[0] ?? "")).toUpperCase();
    }
    return (me.email[0] ?? "U").toUpperCase();
  }, [me]);

  function fileExtension(fileName: string | undefined): string {
    return (fileName?.split(".").pop() ?? "FILE").toUpperCase();
  }

  function fileIcon(fileName: string | undefined) {
    const { kind, bannerLabel } = resolveFileIconKind(fileName);
    if (kind === "pdf") {
      return (
        <div className={`${styles.fileTypeIcon} ${styles.fileTypeIconPdfFull}`} aria-hidden>
          <IconPdfDocument className={styles.filePdfSvg} />
        </div>
      );
    }
    if (kind === "csv") {
      return (
        <div className={`${styles.fileTypeIcon} ${styles.fileTypeIconPdfFull}`} aria-hidden>
          <IconCsvDocument className={styles.filePdfSvg} />
        </div>
      );
    }
    if (kind === "word") {
      return (
        <div className={`${styles.fileTypeIcon} ${styles.fileTypeIconPdfFull}`} aria-hidden>
          <IconWordDocument className={styles.filePdfSvg} />
        </div>
      );
    }
    if (kind === "slides") {
      return (
        <div className={`${styles.fileTypeIcon} ${styles.fileTypeIconPdfFull}`} aria-hidden>
          <IconPptxDocument className={styles.filePdfSvg} />
        </div>
      );
    }
    let preview: ReactNode;
    if (kind === "doc") preview = <IconPreviewDoc />;
    else if (kind === "xls") preview = <IconPreviewXls />;
    else if (kind === "ppt") preview = <IconPreviewPpt />;
    else preview = <IconPreviewOther />;
    return (
      <div className={styles.fileTypeIcon} aria-hidden>
        <div className={styles.fileTypeBanner}>
          <span className={styles.fileTypeBannerText}>{bannerLabel}</span>
        </div>
        <div className={styles.fileTypePreviewBody}>{preview}</div>
      </div>
    );
  }

  if (phase === "checking" && !loadError) {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }

  if (phase === "need-login") {
    return (
      <main>
        <p>Redirecting to sign in…</p>
      </main>
    );
  }

  return (
    <main className={styles.shell} data-documents-fullscreen="true">
      <aside className={styles.sidebar}>
        <div className={styles.sideBrand}>
          <span className={styles.sideBrandText}>Library</span>
          <p className={styles.sideBrandSub}>Browse by department and open documents from one place.</p>
        </div>
        <div className={styles.sideScroll}>
          <section className={styles.sideSection} aria-labelledby="lib-browse-heading">
            <h2 id="lib-browse-heading" className={styles.sideTitle}>
              Browse
            </h2>
            <nav className={styles.sideNav} aria-labelledby="lib-browse-heading">
              <button
                type="button"
                className={`${styles.sideBtn} ${selectedDepartment === "__all" && libraryScope === "ALL" ? styles.activeSideBtn : ""}`}
                onClick={() => {
                  setLibraryScope("ALL");
                  setSelectedDepartment("__all");
                  setSelectedFileId(null);
                }}
              >
                <span className={styles.sideIcon} aria-hidden>
                  <SideIconHome />
                </span>
                <span>All departments</span>
              </button>
              {departmentItems.map((dep) => (
                <button
                  key={dep.id}
                  type="button"
                  className={`${styles.sideBtn} ${libraryScope === "ALL" && selectedDepartment === dep.id ? styles.activeSideBtn : ""}`}
                  onClick={() => {
                    setLibraryScope("ALL");
                    setSelectedDepartment(dep.id);
                    setSelectedFileId(null);
                  }}
                >
                  <span className={styles.sideIcon} aria-hidden>
                    <SideIconFolder />
                  </span>
                  <span>
                    {dep.name}
                    <span className={styles.sideCount}>({dep.count})</span>
                  </span>
                </button>
              ))}
            </nav>
          </section>
          <section className={styles.sideSection} aria-labelledby="lib-extra-heading">
            <h2 id="lib-extra-heading" className={styles.sideTitle}>
              Library
            </h2>
            <div className={styles.sideNav} role="group" aria-label="Library views">
              <button
                type="button"
                className={`${styles.sideBtn} ${libraryScope === "RECENT" ? styles.activeSideBtn : ""}`}
                onClick={() => {
                  setLibraryScope("RECENT");
                  setSelectedDepartment("__all");
                  setSelectedFileId(null);
                }}
              >
                <span className={styles.sideIcon} aria-hidden>
                  <SideIconClock />
                </span>
                <span>Recent</span>
              </button>
              <button
                type="button"
                className={`${styles.sideBtn} ${libraryScope === "FAVORITES" ? styles.activeSideBtn : ""}`}
                onClick={() => {
                  setLibraryScope("FAVORITES");
                  setSelectedDepartment("__all");
                  setSelectedFileId(null);
                }}
              >
                <span className={styles.sideIcon} aria-hidden>
                  <SideIconHeart />
                </span>
                <span>Favorites</span>
              </button>
              <button
                type="button"
                className={`${styles.sideBtn} ${libraryScope === "ARCHIVED" ? styles.activeSideBtn : ""}`}
                onClick={() => {
                  setLibraryScope("ARCHIVED");
                  setSelectedDepartment("__all");
                  setSelectedFileId(null);
                }}
              >
                <span className={styles.sideIcon} aria-hidden>
                  <SideIconArchive />
                </span>
                <span>Archived</span>
              </button>
            </div>
          </section>
        </div>
        <div className={styles.sideFooter}>
          <button type="button" className={styles.sideBackBtn} onClick={() => router.back()} aria-label="Go back to previous page">
            <span className={styles.sideBackIcon} aria-hidden>
              <IconSideBackArrow />
            </span>
            <span className={styles.sideBackTitle}>Back</span>
          </button>
        </div>
      </aside>

      <section className={styles.content}>
        <header className={styles.docNavbar}>
          <div className={styles.docNavLeft}>
            <Link href="/" className={styles.docNavBrand} aria-label="Knowledge Platform home">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.docNavLogo} src="/logo-swapped.svg" alt="" />
            </Link>
          </div>
          <div className={styles.docNavRight}>
            {me ? (
              <div className={styles.profileWrap} ref={profileMenuRef}>
                <button
                  type="button"
                  className={styles.profileBtn}
                  aria-haspopup="menu"
                  aria-expanded={profileMenuOpen}
                  onClick={() => setProfileMenuOpen((v) => !v)}
                  title={me.email}
                >
                  {profileInitials}
                </button>
                {profileMenuOpen ? (
                  <div className={styles.profileMenu} role="menu">
                    <div className={styles.profileMenuHeader}>
                      <div>{me.name ?? me.email}</div>
                      <div>{me.email}</div>
                    </div>
                    <Link className={styles.profileMenuItem} href="/profile" role="menuitem" onClick={() => setProfileMenuOpen(false)}>
                      Profile
                    </Link>
                    <Link className={styles.profileMenuItem} href="/dashboard" role="menuitem" onClick={() => setProfileMenuOpen(false)}>
                      Dashboard
                    </Link>
                    <button
                      type="button"
                      className={styles.profileMenuItem}
                      role="menuitem"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        void signOut();
                      }}
                    >
                      Log out
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>

        <div className={styles.filterBar}>
          <div className={styles.filterCluster}>
            <select value={fileTypeFilter} onChange={(e) => setFileTypeFilter(e.target.value)} className={styles.select}>
              <option value="ALL">File type</option>
              <option value="PDF">PDF</option>
              <option value="DOC">DOCX/DOC</option>
              <option value="TXT">TXT</option>
              <option value="IMG">Image</option>
            </select>
            <select value={visibilityFilter} onChange={(e) => setVisibilityFilter(e.target.value)} className={styles.select}>
              <option value="ALL">Category</option>
              <option value="DEPARTMENT">Department</option>
              <option value="PRIVATE">Private</option>
            </select>
            <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className={styles.select}>
              <option value="ALL">Date</option>
              <option value="TODAY">Today</option>
              <option value="WEEK">Last 7 days</option>
              <option value="MONTH">Last 30 days</option>
            </select>
            <input
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              placeholder="Tags..."
              className={styles.input}
              style={{ minWidth: "120px" }}
            />
            <select value={sort} onChange={(e) => setSort(e.target.value)} className={styles.select}>
              <option value="updatedAt_desc">Sort: Date</option>
              <option value="title_asc">Sort: Name</option>
              <option value="updatedAt_asc">Sort: Oldest</option>
              <option value="title_desc">Sort: Z-A</option>
            </select>
            <button type="button" className={styles.primary} onClick={() => void loadDocuments(listPage, false)}>
              Refresh
            </button>
            <button type="button" className={styles.ghost} onClick={() => setViewMode((v) => (v === "grid" ? "table" : "grid"))}>
              {viewMode === "grid" ? "Table view" : "Grid view"}
            </button>
          </div>
          <div className={styles.searchCluster}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search documents…"
              className={styles.searchInput}
              aria-label="Search documents"
            />
          </div>
        </div>

        <section className={styles.body}>
          {selectedDepartment === "__all" && libraryScope === "ALL" ? (
            <section className={`${styles.panelCard} ${styles.explorerCard}`}>
              <p className={styles.explorerPath}>{breadcrumbForFolder}</p>
              <div className={styles.explorerHeadRow}>
                <div>
                  <h2 className={styles.explorerHeading}>Departments</h2>
                  <p className={styles.explorerSub}>Select a department to view its documents. Counts include files you can access.</p>
                </div>
              </div>
              <div className={styles.deptGrid}>
                {departmentItems.map((dep) => (
                  <article
                    key={dep.id}
                    className={styles.deptCard}
                    onClick={() => {
                      setLibraryScope("ALL");
                      setSelectedDepartment(dep.id);
                    }}
                  >
                    <span className={styles.deptCardIcon} aria-hidden>
                      <DeptCardFolderIcon className={styles.deptCardIconSvg} />
                    </span>
                    <h3 className={styles.deptCardTitle}>{dep.name}</h3>
                    <p className={styles.deptCardMeta}>
                      {dep.count} {dep.count === 1 ? "file" : "files"}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          ) : (
            <section className={`${styles.panelCard} ${styles.explorerCard}`}>
              <p className={styles.explorerPath}>{breadcrumbForFolder}</p>
              <div className={styles.explorerHeadRow}>
                <div className={styles.explorerHeadTexts}>
                  <h2 className={styles.explorerHeading}>{departmentLabel}</h2>
                </div>
                <button
                  type="button"
                  className={styles.explorerBackBtn}
                  onClick={() => {
                    if (libraryScope !== "ALL") {
                      setLibraryScope("ALL");
                      setSelectedDepartment("__all");
                    } else {
                      setSelectedDepartment("__all");
                    }
                    setSelectedFileId(null);
                  }}
                  aria-label="Back to library home"
                  title="Back to library home"
                >
                  <span className={styles.explorerBackIcon} aria-hidden>
                    <IconSideBackArrow />
                  </span>
                </button>
              </div>
              {loadError ? <p style={{ color: "var(--error)" }}>{loadError}</p> : null}
              {isAdmin && bulkSelected.size > 0 ? (
                <div
                  role="region"
                  aria-label="Bulk actions"
                  style={{
                    marginTop: "0.75rem",
                    padding: "0.65rem 0.75rem",
                    border: "1px solid #e4e4e7",
                    borderRadius: 8,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.65rem",
                    alignItems: "center",
                    background: "#fafafa",
                  }}
                >
                  <span style={{ fontSize: "0.9rem" }}>
                    {bulkSelected.size} selected (admins only; max 50 per delete)
                  </span>
                  <button
                    type="button"
                    disabled={bulkBusy}
                    onClick={() => setBulkSelected(new Set())}
                    style={{
                      padding: "0.35rem 0.65rem",
                      borderRadius: 6,
                      border: "1px solid #d4d4d8",
                      background: "#fff",
                      cursor: bulkBusy ? "wait" : "pointer",
                    }}
                  >
                    Clear selection
                  </button>
                  <button
                    type="button"
                    disabled={bulkBusy}
                    onClick={() => void bulkDeleteSelected()}
                    style={{
                      padding: "0.35rem 0.65rem",
                      borderRadius: 6,
                      border: "none",
                      background: "#b91c1c",
                      color: "#fff",
                      cursor: bulkBusy ? "wait" : "pointer",
                    }}
                  >
                    {bulkBusy ? "Deleting…" : "Delete permanently"}
                  </button>
                  <Link href="/admin/documents" style={{ fontSize: "0.88rem", color: "#2563eb" }}>
                    Advanced tools (CSV export…)
                  </Link>
                  {bulkErr ? (
                    <span role="alert" style={{ color: "var(--error)", fontSize: "0.88rem" }}>
                      {bulkErr}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {documents.length === 0 ? (
                <p className={styles.detailMeta}>
                  {libraryScope === "ARCHIVED"
                    ? "Nothing in the archive yet. Managers can archive documents from the file details panel; everyone will see them here once archived."
                    : "No files in this section yet."}
                </p>
              ) : null}
              {viewMode === "grid" ? (
                <div className={styles.fileGrid}>
                  {documents.map((d) => (
                    <article
                      key={d.id}
                      className={`${styles.fileCard} ${selectedFileId === d.id ? styles.fileCardSelected : ""}`}
                      onClick={() => setSelectedFileId(d.id)}
                      aria-selected={selectedFileId === d.id}
                    >
                      <div className={styles.fileCardInner}>
                        {isAdmin ? (
                          <label
                            className={styles.fileCardBulk}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={bulkSelected.has(d.id)}
                              onChange={() => {
                                setBulkSelected((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(d.id)) next.delete(d.id);
                                  else next.add(d.id);
                                  return next;
                                });
                              }}
                              aria-label={`Select ${d.title}`}
                            />
                          </label>
                        ) : null}
                        <div className={styles.fileCardIconWrap}>{fileIcon(d.latestVersion?.fileName)}</div>
                        <h3 className={styles.fileCardTitle}>{d.title}</h3>
                        <p className={styles.fileCardMeta}>
                          {formatSize(d.latestVersion?.sizeBytes)} · {new Date(d.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <>
                  <h3 className={styles.documentsListTitle}>Documents</h3>
                  <div className={styles.tableScroll}>
                    <table className={`${styles.table} ${styles.tableListView}`}>
                      <colgroup>
                        {isAdmin ? <col className={styles.tableColCheck} /> : null}
                        <col className={styles.tableColName} />
                        <col className={styles.tableColTags} />
                        <col className={styles.tableColShared} />
                        <col className={styles.tableColModified} />
                        <col className={styles.tableColFav} />
                      </colgroup>
                      <thead>
                        <tr>
                          {isAdmin ? (
                            <th className={styles.tableThCheck} scope="col">
                              <span className={styles.tableThSr}>Select</span>
                            </th>
                          ) : null}
                          <th className={styles.tableThName} scope="col">
                            File name
                          </th>
                          <th className={styles.tableThTags} scope="col">
                            Tags
                          </th>
                          <th className={styles.tableThShared} scope="col">
                            Shared with
                          </th>
                          <th className={styles.tableThModified} scope="col">
                            Modified date
                          </th>
                          <th className={styles.tableThFav} scope="col">
                            <span className={styles.tableThSr}>Favorite</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {documents.map((d) => {
                          const tags = d.tags ?? [];
                          const visibleTags = tags.slice(0, TABLE_TAGS_VISIBLE);
                          const tagOverflow = tags.length - visibleTags.length;
                          const showSecondShare = d.visibility === "ALL" || d.visibility === "DEPARTMENT";
                          const deptInitial = (d.departmentName?.trim() ?? "").charAt(0).toUpperCase() || "D";
                          const scopeLabel = d.visibility === "ALL" ? "All" : deptInitial;
                          return (
                            <tr
                              key={d.id}
                              className={`${styles.tableRow} ${styles.tableListRow} ${selectedFileId === d.id ? styles.tableRowSelected : ""}`}
                              onClick={() => setSelectedFileId(d.id)}
                              aria-selected={selectedFileId === d.id}
                            >
                              {isAdmin ? (
                                <td className={styles.tableTdCheck} onClick={(e) => e.stopPropagation()}>
                                  <label className={styles.tableCheckLabel}>
                                    <input
                                      type="checkbox"
                                      checked={bulkSelected.has(d.id)}
                                      onChange={() => {
                                        setBulkSelected((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(d.id)) next.delete(d.id);
                                          else next.add(d.id);
                                          return next;
                                        });
                                      }}
                                      aria-label={`Select ${d.title}`}
                                    />
                                  </label>
                                </td>
                              ) : null}
                              <td className={styles.tableTdName}>
                                <div className={styles.tableNameCell}>
                                  <div className={styles.tableRowFileIcon}>{fileIcon(d.latestVersion?.fileName)}</div>
                                  <div className={styles.tableNameTexts}>
                                    <div className={styles.tableNameTitle}>{d.title}</div>
                                    <div className={styles.tableNameSub}>{formatUploadedOnLine(d.createdAt)}</div>
                                  </div>
                                </div>
                              </td>
                              <td className={styles.tableTdTags}>
                                {tags.length === 0 ? (
                                  <span className={styles.tableTagsEmpty}>—</span>
                                ) : (
                                  <div className={styles.tableTagsRow}>
                                    {visibleTags.map((t) => (
                                      <span key={t} className={styles.tableTagPill}>
                                        {t}
                                      </span>
                                    ))}
                                    {tagOverflow > 0 ? (
                                      <span className={styles.tableTagPill} title={tags.slice(TABLE_TAGS_VISIBLE).join(", ")}>
                                        +{tagOverflow}
                                      </span>
                                    ) : null}
                                  </div>
                                )}
                              </td>
                              <td className={styles.tableTdShared}>
                                <div
                                  className={styles.tableAvatarStack}
                                  title={`Uploaded by ${d.createdBy.name ?? d.createdBy.email}`}
                                  aria-label={
                                    showSecondShare
                                      ? `Uploaded by ${d.createdBy.name ?? d.createdBy.email}; shared: ${d.visibility === "ALL" ? "everyone" : d.departmentName ?? "department"}`
                                      : `Private; uploaded by ${d.createdBy.name ?? d.createdBy.email}`
                                  }
                                >
                                  <span className={`${styles.tableAvatar} ${styles.tableAvatarCreator}`} aria-hidden>
                                    {initialsFromPerson(d.createdBy.name, d.createdBy.email)}
                                  </span>
                                  {showSecondShare ? (
                                    <span
                                      className={`${styles.tableAvatar} ${styles.tableAvatarScope} ${d.visibility === "DEPARTMENT" ? styles.tableAvatarScopeDept : styles.tableAvatarScopeAll}`}
                                      title={d.visibility === "ALL" ? "Visible to everyone" : (d.departmentName ?? "Department")}
                                      aria-hidden
                                    >
                                      {d.visibility === "ALL" ? "All" : scopeLabel}
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                              <td className={styles.tableTdModified}>{formatModifiedTable(d.updatedAt, d.createdAt)}</td>
                              <td className={styles.tableTdFav} onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  className={`${styles.tableFavBtn} ${d.isFavorited ? styles.tableFavBtnActive : ""}`}
                                  onClick={() => void toggleFavoriteFor(d.id, !d.isFavorited)}
                                  aria-label={d.isFavorited ? `Remove ${d.title} from favorites` : `Add ${d.title} to favorites`}
                                  aria-pressed={d.isFavorited}
                                >
                                  <TableRowHeartIcon active={!!d.isFavorited} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {listTotal > 0 ? (
                <div className={styles.listPager}>
                  <span className={styles.listPagerMeta}>
                    Page {listPage} · {listTotal} total
                  </span>
                  <button
                    type="button"
                    className={styles.ghost}
                    disabled={listPage <= 1}
                    onClick={() => void loadDocuments(listPage - 1, false)}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className={styles.ghost}
                    disabled={!listHasMore}
                    onClick={() => void loadDocuments(listPage + 1, false)}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </section>
          )}
        </section>
      </section>

      <aside className={`${styles.detailsWrap} ${selectedDoc ? styles.detailsOpen : ""}`}>
        <div className={styles.detailsCard}>
          {selectedDoc ? (
            <>
              <div className={styles.detailsHeader}>
                <h2 className={styles.detailsTitle}>File details</h2>
                <button
                  type="button"
                  className={styles.detailsPanelBackBtn}
                  onClick={() => setSelectedFileId(null)}
                  aria-label="Close details panel"
                  title="Close"
                >
                  <span className={styles.detailsPanelBackIcon} aria-hidden>
                    <IconSideBackArrow />
                  </span>
                </button>
              </div>

              <div className={styles.detailsBody}>
                <div className={styles.detailsPreviewFrame}>
                  <div className={styles.detailsPreview}>{fileIcon(selectedDoc.latestVersion?.fileName)}</div>
                </div>

                <div className={styles.detailsDocTitleBlock}>
                  <p className={styles.detailsDocTitle}>{selectedDoc.title}</p>
                </div>

                <section className={styles.detailsBlock}>
                  <h3 className={styles.detailsFieldLabel}>Description</h3>
                  <div className={styles.detailsDescription}>
                    <dl className={styles.detailsDescList}>
                      <div className={styles.detailsDescRow}>
                        <dt className={styles.detailsDescRowLabel}>Department &amp; access</dt>
                        <dd className={styles.detailsDescRowValue}>
                          {selectedDoc.departmentName ?? "General"}
                          <span className={styles.detailsDescSep}> · </span>
                          <span className={styles.detailsDescCap}>{selectedDoc.visibility.toLowerCase()}</span>
                        </dd>
                      </div>

                      {selectedDoc.description?.trim() ? (
                        <div className={styles.detailsDescRow}>
                          <dt className={styles.detailsDescRowLabel}>Summary</dt>
                          <dd className={styles.detailsDescRowValue}>{selectedDoc.description}</dd>
                        </div>
                      ) : null}

                      {selectedDoc.latestVersion ? (
                        <>
                          <div className={styles.detailsDescRow}>
                            <dt className={styles.detailsDescRowLabel}>Latest version</dt>
                            <dd className={styles.detailsDescRowValue}>Version {selectedDoc.latestVersion.versionNumber}</dd>
                          </div>
                          <div className={styles.detailsDescRow}>
                            <dt className={styles.detailsDescRowLabel}>Processing status</dt>
                            <dd className={styles.detailsDescRowValue}>
                              <StatusLabel status={selectedDoc.latestVersion.processingStatus} error={null} />
                            </dd>
                          </div>
                          <div className={styles.detailsDescRow}>
                            <dt className={styles.detailsDescRowLabel}>Version uploaded</dt>
                            <dd className={styles.detailsDescRowValue}>
                              <time dateTime={selectedDoc.latestVersion.createdAt}>
                                {new Date(selectedDoc.latestVersion.createdAt).toLocaleString()}
                              </time>
                            </dd>
                          </div>
                        </>
                      ) : (
                        <div className={styles.detailsDescRow}>
                          <dt className={styles.detailsDescRowLabel}>Files</dt>
                          <dd className={styles.detailsDescRowValue}>No uploads yet.</dd>
                        </div>
                      )}

                      <div className={styles.detailsDescRow}>
                        <dt className={styles.detailsDescRowLabel}>Uploaded by</dt>
                        <dd className={styles.detailsDescRowValue}>
                          {selectedDoc.createdBy.name}
                          <span className={styles.detailsDescSep}> · </span>
                          <time dateTime={selectedDoc.createdAt}>{new Date(selectedDoc.createdAt).toLocaleDateString()}</time>
                        </dd>
                      </div>
                    </dl>
                  </div>
                </section>

                <section className={styles.detailsBlock}>
                  <h3 className={styles.detailsFieldLabel}>Action</h3>
                  <div className={styles.actionsRow}>
                    <button
                      type="button"
                      className={styles.actionItem}
                      disabled={pdfPreviewLoading}
                      onClick={() => void openDocumentFromPanel(selectedDoc)}
                    >
                      <span className={styles.actionIcon} aria-hidden>
                        <ActionIconOpen />
                      </span>
                      <span className={styles.actionLabel}>{pdfPreviewLoading ? "Opening…" : "Open"}</span>
                    </button>
                    {selectedDoc.latestVersion ? (
                      <button
                        type="button"
                        className={styles.actionItem}
                        onClick={() =>
                          void onDownload(selectedDoc.id, selectedDoc.latestVersion!.id, selectedDoc.latestVersion!.fileName)
                        }
                      >
                        <span className={styles.actionIcon} aria-hidden>
                          <ActionIconDownload />
                        </span>
                        <span className={styles.actionLabel}>Download</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={`${styles.actionItem} ${selectedDoc.isFavorited ? styles.actionItemFavoriteActive : ""}`}
                      onClick={() => void toggleFavoriteFor(selectedDoc.id, !selectedDoc.isFavorited)}
                    >
                      <span className={styles.actionIcon} aria-hidden>
                        <ActionIconHeart active={!!selectedDoc.isFavorited} />
                      </span>
                      <span className={styles.actionLabel}>{selectedDoc.isFavorited ? "Unfavorite" : "Favorite"}</span>
                    </button>
                    {isManagerOrAdmin ? (
                      <button
                        type="button"
                        className={styles.actionItem}
                        onClick={() =>
                          void (selectedDoc.isArchived ? unarchiveDoc(selectedDoc.id) : archiveDoc(selectedDoc.id))
                        }
                      >
                        <span className={styles.actionIcon} aria-hidden>
                          <ActionIconArchive />
                        </span>
                        <span className={styles.actionLabel}>{selectedDoc.isArchived ? "Unarchive" : "Archive"}</span>
                      </button>
                    ) : null}
                    {isManagerOrAdmin ? (
                      <button type="button" className={`${styles.actionItem} ${styles.actionItemDanger}`} onClick={() => void onDelete(selectedDoc.id)}>
                        <span className={styles.actionIcon} aria-hidden>
                          <ActionIconDelete />
                        </span>
                        <span className={styles.actionLabel}>Delete</span>
                      </button>
                    ) : null}
                  </div>
                </section>
              </div>
            </>
          ) : (
            <div className={styles.detailsEmptyState}>
              <p className={styles.detailsEmptyHint}>Click a file to open details, then use Open in the panel to view the document.</p>
            </div>
          )}
        </div>
      </aside>

      {canUploadDocuments ? (
        <button
          type="button"
          className={styles.uploadFab}
          onClick={() => {
            setUploadError(null);
            setUploadOk(null);
            setUploadStep(1);
            setFile(null);
            setTitle("");
            setUploadTags([]);
            setUploadTagInput("");
            setUploadModalOpen(true);
          }}
          aria-label="Upload file"
          title="Upload file"
        >
          <svg className={styles.uploadFabIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M12 5v14M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : null}

      {pdfPreview || pdfPreviewLoading ? (
        <div
          className={styles.pdfPreviewBackdrop}
          role="presentation"
          onClick={() => {
            if (!pdfPreviewLoading) closePdfPreview();
          }}
        >
          <div
            className={styles.pdfPreviewModal}
            role="dialog"
            aria-modal="true"
            aria-label="PDF preview"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.pdfPreviewHeader}>
              <h2 className={styles.pdfPreviewTitle}>{pdfPreview?.title ?? "Document preview"}</h2>
              <div className={styles.pdfPreviewHeaderActions}>
                <Link
                  className={styles.pdfPreviewLinkBtn}
                  href={pdfPreview ? `/documents/${pdfPreview.documentId}` : "#"}
                  onClick={(e) => {
                    if (!pdfPreview) e.preventDefault();
                  }}
                >
                  Full page
                </Link>
                <button type="button" className={styles.pdfPreviewLinkBtn} onClick={() => closePdfPreview()}>
                  Close
                </button>
              </div>
            </div>
            {pdfPreviewError ? <p className={styles.pdfPreviewInlineError}>{pdfPreviewError}</p> : null}
            {pdfPreviewLoading ? <p className={styles.pdfPreviewLoadingMsg}>Loading…</p> : null}
            {pdfPreview ? (
              <div className={styles.pdfPreviewBody}>
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
          className={styles.pdfPreviewBackdrop}
          role="presentation"
          onClick={() => {
            URL.revokeObjectURL(imagePreview.url);
            setImagePreview(null);
          }}
        >
          <div
            className={styles.pdfPreviewModal}
            role="dialog"
            aria-modal="true"
            aria-label="Image preview"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.pdfPreviewHeader}>
              <h2 className={styles.pdfPreviewTitle}>{imagePreview.title}</h2>
              <button
                type="button"
                className={styles.pdfPreviewLinkBtn}
                onClick={() => {
                  URL.revokeObjectURL(imagePreview.url);
                  setImagePreview(null);
                }}
              >
                Close
              </button>
            </div>
            <div className={styles.pdfPreviewBody} style={{ display: "grid", placeItems: "center", padding: "1rem" }}>
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

      {uploadModalOpen ? (
        <div
          className={styles.uploadModalBackdrop}
          role="presentation"
          onClick={() => !uploading && setUploadModalOpen(false)}
        >
          <div
            className={styles.uploadModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-modal-title"
            aria-describedby="upload-modal-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.uploadModalHeader}>
              <div>
                <h2 id="upload-modal-title" className={styles.uploadModalTitle}>
                  Upload document
                </h2>
                <p id="upload-modal-desc" className={styles.uploadModalSubtitle}>
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
                onClick={() => !uploading && setUploadModalOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className={styles.uploadStepper} aria-label="Upload progress">
              <div className={styles.uploadStepperBadgeRow}>
                <div
                  className={styles.uploadStepperTrack}
                  style={{
                    background: `linear-gradient(to right, #3b6cff 0%, #3b6cff ${
                      uploadStep === 1 ? 0 : uploadStep === 2 ? 50 : 100
                    }%, #e2e8f0 ${uploadStep === 1 ? 0 : uploadStep === 2 ? 50 : 100}%, #e2e8f0 100%)`,
                  }}
                  aria-hidden
                />
                <div className={`${styles.uploadStepperBadgeSlot} ${uploadStep >= 1 ? styles.uploadStepperItemActive : ""}`}>
                  <span className={styles.uploadStepperBadge}>1</span>
                </div>
                <div className={`${styles.uploadStepperBadgeSlot} ${uploadStep >= 2 ? styles.uploadStepperItemActive : ""}`}>
                  <span className={styles.uploadStepperBadge}>2</span>
                </div>
                <div className={`${styles.uploadStepperBadgeSlot} ${uploadStep >= 3 ? styles.uploadStepperItemActive : ""}`}>
                  <span className={styles.uploadStepperBadge}>3</span>
                </div>
              </div>
              <div className={styles.uploadStepperLabelRow}>
                <div className={`${styles.uploadStepperLabelCell} ${uploadStep >= 1 ? styles.uploadStepperItemActive : ""}`}>
                  <span className={styles.uploadStepperLabel}>File</span>
                </div>
                <div className={`${styles.uploadStepperLabelCell} ${uploadStep >= 2 ? styles.uploadStepperItemActive : ""}`}>
                  <span className={styles.uploadStepperLabel}>Details</span>
                </div>
                <div className={`${styles.uploadStepperLabelCell} ${uploadStep >= 3 ? styles.uploadStepperItemActive : ""}`}>
                  <span className={styles.uploadStepperLabel}>Tags</span>
                </div>
              </div>
            </div>

            {uploadStep === 1 ? (
              <div className={styles.uploadForm}>
                <p className={styles.uploadStepIntro}>Drop a file here or browse. Office documents and PDFs are supported.</p>
                <div
                  className={`${styles.uploadDropZone} ${uploadDragActive ? styles.uploadDropZoneActive : ""} ${file ? styles.uploadDropZoneHasFile : ""}`}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setUploadDragActive(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setUploadDragActive(false);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setUploadDragActive(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) setFile(f);
                  }}
                >
                  <input
                    ref={fileInputRef}
                    id="upload-file-input"
                    type="file"
                    className={styles.uploadFileInput}
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <label htmlFor="upload-file-input" className={styles.uploadDropLabel}>
                    <span className={styles.uploadDropIcon} aria-hidden>
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M12 16V4m0 0 4 4m-4-4L8 8" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" strokeLinecap="round" />
                      </svg>
                    </span>
                    <span className={styles.uploadDropTitle}>{file ? "Replace file" : "Select or drop file"}</span>
                    <span className={styles.uploadDropHint}>Click to browse your device</span>
                  </label>
                </div>
                {file ? (
                  <div className={styles.uploadFilePreview}>
                    <div className={styles.uploadFilePreviewMain}>
                      <span className={styles.uploadFilePreviewName}>{file.name}</span>
                      <span className={styles.uploadFilePreviewMeta}>{formatSize(file.size)}</span>
                    </div>
                    <button
                      type="button"
                      className={styles.uploadFileRemove}
                      onClick={() => {
                        setFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ) : null}
                {uploadError ? (
                  <p role="alert" className={styles.uploadMsgError}>
                    {uploadError}
                  </p>
                ) : null}
                <div className={styles.uploadModalActions}>
                  <button type="button" className={styles.ghost} disabled={uploading} onClick={() => setUploadModalOpen(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={!file || uploading}
                    onClick={() => {
                      if (!file) return;
                      setUploadError(null);
                      if (!title.trim()) {
                        const stem = file.name.replace(/\.[^/.]+$/, "");
                        setTitle(stem.length > 0 ? stem : file.name);
                      }
                      setUploadStep(2);
                    }}
                  >
                    Continue
                  </button>
                </div>
              </div>
            ) : uploadStep === 2 ? (
              <div className={styles.uploadForm}>
                <p className={styles.uploadStepIntro}>Document information stored with this file in the library.</p>
                <label className={styles.uploadLabel}>
                  <span className={styles.uploadFieldLabel}>Title</span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                    className={styles.uploadFieldInput}
                    placeholder="Document title"
                    autoComplete="off"
                  />
                </label>
                <label className={styles.uploadLabel}>
                  <span className={styles.uploadFieldLabel}>Description (optional)</span>
                  <textarea
                    value={uploadDescription}
                    onChange={(e) => setUploadDescription(e.target.value)}
                    className={styles.uploadFieldInput}
                    rows={4}
                    placeholder="Short summary or notes…"
                    style={{ resize: "vertical", minHeight: "4.5rem" }}
                  />
                </label>
                <label className={styles.uploadLabel}>
                  <span className={styles.uploadFieldLabel}>Visibility</span>
                  <select value={visibility} onChange={(e) => setVisibility(e.target.value)} className={styles.uploadFieldSelect}>
                    <option value="ALL">Everyone (all users)</option>
                    <option value="DEPARTMENT">Department only</option>
                    <option value="PRIVATE">Private (only you)</option>
                  </select>
                </label>
                {visibility === "DEPARTMENT" && me?.role === "ADMIN" && departments.length > 0 ? (
                  <label className={styles.uploadLabel}>
                    <span className={styles.uploadFieldLabel}>Department</span>
                    <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={styles.uploadFieldSelect}>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div className={styles.uploadSummary}>
                  <span className={styles.uploadSummaryLabel}>Attached file</span>
                  <span className={styles.uploadSummaryValue}>{file?.name ?? "—"}</span>
                </div>
                {uploadError ? (
                  <p role="alert" className={styles.uploadMsgError}>
                    {uploadError}
                  </p>
                ) : null}
                <div className={styles.uploadModalActions}>
                  <button
                    type="button"
                    className={styles.ghost}
                    disabled={uploading}
                    onClick={() => {
                      setUploadStep(1);
                      setUploadError(null);
                    }}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={uploading || !title.trim()}
                    onClick={() => {
                      if (!title.trim()) {
                        setUploadError("Enter a title.");
                        return;
                      }
                      setUploadError(null);
                      setUploadStep(3);
                    }}
                  >
                    Continue
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void onUpload(e);
                }}
                className={styles.uploadForm}
              >
                <p className={styles.uploadStepIntro}>
                  Type a tag and press Enter, or pick a suggestion. Lowercase letters, numbers, spaces, and{" "}
                  <code className={styles.uploadTagCode}>._+-</code> only.
                </p>
                <div className={styles.uploadTagField}>
                  <label htmlFor="upload-tag-input" className={styles.uploadFieldLabel}>
                    Tags ({uploadTags.length}/{MAX_UPLOAD_TAGS})
                  </label>
                  <div className={styles.uploadTagInputWrap}>
                    {uploadTags.map((t) => (
                      <span key={t} className={styles.uploadTagChip}>
                        {t}
                        <button
                          type="button"
                          className={styles.uploadTagChipRemove}
                          onClick={() => setUploadTags((prev) => prev.filter((x) => x !== t))}
                          aria-label={`Remove tag ${t}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <input
                      id="upload-tag-input"
                      type="text"
                      className={styles.uploadTagTextInput}
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
                    <ul className={styles.uploadTagSuggest} role="listbox" aria-label="Suggested tags">
                      {tagSuggestions.map((s) => (
                        <li key={s}>
                          <button
                            type="button"
                            className={styles.uploadTagSuggestBtn}
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
                <div className={styles.uploadSummary}>
                  <span className={styles.uploadSummaryLabel}>Title</span>
                  <span className={styles.uploadSummaryValue}>{title.trim() || "—"}</span>
                </div>
                {uploadError ? (
                  <p role="alert" className={styles.uploadMsgError}>
                    {uploadError}
                  </p>
                ) : null}
                {uploadOk ? (
                  <p role="status" className={styles.uploadMsgOk}>
                    {uploadOk}
                  </p>
                ) : null}
                <div className={styles.uploadModalActions}>
                  <button
                    type="button"
                    className={styles.ghost}
                    disabled={uploading}
                    onClick={() => {
                      setUploadStep(2);
                      setUploadError(null);
                    }}
                  >
                    Back
                  </button>
                  <button type="submit" disabled={uploading} className={styles.primary}>
                    {uploading ? "Uploading…" : "Upload document"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}

function IconSideBackArrow() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M15 18 9 12l6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DeptCardFolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 9.25c0-.97.78-1.75 1.75-1.75h3.59c.46 0 .89.18 1.21.5l.95.95H18A2.75 2.75 0 0 1 20.75 11v7c0 .97-.78 1.75-1.75 1.75H5A1.75 1.75 0 0 1 3.25 18V9.25Z"
        fill="currentColor"
        fillOpacity="0.14"
      />
      <path
        d="M4 9.25c0-.97.78-1.75 1.75-1.75h3.59c.46 0 .89.18 1.21.5l.95.95H18A2.75 2.75 0 0 1 20.75 11v7c0 .97-.78 1.75-1.75 1.75H5A1.75 1.75 0 0 1 3.25 18V9.25Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path
        d="M3.25 10.5h17.5"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SideIconHome() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function SideIconFolder() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 10.5 6.5 6.5h4l1.5-2H20a1.5 1.5 0 0 1 1.5 1.5V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V8a1.5 1.5 0 0 1 1.5-1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function SideIconClock() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 8v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SideIconHeart() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SideIconArchive() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 8h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 8V6a1 1 0 0 1 1-1h1l1-2h10l1 2h1a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function StatusLabel({ status, error }: { status: string; error: string | null }) {
  const color =
    status === "READY" ? "#15803d" : status === "FAILED" ? "var(--error)" : status === "PROCESSING" ? "#a16207" : "#52525b";
  return (
    <span style={{ color }}>
      {status}
      {status === "FAILED" && error ? ` — ${error}` : ""}
    </span>
  );
}

function formatSize(bytes: number | undefined) {
  if (!bytes || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ActionIconOpen() {
  return (
    <svg className={styles.actionIconSvg} viewBox="0 0 24 24" fill="none" aria-hidden>
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

function ActionIconDownload() {
  return (
    <svg className={styles.actionIconSvg} viewBox="0 0 24 24" fill="none" aria-hidden>
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

function ActionIconDelete() {
  return (
    <svg className={styles.actionIconSvg} viewBox="0 0 24 24" fill="none" aria-hidden>
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

function TableRowHeartIcon({ active }: { active?: boolean }) {
  return (
    <svg className={styles.tableFavSvg} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={active ? 0 : 1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ActionIconHeart({ active }: { active?: boolean }) {
  return (
    <svg className={styles.actionIconSvg} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={active ? 0 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ActionIconArchive() {
  return (
    <svg className={styles.actionIconSvg} viewBox="0 0 24 24" fill="none" aria-hidden>
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

type FileIconKind = "pdf" | "csv" | "word" | "slides" | "doc" | "xls" | "ppt" | "other";

/** Original full-bleed PDF artwork (user SVG). */
function IconPdfDocument({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 241" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <g opacity="0.3">
        <path
          opacity="0.3"
          d="M139.67 49.25C134.202 49.2447 128.959 47.0709 125.092 43.2053C121.224 39.3397 119.048 34.098 119.04 28.63V0H26.9099C19.7729 0 12.9284 2.83514 7.88184 7.88174C2.83523 12.9283 0 19.773 0 26.91V189.13C0 196.267 2.83523 203.112 7.88184 208.158C12.9284 213.205 19.7729 216.04 26.9099 216.04H137.51C144.647 216.04 151.492 213.205 156.538 208.158C161.585 203.112 164.42 196.267 164.42 189.13V49.25H139.67Z"
          fill="#FF3E4C"
        />
      </g>
      <path
        d="M164.42 49.25H139.67C134.202 49.2447 128.959 47.0709 125.092 43.2053C121.224 39.3397 119.048 34.098 119.04 28.63V0L164.42 49.25Z"
        fill="#FF3E4C"
      />
      <path
        d="M130.59 150.83H27.3501C26.3903 150.78 25.4863 150.364 24.8245 149.667C24.1627 148.97 23.7935 148.046 23.7935 147.085C23.7935 146.124 24.1627 145.2 24.8245 144.503C25.4863 143.806 26.3903 143.39 27.3501 143.34H130.59C131.098 143.314 131.606 143.391 132.083 143.568C132.561 143.744 132.997 144.015 133.366 144.366C133.735 144.716 134.029 145.138 134.229 145.605C134.43 146.073 134.534 146.576 134.534 147.085C134.534 147.594 134.43 148.097 134.229 148.565C134.029 149.032 133.735 149.454 133.366 149.804C132.997 150.155 132.561 150.426 132.083 150.603C131.606 150.779 131.098 150.856 130.59 150.83Z"
        fill="#FF3E4C"
      />
      <path
        d="M130.59 108.6H27.3501C26.3903 108.55 25.4863 108.134 24.8245 107.437C24.1627 106.74 23.7935 105.816 23.7935 104.855C23.7935 103.894 24.1627 102.97 24.8245 102.273C25.4863 101.576 26.3903 101.16 27.3501 101.11H130.59C131.098 101.084 131.606 101.161 132.083 101.337C132.561 101.514 132.997 101.785 133.366 102.136C133.735 102.486 134.029 102.908 134.229 103.375C134.43 103.843 134.534 104.346 134.534 104.855C134.534 105.364 134.43 105.867 134.229 106.335C134.029 106.802 133.735 107.224 133.366 107.574C132.997 107.925 132.561 108.196 132.083 108.373C131.606 108.549 131.098 108.626 130.59 108.6Z"
        fill="#FF3E4C"
      />
      <path
        d="M130.59 129.72H27.3501C26.3903 129.67 25.4863 129.254 24.8245 128.557C24.1627 127.86 23.7935 126.936 23.7935 125.975C23.7935 125.014 24.1627 124.09 24.8245 123.393C25.4863 122.696 26.3903 122.28 27.3501 122.23H130.59C131.098 122.204 131.606 122.281 132.083 122.458C132.561 122.634 132.997 122.905 133.366 123.256C133.735 123.606 134.029 124.028 134.229 124.495C134.43 124.963 134.534 125.466 134.534 125.975C134.534 126.484 134.43 126.987 134.229 127.455C134.029 127.922 133.735 128.344 133.366 128.694C132.997 129.045 132.561 129.316 132.083 129.493C131.606 129.669 131.098 129.746 130.59 129.72Z"
        fill="#FF3E4C"
      />
      <path
        d="M89.8699 87.48H27.3501C26.3903 87.4304 25.4863 87.0142 24.8245 86.3173C24.1627 85.6204 23.7935 84.6961 23.7935 83.735C23.7935 82.774 24.1627 81.8496 24.8245 81.1527C25.4863 80.4558 26.3903 80.0396 27.3501 79.99H89.8699C90.8296 80.0396 91.734 80.4558 92.3958 81.1527C93.0575 81.8496 93.4265 82.774 93.4265 83.735C93.4265 84.6961 93.0575 85.6204 92.3958 86.3173C91.734 87.0142 90.8296 87.4304 89.8699 87.48Z"
        fill="#FF3E4C"
      />
      <path
        d="M89.8699 66.36H27.3501C26.3903 66.3104 25.4863 65.8942 24.8245 65.1973C24.1627 64.5004 23.7935 63.5761 23.7935 62.615C23.7935 61.654 24.1627 60.7296 24.8245 60.0327C25.4863 59.3358 26.3903 58.9196 27.3501 58.87H89.8699C90.8296 58.9196 91.734 59.3358 92.3958 60.0327C93.0575 60.7296 93.4265 61.654 93.4265 62.615C93.4265 63.5761 93.0575 64.5004 92.3958 65.1973C91.734 65.8942 90.8296 66.3104 89.8699 66.36Z"
        fill="#FF3E4C"
      />
      <path
        d="M183.94 170.61H58.8999C50.0302 170.61 42.8398 177.8 42.8398 186.67V223.95C42.8398 232.82 50.0302 240.01 58.8999 240.01H183.94C192.81 240.01 200 232.82 200 223.95V186.67C200 177.8 192.81 170.61 183.94 170.61Z"
        fill="#FF3E4C"
      />
      <path d="M83.8601 213.38V220.65H76.3301V213.38H83.8601Z" fill="white" />
      <path
        d="M94.9199 210.1V220.65H87.6399V190.58H99.4199C103 190.58 105.723 191.467 107.59 193.24C108.538 194.169 109.278 195.289 109.762 196.524C110.246 197.76 110.464 199.084 110.4 200.41C110.433 202.159 109.998 203.885 109.14 205.41C108.275 206.908 106.979 208.11 105.42 208.86C103.548 209.749 101.491 210.178 99.4199 210.11L94.9199 210.1ZM103 200.41C103 197.743 101.54 196.41 98.6199 196.41H94.9199V204.24H98.6199C101.54 204.267 103 202.99 103 200.41Z"
        fill="white"
      />
      <path
        d="M139.13 213.4C137.874 215.674 135.979 217.531 133.68 218.74C131.099 220.063 128.229 220.72 125.33 220.65H113.97V190.58H125.33C128.234 190.509 131.111 191.151 133.71 192.45C135.997 193.638 137.883 195.474 139.13 197.73C140.372 200.155 141.021 202.84 141.021 205.565C141.021 208.29 140.372 210.975 139.13 213.4ZM131.3 211.89C132.823 210.131 133.661 207.882 133.661 205.555C133.661 203.228 132.823 200.979 131.3 199.22C129.482 197.623 127.105 196.811 124.69 196.96H121.24V214.14H124.74C127.137 214.276 129.491 213.468 131.3 211.89Z"
        fill="white"
      />
      <path d="M164.74 190.58V196.37H152.41V202.96H161.94V208.49H152.41V220.65H145.14V190.58H164.74Z" fill="white" />
      <path
        d="M128.76 58.87H111.08C107.998 58.87 105.5 61.3683 105.5 64.45V82.13C105.5 85.2118 107.998 87.71 111.08 87.71H128.76C131.842 87.71 134.34 85.2118 134.34 82.13V64.45C134.34 61.3683 131.842 58.87 128.76 58.87Z"
        fill="#FF3E4C"
      />
    </svg>
  );
}

/** Full-bleed Word/DOC artwork (user SVG, blue #0072FF). */
function IconWordDocument({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 241" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <g opacity="0.3">
        <path
          opacity="0.3"
          d="M139.67 49.25C134.202 49.2447 128.959 47.0709 125.092 43.2053C121.224 39.3397 119.048 34.098 119.04 28.63V0H26.9099C19.7729 0 12.9282 2.83514 7.88159 7.88174C2.83499 12.9283 0 19.773 0 26.91V189.13C0 196.267 2.83499 203.112 7.88159 208.158C12.9282 213.205 19.7729 216.04 26.9099 216.04H137.51C144.647 216.04 151.491 213.205 156.538 208.158C161.585 203.112 164.42 196.267 164.42 189.13V49.25H139.67Z"
          fill="#0072FF"
        />
      </g>
      <path
        d="M164.42 49.25H139.67C134.202 49.2447 128.959 47.0709 125.092 43.2053C121.224 39.3397 119.048 34.098 119.04 28.63V0L164.42 49.25Z"
        fill="#0072FF"
      />
      <path
        d="M130.59 83.73H27.3499C26.3901 83.6804 25.486 83.2642 24.8242 82.5673C24.1624 81.8704 23.7935 80.9461 23.7935 79.985C23.7935 79.024 24.1624 78.0996 24.8242 77.4027C25.486 76.7058 26.3901 76.2896 27.3499 76.24H130.59C131.098 76.2138 131.606 76.2911 132.083 76.4675C132.56 76.6438 132.997 76.9154 133.366 77.2658C133.735 77.6161 134.029 78.0379 134.229 78.5053C134.43 78.9728 134.533 79.4763 134.533 79.985C134.533 80.4938 134.43 80.9972 134.229 81.4647C134.029 81.9322 133.735 82.3539 133.366 82.7042C132.997 83.0546 132.56 83.3262 132.083 83.5025C131.606 83.6789 131.098 83.7563 130.59 83.73Z"
        fill="#0072FF"
      />
      <path
        d="M130.59 106.1H27.3499C26.3901 106.05 25.486 105.634 24.8242 104.937C24.1624 104.24 23.7935 103.316 23.7935 102.355C23.7935 101.394 24.1624 100.47 24.8242 99.7727C25.486 99.0758 26.3901 98.6596 27.3499 98.61H130.59C131.098 98.5837 131.606 98.6611 132.083 98.8375C132.56 99.0138 132.997 99.2854 133.366 99.6358C133.735 99.9861 134.029 100.408 134.229 100.875C134.43 101.343 134.533 101.846 134.533 102.355C134.533 102.864 134.43 103.367 134.229 103.835C134.029 104.302 133.735 104.724 133.366 105.074C132.997 105.425 132.56 105.696 132.083 105.873C131.606 106.049 131.098 106.126 130.59 106.1Z"
        fill="#0072FF"
      />
      <path
        d="M130.59 128.47H27.3499C26.3901 128.42 25.486 128.004 24.8242 127.307C24.1624 126.61 23.7935 125.686 23.7935 124.725C23.7935 123.764 24.1624 122.84 24.8242 122.143C25.486 121.446 26.3901 121.03 27.3499 120.98H130.59C131.098 120.954 131.606 121.031 132.083 121.208C132.56 121.384 132.997 121.655 133.366 122.006C133.735 122.356 134.029 122.778 134.229 123.245C134.43 123.713 134.533 124.216 134.533 124.725C134.533 125.234 134.43 125.737 134.229 126.205C134.029 126.672 133.735 127.094 133.366 127.444C132.997 127.795 132.56 128.066 132.083 128.243C131.606 128.419 131.098 128.496 130.59 128.47Z"
        fill="#0072FF"
      />
      <path
        d="M89.8699 150.83H27.3499C26.3901 150.78 25.486 150.364 24.8242 149.667C24.1624 148.97 23.7935 148.046 23.7935 147.085C23.7935 146.124 24.1624 145.2 24.8242 144.503C25.486 143.806 26.3901 143.39 27.3499 143.34H89.8699C90.378 143.314 90.8861 143.391 91.3633 143.568C91.8405 143.744 92.2768 144.015 92.6458 144.366C93.0147 144.716 93.3085 145.138 93.5093 145.605C93.71 146.073 93.8135 146.576 93.8135 147.085C93.8135 147.594 93.71 148.097 93.5093 148.565C93.3085 149.032 93.0147 149.454 92.6458 149.804C92.2768 150.155 91.8405 150.426 91.3633 150.603C90.8861 150.779 90.378 150.856 89.8699 150.83Z"
        fill="#0072FF"
      />
      <path
        d="M183.94 170.61H58.8999C50.0302 170.61 42.8398 177.8 42.8398 186.67V223.95C42.8398 232.82 50.0302 240.01 58.8999 240.01H183.94C192.81 240.01 200 232.82 200 223.95V186.67C200 177.8 192.81 170.61 183.94 170.61Z"
        fill="#0072FF"
      />
      <path d="M61.1699 213.38V220.65H53.6399V213.38H61.1699Z" fill="white" />
      <path
        d="M90.1699 213.4C88.9114 215.672 87.0175 217.528 84.72 218.74C82.1358 220.063 79.2621 220.719 76.3599 220.65H65.01V190.58H76.3599C79.2643 190.507 82.1422 191.149 84.74 192.45C87.0304 193.637 88.9193 195.474 90.1699 197.73C91.4125 200.155 92.0605 202.84 92.0605 205.565C92.0605 208.29 91.4125 210.975 90.1699 213.4ZM82.3398 211.89C83.8626 210.131 84.7007 207.882 84.7007 205.555C84.7007 203.228 83.8626 200.979 82.3398 199.22C80.5215 197.623 78.1453 196.811 75.73 196.96H72.28V214.14H75.73C78.1266 214.276 80.4811 213.468 82.29 211.89H82.3398Z"
        fill="white"
      />
      <path
        d="M118.17 192.09C120.46 193.387 122.352 195.285 123.64 197.58C124.959 200.019 125.65 202.748 125.65 205.52C125.65 208.293 124.959 211.021 123.64 213.46C122.345 215.761 120.447 217.666 118.15 218.97C115.8 220.268 113.159 220.949 110.475 220.949C107.79 220.949 105.15 220.268 102.8 218.97C100.503 217.666 98.6051 215.761 97.3098 213.46C95.9838 211.024 95.2893 208.294 95.2893 205.52C95.2893 202.746 95.9838 200.016 97.3098 197.58C98.6112 195.288 100.508 193.391 102.8 192.09C105.157 190.791 107.804 190.11 110.495 190.11C113.186 190.11 115.833 190.791 118.19 192.09H118.17ZM104.78 199.19C103.411 201.009 102.67 203.223 102.67 205.5C102.67 207.777 103.411 209.991 104.78 211.81C106.287 213.303 108.323 214.141 110.445 214.141C112.567 214.141 114.602 213.303 116.11 211.81C117.485 209.999 118.229 207.788 118.229 205.515C118.229 203.242 117.485 201.031 116.11 199.22C114.597 197.73 112.558 196.896 110.435 196.896C108.311 196.896 106.273 197.73 104.76 199.22L104.78 199.19Z"
        fill="white"
      />
      <path
        d="M152.94 193.3C155.473 195.366 157.197 198.259 157.81 201.47H150.11C149.587 200.138 148.674 198.995 147.49 198.19C146.246 197.379 144.785 196.964 143.3 197C142.321 196.968 141.348 197.162 140.456 197.568C139.564 197.974 138.779 198.58 138.16 199.34C136.884 201.173 136.2 203.352 136.2 205.585C136.2 207.818 136.884 209.997 138.16 211.83C138.783 212.582 139.57 213.182 140.461 213.582C141.352 213.983 142.323 214.174 143.3 214.14C144.785 214.181 146.248 213.766 147.49 212.95C148.667 212.16 149.58 211.035 150.11 209.72H157.81C157.185 212.921 155.463 215.804 152.94 217.87C150.217 219.948 146.853 221.009 143.43 220.87C140.736 220.927 138.076 220.257 135.73 218.93C133.535 217.656 131.756 215.774 130.61 213.51C129.419 211.027 128.8 208.309 128.8 205.555C128.8 202.801 129.419 200.083 130.61 197.6C131.756 195.336 133.535 193.454 135.73 192.18C138.076 190.853 140.736 190.183 143.43 190.24C146.859 190.122 150.223 191.204 152.94 193.3Z"
        fill="white"
      />
      <path
        d="M180.17 220.65L173.84 211.29L168.39 220.65H160.06L169.67 205.17L159.76 190.58H168.39L174.56 199.64L179.88 190.58H188.17L178.69 205.72L188.81 220.65H180.17Z"
        fill="white"
      />
    </svg>
  );
}

/** Full-bleed PowerPoint / PPTX artwork (user SVG, red #D71D1D). */
function IconPptxDocument({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 240" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <g opacity="0.3">
        <path
          opacity="0.3"
          d="M139.67 49.25C134.203 49.2447 128.961 47.0705 125.095 43.2047C121.23 39.3388 119.055 34.0971 119.05 28.63V1.85901e-06H26.9202C23.3846 -0.00131223 19.8834 0.694059 16.6167 2.04645C13.35 3.39884 10.3819 5.3817 7.88184 7.88172C5.38182 10.3817 3.39902 13.3499 2.04663 16.6166C0.694242 19.8833 -0.00131223 23.3844 1.85852e-06 26.92V189.14C1.61446e-06 192.675 0.696339 196.175 2.04932 199.44C3.4023 202.706 5.38537 205.673 7.88526 208.172C10.3851 210.671 13.3529 212.653 16.6189 214.004C19.8849 215.356 23.3855 216.051 26.9202 216.05H137.52C144.657 216.05 151.502 213.215 156.548 208.168C161.595 203.122 164.43 196.277 164.43 189.14V49.25H139.67Z"
          fill="#D71D1D"
        />
      </g>
      <path
        d="M164.43 49.25H139.67C134.203 49.2447 128.961 47.0705 125.095 43.2047C121.23 39.3388 119.055 34.0971 119.05 28.63V0L164.43 49.25Z"
        fill="#D71D1D"
      />
      <path
        d="M183.94 170.61H58.9001C50.0305 170.61 42.8401 177.8 42.8401 186.67V223.95C42.8401 232.82 50.0305 240.01 58.9001 240.01H183.94C192.81 240.01 200 232.82 200 223.95V186.67C200 177.8 192.81 170.61 183.94 170.61Z"
        fill="#D71D1D"
      />
      <path d="M79.0801 213.38V220.65H71.55V213.38H79.0801Z" fill="white" />
      <path
        d="M81.9601 62.01C81.9601 62.01 105.43 67.01 83.6903 140.5H80.6903C80.6903 140.5 59.7801 72.81 81.9601 62.01Z"
        fill="#D71D1D"
      />
      <path
        d="M87.1401 62.73C87.1401 62.73 119.98 75.11 85.5601 140.07C85.5601 140.07 137.55 76.7 87.1401 62.73Z"
        fill="#D71D1D"
      />
      <path
        d="M100.82 67.19C100.82 67.19 132.32 82.92 89.5901 137.62C89.5901 137.62 138.7 84.76 100.82 67.19Z"
        fill="#D71D1D"
      />
      <path
        d="M77.3201 62.73C77.3201 62.73 44.4902 75.11 78.9102 140.07C78.8802 140.07 26.8801 76.7 77.3201 62.73Z"
        fill="#D71D1D"
      />
      <path
        d="M63.6102 67.19C63.6102 67.19 32.0702 82.89 74.8402 137.62C74.8402 137.62 25.7302 84.76 63.6102 67.19Z"
        fill="#D71D1D"
      />
      <path d="M86.6201 154.03H78.1602L75.6201 145.97H89.1501L86.6201 154.03Z" fill="#D71D1D" />
      <path d="M156.86 191.28V197.06H148.69V221.35H141.38V197.06H133.29V191.28H156.86Z" fill="white" />
      <path
        d="M115.57 209.8V220.35H108.29V190.28H120.07C123.65 190.28 126.374 191.167 128.24 192.94C129.188 193.869 129.928 194.989 130.412 196.224C130.896 197.46 131.114 198.784 131.05 200.11C131.083 201.859 130.648 203.585 129.79 205.11C128.925 206.608 127.629 207.81 126.07 208.56C124.198 209.449 122.141 209.877 120.07 209.81L115.57 209.8ZM123.65 200.11C123.65 197.443 122.19 196.11 119.27 196.11H115.57V203.94H119.27C122.19 203.967 123.65 202.69 123.65 200.11V200.11Z"
        fill="white"
      />
      <path
        d="M89.5701 209.8V220.35H82.29V190.28H94.0701C97.6501 190.28 100.374 191.167 102.24 192.94C103.188 193.869 103.928 194.989 104.412 196.224C104.896 197.46 105.114 198.784 105.05 200.11C105.083 201.859 104.648 203.585 103.79 205.11C102.925 206.608 101.629 207.81 100.07 208.56C98.1983 209.449 96.1411 209.877 94.0701 209.81L89.5701 209.8ZM97.6501 200.11C97.6501 197.443 96.19 196.11 93.27 196.11H89.5701V203.94H93.27C96.19 203.967 97.6501 202.69 97.6501 200.11V200.11Z"
        fill="white"
      />
      <path
        d="M179.72 221.35L173.38 211.99L167.94 221.35H159.59L169.2 205.87L159.29 191.28H167.93L174.09 200.34L179.41 191.28H187.7L178.22 206.42L188.34 221.35H179.72Z"
        fill="white"
      />
    </svg>
  );
}

/** Full-bleed CSV artwork (user SVG, green #00C650). */
function IconCsvDocument({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 241" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <g opacity="0.3">
        <path
          opacity="0.3"
          d="M139.67 49.25C134.203 49.2447 128.961 47.0705 125.095 43.2047C121.23 39.3388 119.055 34.0971 119.05 28.63V1.85821e-06H26.9202C23.3855 -0.00131167 19.8849 0.693768 16.6189 2.04553C13.3529 3.3973 10.3851 5.37925 7.88525 7.87821C5.38537 10.3772 3.4023 13.3442 2.04932 16.6097C0.696337 19.8752 -2.4406e-07 23.3753 0 26.91V189.13C-2.4406e-07 192.665 0.696337 196.165 2.04932 199.43C3.4023 202.696 5.38537 205.663 7.88525 208.162C10.3851 210.661 13.3529 212.643 16.6189 213.994C19.8849 215.346 23.3855 216.041 26.9202 216.04H137.52C144.657 216.04 151.502 213.205 156.548 208.158C161.595 203.112 164.43 196.267 164.43 189.13V49.25H139.67Z"
          fill="#00C650"
        />
      </g>
      <path
        d="M164.43 49.25H139.67C134.203 49.2447 128.961 47.0705 125.095 43.2047C121.23 39.3388 119.055 34.0971 119.05 28.63V0L164.43 49.25Z"
        fill="#00C650"
      />
      <path
        d="M183.94 170.61H58.9001C50.0305 170.61 42.8401 177.8 42.8401 186.67V223.95C42.8401 232.82 50.0305 240.01 58.9001 240.01H183.94C192.81 240.01 200 232.82 200 223.95V186.67C200 177.8 192.81 170.61 183.94 170.61Z"
        fill="#00C650"
      />
      <path d="M80.5 213.12V220.37H73V213.12H80.5Z" fill="white" />
      <path
        d="M107.41 193.14C109.938 195.191 111.657 198.071 112.26 201.27H104.59C104.075 199.944 103.168 198.807 101.99 198.01C100.753 197.199 99.2987 196.784 97.8201 196.82C96.8436 196.789 95.8729 196.983 94.9834 197.387C94.0939 197.791 93.3093 198.394 92.6902 199.15C91.4208 200.974 90.7402 203.143 90.7402 205.365C90.7402 207.587 91.4208 209.756 92.6902 211.58C93.3123 212.331 94.0979 212.93 94.9871 213.33C95.8763 213.73 96.8454 213.922 97.8201 213.89C99.2987 213.926 100.753 213.511 101.99 212.7C103.161 211.913 104.068 210.791 104.59 209.48H112.26C111.643 212.668 109.927 215.538 107.41 217.59C104.702 219.668 101.351 220.73 97.9402 220.59C95.2596 220.649 92.6128 219.982 90.28 218.66C88.091 217.394 86.3188 215.518 85.1802 213.26C83.9952 210.79 83.3799 208.085 83.3799 205.345C83.3799 202.605 83.9952 199.9 85.1802 197.43C86.3188 195.172 88.091 193.296 90.28 192.03C92.6128 190.708 95.2596 190.042 97.9402 190.1C101.355 189.976 104.706 191.051 107.41 193.14Z"
        fill="white"
      />
      <path
        d="M136.63 216.3C135.771 217.678 134.535 218.781 133.07 219.48C131.292 220.314 129.343 220.718 127.38 220.66C124.419 220.78 121.501 219.919 119.08 218.21C118.009 217.408 117.133 216.374 116.517 215.187C115.9 213.999 115.559 212.688 115.52 211.35H123.23C123.281 212.356 123.709 213.306 124.43 214.01C125.147 214.68 126.099 215.039 127.08 215.01C127.884 215.051 128.673 214.779 129.28 214.25C129.547 213.991 129.756 213.68 129.896 213.336C130.035 212.991 130.102 212.621 130.09 212.25C130.1 211.899 130.038 211.55 129.909 211.223C129.78 210.897 129.587 210.6 129.34 210.35C128.817 209.814 128.191 209.389 127.5 209.1C126.77 208.77 125.75 208.39 124.5 207.93C122.916 207.408 121.369 206.78 119.87 206.05C118.635 205.411 117.574 204.481 116.78 203.34C115.919 201.939 115.469 200.325 115.479 198.681C115.49 197.038 115.961 195.43 116.84 194.04C117.78 192.705 119.081 191.664 120.59 191.04C122.329 190.334 124.194 189.993 126.07 190.04C128.911 189.888 131.717 190.726 134.01 192.41C134.975 193.194 135.768 194.168 136.337 195.273C136.907 196.378 137.242 197.589 137.32 198.83H129.49C129.4 197.949 129.02 197.122 128.41 196.48C128.097 196.185 127.727 195.956 127.323 195.806C126.92 195.657 126.49 195.59 126.06 195.61C125.333 195.587 124.622 195.828 124.06 196.29C123.786 196.542 123.573 196.853 123.436 197.2C123.299 197.546 123.242 197.919 123.27 198.29C123.257 198.959 123.509 199.606 123.97 200.09C124.467 200.61 125.067 201.022 125.73 201.3C126.44 201.61 127.45 202.01 128.73 202.49C130.343 203.01 131.914 203.652 133.43 204.41C134.677 205.078 135.75 206.03 136.56 207.19C137.495 208.588 137.958 210.25 137.88 211.93C137.878 213.475 137.445 214.988 136.63 216.3Z"
        fill="white"
      />
      <path d="M147.45 190.43L154.77 212.96L162.1 190.43H169.85L159.43 220.37H150.07L139.7 190.43H147.45Z" fill="white" />
      <path
        d="M118.89 150.83H45.54C39.19 150.83 34.03 144.51 34.03 136.73V83.51C34.03 75.74 39.19 69.42 45.54 69.42H118.89C125.24 69.42 130.4 75.74 130.4 83.51V136.7C130.4 144.48 125.24 150.83 118.89 150.83ZM45.54 76.66C42.44 76.66 39.9202 79.74 39.9202 83.54V136.73C39.9202 140.53 42.44 143.62 45.54 143.62H118.89C121.99 143.62 124.52 140.53 124.52 136.73V83.51C124.52 79.71 121.99 76.63 118.89 76.63L45.54 76.66Z"
        fill="#00C650"
      />
      <path d="M127.46 118.77H36.97V125.98H127.46V118.77Z" fill="#00C650" />
      <path d="M127.46 94.04H36.97V101.25H127.46V94.04Z" fill="#00C650" />
      <path d="M104.29 73.02H97.0801V147.19H104.29V73.02Z" fill="#00C650" />
      <path d="M67.3501 73.02H60.1401V147.19H67.3501V73.02Z" fill="#00C650" />
    </svg>
  );
}

function resolveFileIconKind(fileName: string | undefined): { kind: FileIconKind; bannerLabel: string } {
  const ext = (fileName?.split(".").pop() ?? "").toLowerCase();
  if (ext === "pdf") return { kind: "pdf", bannerLabel: "PDF" };
  if (ext === "csv") return { kind: "csv", bannerLabel: "CSV" };
  if (["doc", "docx"].includes(ext)) return { kind: "word", bannerLabel: ext === "docx" ? "DOCX" : "DOC" };
  if (ext === "odt") return { kind: "doc", bannerLabel: "ODT" };
  if (["xls", "xlsx", "ods"].includes(ext)) {
    if (ext === "ods") return { kind: "xls", bannerLabel: "ODS" };
    return { kind: "xls", bannerLabel: "XLS" };
  }
  if (["ppt", "pptx"].includes(ext)) return { kind: "slides", bannerLabel: ext === "pptx" ? "PPTX" : "PPT" };
  if (ext === "odp") return { kind: "ppt", bannerLabel: "ODP" };
  const raw = (fileName?.split(".").pop() ?? "FILE").toUpperCase();
  const bannerLabel = raw.length <= 4 ? raw : `${raw.slice(0, 3)}…`;
  return { kind: "other", bannerLabel };
}

function IconPreviewDoc() {
  return (
    <svg className={styles.fileFlatPreviewSvg} viewBox="0 0 40 36" fill="none" aria-hidden>
      {[9, 14, 19, 24, 29].map((y) => (
        <line key={y} x1="7" y1={y} x2="33" y2={y} stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" opacity={0.85} />
      ))}
    </svg>
  );
}

function IconPreviewXls() {
  const cols = 4;
  const rows = 5;
  const x0 = 7;
  const y0 = 7;
  const cw = 26 / cols;
  const rh = 22 / rows;
  const lines: ReactNode[] = [];
  for (let c = 0; c <= cols; c++) {
    const x = x0 + c * cw;
    lines.push(
      <line key={`v${c}`} x1={x} y1={y0} x2={x} y2={y0 + rows * rh} stroke="currentColor" strokeWidth="1" opacity={0.75} />,
    );
  }
  for (let r = 0; r <= rows; r++) {
    const y = y0 + r * rh;
    lines.push(
      <line key={`h${r}`} x1={x0} y1={y} x2={x0 + cols * cw} y2={y} stroke="currentColor" strokeWidth="1" opacity={0.75} />,
    );
  }
  return (
    <svg className={styles.fileFlatPreviewSvg} viewBox="0 0 40 36" fill="none" aria-hidden>
      {lines}
    </svg>
  );
}

function IconPreviewPpt() {
  return (
    <svg className={styles.fileFlatPreviewSvg} viewBox="0 0 40 36" fill="none" aria-hidden>
      <path d="M 8 22 L 8 10 A 9 9 0 0 1 17 22 Z" fill="none" stroke="currentColor" strokeWidth="1.1" opacity={0.8} />
      <line x1="22" y1="10" x2="33" y2="10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity={0.8} />
      <line x1="22" y1="15" x2="31" y2="15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity={0.75} />
      <line x1="22" y1="20" x2="33" y2="20" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity={0.7} />
      <line x1="22" y1="25" x2="30" y2="25" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity={0.65} />
    </svg>
  );
}

function IconPreviewOther() {
  return <IconPreviewDoc />;
}
