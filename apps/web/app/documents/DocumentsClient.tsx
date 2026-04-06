"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileTypeIcon } from "../../components/FileTypeIcon";
import { UserAvatarNavButton } from "@/components/UserAvatarNavButton";
import { NotificationBell } from "@/components/NotificationBell";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  clearStoredSession,
  fetchWithAuth,
  getValidAccessToken,
  signOut,
  KP_AUTH_SESSION_REFRESHED,
} from "../../lib/authClient";
import {
  DEFAULT_USER_RESTRICTIONS,
  restrictedHref,
  RoleNameApi,
  userCanOpenManagerDashboard,
  type MeResponse,
  type MeUserDto,
} from "../../lib/restrictions";
import styles from "./page.module.css";
import type { Dept, DocRow, LibraryScope } from "./documentsTypes";
import { MAX_UPLOAD_TAGS, TABLE_TAGS_VISIBLE } from "./documentsTypes";
import {
  formatModifiedTable,
  formatSize,
  formatUploadedOnLine,
  initialsFromPerson,
  normalizeUploadTag,
} from "./documentsFormat";
import { VersionArchiveModal } from "./VersionArchiveModal";
import {
  ActionIconArchive,
  ActionIconDelete,
  ActionIconDownload,
  ActionIconHeart,
  ActionIconLayers,
  ActionIconOpen,
  DeptCardFolderIcon,
  IconSideBackArrow,
  SideIconArchive,
  SideIconClock,
  SideIconFolder,
  SideIconHeart,
  SideIconHome,
  StatusLabel,
  TableRowHeartIcon,
} from "./DocumentsClientIcons";
import { API_BASE as API } from "@/lib/apiBase";

export default function DocumentsClient() {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [phase, setPhase] = useState<"checking" | "need-login" | "ready">("checking");
  const [me, setMe] = useState<MeUserDto | null>(null);
  const [sessionRecheck, setSessionRecheck] = useState(0);
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
  /** Stable id while modal is open so closing the side panel does not break the dialog. */
  const [versionArchiveDocId, setVersionArchiveDocId] = useState<string | null>(null);
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

  const isAdmin = useMemo(() => me?.role === RoleNameApi.ADMIN, [me?.role]);

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
          toast(`Ready: ${d.title}`, "success");
        }
        nextMap.set(d.id, st);
      }
      statusNotifyRef.current = nextMap;
    },
    [
      q,
      sort,
      visibilityFilter,
      fileTypeFilter,
      dateFilter,
      tagFilter,
      libraryScope,
      selectedDepartment,
      toast,
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
    visibilityFilter,
    fileTypeFilter,
    dateFilter,
    tagFilter,
  ]);

  useEffect(() => {
    function onSessionRefreshed() {
      setSessionRecheck((n) => n + 1);
    }
    window.addEventListener(KP_AUTH_SESSION_REFRESHED, onSessionRefreshed);
    return () => window.removeEventListener(KP_AUTH_SESSION_REFRESHED, onSessionRefreshed);
  }, []);

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
    }, 4000);
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
        const meJson = (await meRes.json()) as MeResponse;
        const docRs = meJson.user.restrictions ?? DEFAULT_USER_RESTRICTIONS;
        if (docRs.accessDocumentsAllowed === false) {
          if (!cancelled) router.replace(restrictedHref("accessDocuments"));
          return;
        }

        if (!cancelled) setMe(meJson.user);

        if (meJson.user.role === RoleNameApi.ADMIN) {
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
  }, [router, sessionRecheck]);

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
      toast("You can delete at most 50 documents per request.", "error");
      return;
    }
    if (!(await confirm({ title: "Delete Items", message: `Permanently delete ${ids.length} document(s)? This cannot be undone.`, danger: true }))) return;
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

  async function handleSignOut() {
    await signOut();
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
      if (visibility === "DEPARTMENT" && me?.role === RoleNameApi.ADMIN && departmentId) {
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
    if (!(await confirm({ title: "Delete", message: "Delete this document and all versions?", danger: true }))) return;
    const token = await getValidAccessToken();
    if (!token) return;
    const res = await fetchWithAuth(`${API}/documents/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast(data.error ?? "Delete failed", "error");
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
      toast(data.error ?? "Could not archive this document.", "error");
      return;
    }
    await loadDocuments(listPage, false);
  }

  async function unarchiveDoc(documentId: string) {
    const res = await fetchWithAuth(`${API}/documents/${documentId}/archive`, { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast(data.error ?? "Could not unarchive this document.", "error");
      return;
    }
    await loadDocuments(listPage, false);
  }

  async function onDownload(documentId: string, versionId: string, fileName: string) {
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
    } finally {
      // no-op
    }
  }

  const isManagerOrAdmin = me != null && userCanOpenManagerDashboard(me);
  const mr = me?.restrictions ?? DEFAULT_USER_RESTRICTIONS;
  const canManageDocumentsUi = isManagerOrAdmin && mr.manageDocumentsAllowed !== false;
  const canUploadDocuments = canManageDocumentsUi;
  const canBulkAdmin = me?.role === RoleNameApi.ADMIN && mr.manageDocumentsAllowed !== false;

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
      <header className={styles.docNavbar}>
        <div className={styles.docNavLeft}>
          <Link prefetch={false} href="/dashboard" className={styles.docNavBrand} aria-label="Dashboard">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.docNavLogo} src="/logo-swapped.svg" alt="" />
          </Link>
        </div>
        <div className={styles.docNavRight}>
          {me ? (
            <>
              <NotificationBell />
              <div className={styles.profileWrap} ref={profileMenuRef}>
              <UserAvatarNavButton
                className={styles.profileBtn}
                imgClassName={styles.profileBtnImg}
                pictureUrl={me.profilePictureUrl}
                name={me.name}
                email={me.email}
                aria-haspopup="menu"
                aria-expanded={profileMenuOpen}
                onClick={() => setProfileMenuOpen((v) => !v)}
                title={me.email}
              />
              {profileMenuOpen ? (
                <div className={styles.profileMenu} role="menu">
                  <div className={styles.profileMenuHeader}>
                    <div>{me.name ?? me.email}</div>
                    <div>{me.email}</div>
                  </div>
                  <Link prefetch={false} className={styles.profileMenuItem} href="/profile" role="menuitem" onClick={() => setProfileMenuOpen(false)}>
                    Profile
                  </Link>
                  <Link prefetch={false} className={styles.profileMenuItem} href="/dashboard" role="menuitem" onClick={() => setProfileMenuOpen(false)}>
                    Dashboard
                  </Link>
                  {me && userCanOpenManagerDashboard(me) ? (
                    <Link
                      prefetch={false}
                      className={styles.profileMenuItem}
                      href="/manager"
                      role="menuitem"
                      onClick={() => setProfileMenuOpen(false)}
                    >
                      Department overview
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    className={styles.profileMenuItem}
                    role="menuitem"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      void handleSignOut();
                    }}
                  >
                    Log out
                  </button>
                </div>
              ) : null}
            </div>
            </>
          ) : null}
        </div>
      </header>

      <div className={styles.shellWorkspace}>
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

      <div className={styles.docMainColumn}>
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

        <section className={styles.content}>
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
              {canBulkAdmin && bulkSelected.size > 0 ? (
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
                  <Link prefetch={false} href="/admin/documents" style={{ fontSize: "0.88rem", color: "#2563eb" }}>
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
                        <div className={styles.fileCardIconWrap}>
                          <FileTypeIcon fileName={d.latestVersion?.fileName} variant="card" />
                        </div>
                        <h3 className={styles.fileCardTitle}>{d.title}</h3>
                        <p className={styles.fileCardMeta}>
                          {formatSize(d.latestVersion?.sizeBytes)} · {new Date(d.createdAt).toLocaleDateString()}
                        </p>
                        {d.latestVersion && (d.latestVersion.processingStatus === "PROCESSING" || d.latestVersion.processingStatus === "PENDING") ? (
                          <div className={styles.fileCardProgress}>
                            <div
                              className={styles.fileCardProgressBar}
                              style={{ width: `${d.latestVersion.processingProgress}%` }}
                            />
                            <span className={styles.fileCardProgressLabel}>
                              {d.latestVersion.processingStatus === "PENDING"
                                ? "Queued"
                                : `${d.latestVersion.processingProgress}%`}
                            </span>
                          </div>
                        ) : null}
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
                                  <div className={styles.tableRowFileIcon}>
                                    <FileTypeIcon fileName={d.latestVersion?.fileName} variant="row" />
                                  </div>
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
      </div>
      </div>

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
                  <div className={styles.detailsPreview}>
                    <FileTypeIcon fileName={selectedDoc.latestVersion?.fileName} variant="detail" />
                  </div>
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
                              <StatusLabel status={selectedDoc.latestVersion.processingStatus} error={null} progress={selectedDoc.latestVersion.processingProgress} />
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
                    <button
                      type="button"
                      className={styles.actionItem}
                      onClick={() => setVersionArchiveDocId(selectedDoc.id)}
                    >
                      <span className={styles.actionIcon} aria-hidden>
                        <ActionIconLayers />
                      </span>
                      <span className={styles.actionLabel}>Versions</span>
                    </button>
                    <Link
                      prefetch={false}
                      href={`/documents/${selectedDoc.id}`}
                      className={styles.actionItem}
                      style={{ textDecoration: "none" }}
                    >
                      <span className={styles.actionIcon} aria-hidden>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                        </svg>
                      </span>
                      <span className={styles.actionLabel}>Full page</span>
                    </Link>
                    {canManageDocumentsUi ? (
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
                    {canManageDocumentsUi ? (
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
                {visibility === "DEPARTMENT" && me?.role === RoleNameApi.ADMIN && departments.length > 0 ? (
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

      <VersionArchiveModal
        open={versionArchiveDocId !== null}
        documentId={versionArchiveDocId}
        apiBase={API}
        onClose={() => setVersionArchiveDocId(null)}
        onVersionsChanged={() => void loadDocuments(listPage, false)}
      />
    </main>
  );
}
