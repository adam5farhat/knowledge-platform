"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "../../lib/authClient";
import styles from "./page.module.css";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Me = {
  user: { id: string; email: string; name?: string; role: string; department: { id: string; name: string } };
};
type DocRow = {
  id: string;
  title: string;
  visibility: string;
  departmentId: string | null;
  departmentName: string | null;
  createdAt: string;
  createdBy: { name: string; email: string };
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
type Dept = { id: string; name: string };

export default function DocumentsClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<"checking" | "need-login" | "ready">("checking");
  const [me, setMe] = useState<Me["user"] | null>(null);
  const [documents, setDocuments] = useState<DocRow[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState("ALL");
  const [departmentId, setDepartmentId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadOk, setUploadOk] = useState<string | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState<string>("__all");
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
  const [uploadStep, setUploadStep] = useState<1 | 2>(1);
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const [pdfPreview, setPdfPreview] = useState<{ url: string; title: string; documentId: string } | null>(null);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [pdfPreviewError, setPdfPreviewError] = useState<string | null>(null);

  const closePdfPreview = useCallback(() => {
    setPdfPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
    setPdfPreviewError(null);
    setPdfPreviewLoading(false);
  }, []);

  const loadDocuments = useCallback(async () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (visibilityFilter !== "ALL") params.set("visibility", visibilityFilter);
    params.set("sort", sort);
    const res = await fetchWithAuth(`${API}/documents?${params.toString()}`);
    if (!res.ok) {
      throw new Error("Could not load documents");
    }
    const data = (await res.json()) as { documents: DocRow[] };
    setDocuments(data.documents);
  }, [q, sort, statusFilter, visibilityFilter]);

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

        await loadDocuments();
        if (!cancelled) setPhase("ready");
      } catch {
        if (!cancelled) setLoadError("Could not load data.");
        if (!cancelled) setPhase("ready");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDocuments, router]);

  async function openDocumentFromPanel(doc: DocRow) {
    const v = doc.latestVersion;
    if (!v || v.processingStatus !== "READY") {
      router.push(`/documents/${doc.id}`);
      return;
    }
    const isPdf = v.mimeType === "application/pdf" || /\.pdf$/i.test(v.fileName);
    if (!isPdf) {
      router.push(`/documents/${doc.id}`);
      return;
    }
    setPdfPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
    setPdfPreviewLoading(true);
    setPdfPreviewError(null);
    try {
      const res = await fetchWithAuth(`${API}/documents/${doc.id}/versions/${v.id}/file`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setPdfPreviewError(body.error ?? "Could not load PDF");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPdfPreview({ url, title: doc.title, documentId: doc.id });
    } catch {
      setPdfPreviewError("Could not load PDF");
    } finally {
      setPdfPreviewLoading(false);
    }
  }

  useEffect(() => {
    if (!pdfPreview && !pdfPreviewLoading) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePdfPreview();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pdfPreview, pdfPreviewLoading, closePdfPreview]);

  useEffect(() => {
    if (!uploadModalOpen) return;
    setUploadStep(1);
    setUploadDragActive(false);
    setUploadError(null);
    setUploadOk(null);
  }, [uploadModalOpen]);

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
      setUploadStep(1);
      setUploadModalOpen(false);
      await loadDocuments();
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
    await loadDocuments();
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

  const departmentItems = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const d of documents) {
      const id = d.departmentId ?? "__general";
      const name = d.departmentName ?? (d.departmentId ? "Department" : "General");
      const prev = map.get(id);
      map.set(id, { id, name, count: (prev?.count ?? 0) + 1 });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [documents]);

  const departmentLabel =
    selectedDepartment === "__all" ? "Departments" : departmentItems.find((d) => d.id === selectedDepartment)?.name ?? "Files";

  const breadcrumbForFolder =
    selectedDepartment === "__all" ? "Home › Documents" : `Home › ${departmentLabel}`;

  const breadcrumbForFileCards = selectedDepartment === "__all" ? "" : `Home › ${departmentLabel}`;

  const filteredDocs = useMemo(() => {
    const now = Date.now();
    return documents.filter((d) => {
      if (selectedDepartment !== "__all" && (d.departmentId ?? "__general") !== selectedDepartment) return false;
      if (fileTypeFilter !== "ALL") {
        const ext = (d.latestVersion?.fileName.split(".").pop() ?? "").toLowerCase();
        if (fileTypeFilter === "PDF" && ext !== "pdf") return false;
        if (fileTypeFilter === "DOC" && !["doc", "docx"].includes(ext)) return false;
        if (fileTypeFilter === "TXT" && ext !== "txt") return false;
        if (fileTypeFilter === "IMG" && !["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return false;
      }
      if (dateFilter !== "ALL") {
        const ts = new Date(d.createdAt).getTime();
        const day = 24 * 60 * 60 * 1000;
        if (dateFilter === "TODAY" && now - ts > day) return false;
        if (dateFilter === "WEEK" && now - ts > 7 * day) return false;
        if (dateFilter === "MONTH" && now - ts > 30 * day) return false;
      }
      if (tagFilter.trim()) {
        const tag = tagFilter.trim().toLowerCase();
        if (!d.title.toLowerCase().includes(tag) && !d.visibility.toLowerCase().includes(tag)) return false;
      }
      return true;
    });
  }, [dateFilter, documents, fileTypeFilter, selectedDepartment, tagFilter]);

  const selectedDoc = filteredDocs.find((d) => d.id === selectedFileId) ?? null;

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
        </div>
        <div className={styles.sideScroll}>
          <section className={styles.sideSection} aria-labelledby="lib-browse-heading">
            <h2 id="lib-browse-heading" className={styles.sideTitle}>
              Browse
            </h2>
            <nav className={styles.sideNav} aria-labelledby="lib-browse-heading">
              <button
                type="button"
                className={`${styles.sideBtn} ${selectedDepartment === "__all" ? styles.activeSideBtn : ""}`}
                onClick={() => setSelectedDepartment("__all")}
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
                  className={`${styles.sideBtn} ${selectedDepartment === dep.id ? styles.activeSideBtn : ""}`}
                  onClick={() => setSelectedDepartment(dep.id)}
                >
                  <span className={styles.sideIcon} aria-hidden>
                    <SideIconFolder />
                  </span>
                  <span>
                    {dep.name} <span className={styles.detailMeta}>({dep.count})</span>
                  </span>
                </button>
              ))}
            </nav>
          </section>
          <section className={styles.sideSection} aria-labelledby="lib-soon-heading">
            <h2 id="lib-soon-heading" className={styles.sideTitle}>
              Coming soon
            </h2>
            <div className={styles.sideNav} role="group" aria-label="Coming soon">
              <button type="button" className={styles.sideBtn} disabled>
                <span className={styles.sideIcon} aria-hidden>
                  <SideIconClock />
                </span>
                <span>Recent</span>
              </button>
              <button type="button" className={styles.sideBtn} disabled>
                <span className={styles.sideIcon} aria-hidden>
                  <SideIconStar />
                </span>
                <span>Favorites</span>
              </button>
              <button type="button" className={styles.sideBtn} disabled>
                <span className={styles.sideIcon} aria-hidden>
                  <SideIconArchive />
                </span>
                <span>Archived</span>
              </button>
            </div>
          </section>
        </div>
        <div className={styles.sideFooter}>
          <button type="button" className={styles.sideBackBtn} onClick={() => router.back()} aria-label="Go back">
            ← Back
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
            <button type="button" className={styles.primary} onClick={() => void loadDocuments()}>
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
          {selectedDepartment === "__all" ? (
            <section className={`${styles.panelCard} ${styles.explorerCard}`}>
              <p className={styles.explorerPath}>{breadcrumbForFolder}</p>
              <h2 className={styles.explorerHeading}>Departments</h2>
              <div className={styles.deptGrid}>
                {departmentItems.map((dep) => (
                  <article key={dep.id} className={styles.deptCard} onClick={() => setSelectedDepartment(dep.id)}>
                    <div style={{ fontSize: "1.5rem" }}>📁</div>
                    <h3 style={{ margin: "0.45rem 0 0", fontSize: "1rem" }}>{dep.name}</h3>
                    <p className={styles.detailMeta}>{dep.count} files</p>
                  </article>
                ))}
              </div>
            </section>
          ) : (
            <section className={`${styles.panelCard} ${styles.explorerCard}`}>
              <p className={styles.explorerPath}>{breadcrumbForFolder}</p>
              <h2 className={styles.explorerHeading}>{departmentLabel}</h2>
              {loadError ? <p style={{ color: "var(--error)" }}>{loadError}</p> : null}
              {filteredDocs.length === 0 ? <p className={styles.detailMeta}>No files in this section yet.</p> : null}
              {viewMode === "grid" ? (
                <div className={styles.fileGrid}>
                  {filteredDocs.map((d) => (
                    <article
                      key={d.id}
                      className={`${styles.fileCard} ${selectedFileId === d.id ? styles.fileCardSelected : ""}`}
                      onClick={() => setSelectedFileId(d.id)}
                      onDoubleClick={() => router.push(`/documents/${d.id}`)}
                      aria-selected={selectedFileId === d.id}
                    >
                      {fileIcon(d.latestVersion?.fileName)}
                      <p className={styles.fileCardPath}>{breadcrumbForFileCards}</p>
                      <h3 className={styles.fileCardTitle}>{d.title}</h3>
                      <p className={styles.detailMeta}>{d.latestVersion?.fileName ?? "No version"}</p>
                      <p className={styles.detailMeta}>
                        {d.latestVersion ? `${Math.round(d.latestVersion.sizeBytes / 1024)} KB` : "0 KB"} · {new Date(d.createdAt).toLocaleDateString()}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Size</th>
                      <th>Date</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDocs.map((d) => (
                      <tr
                        key={d.id}
                        className={`${styles.tableRow} ${selectedFileId === d.id ? styles.tableRowSelected : ""}`}
                        onClick={() => setSelectedFileId(d.id)}
                        onDoubleClick={() => router.push(`/documents/${d.id}`)}
                        aria-selected={selectedFileId === d.id}
                      >
                        <td>
                          <div className={styles.tableCellPath}>{breadcrumbForFileCards}</div>
                          <div className={styles.tableCellTitle}>{d.title}</div>
                        </td>
                        <td>{d.latestVersion?.fileName.split(".").pop()?.toUpperCase() ?? "-"}</td>
                        <td>{d.latestVersion ? `${Math.round(d.latestVersion.sizeBytes / 1024)} KB` : "-"}</td>
                        <td>{new Date(d.createdAt).toLocaleDateString()}</td>
                        <td><StatusLabel status={d.latestVersion?.processingStatus ?? "PENDING"} error={d.latestVersion?.processingError ?? null} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </section>
      </section>

      <aside className={`${styles.detailsWrap} ${selectedDoc ? styles.detailsOpen : ""}`}>
        <div className={styles.detailsCard}>
          {selectedDoc ? (
            <>
              <div className={styles.detailsHeader}>
                <h2 className={styles.detailsTitle}>File Details</h2>
                <button type="button" className={styles.ghost} onClick={() => setSelectedFileId(null)}>Close</button>
              </div>
              <div className={styles.detailsPreview}>{fileIcon(selectedDoc.latestVersion?.fileName)}</div>

              <section className={styles.detailsSection}>
                <h3 className={styles.detailsSectionTitle}>File name</h3>
                <div className={styles.fileNameRow}>
                  <p className={styles.fileNameText}>{selectedDoc.latestVersion?.fileName ?? selectedDoc.title}</p>
                  <span className={styles.fileSizeText}>{formatSize(selectedDoc.latestVersion?.sizeBytes)}</span>
                </div>
              </section>

              <section className={styles.detailsSection}>
                <h3 className={styles.detailsSectionTitle}>Description</h3>
                <p className={styles.detailMeta}>
                  {selectedDoc.title} in {selectedDoc.departmentName ?? "General"} department, shared as{" "}
                  {selectedDoc.visibility.toLowerCase()}.
                </p>
              </section>

              <section className={styles.detailsSection}>
                <h3 className={styles.detailsSectionTitle}>Version</h3>
                {selectedDoc.latestVersion ? (
                  <>
                    <p className={styles.detailMeta} style={{ marginTop: 0 }}>
                      Latest upload is version {selectedDoc.latestVersion.versionNumber}.
                    </p>
                    <div className={styles.versionRow}>
                      <div className={styles.versionRowMain}>
                        <span className={styles.versionNumberLabel}>Version {selectedDoc.latestVersion.versionNumber}</span>
                        <span className={styles.versionLatestBadge}>Current</span>
                      </div>
                      <div className={styles.versionFileName}>{selectedDoc.latestVersion.fileName}</div>
                      <div className={styles.versionMeta}>
                        <StatusLabel
                          status={selectedDoc.latestVersion.processingStatus}
                          error={selectedDoc.latestVersion.processingError}
                        />
                        <span className={styles.versionMetaSep}>·</span>
                        <span>{formatSize(selectedDoc.latestVersion.sizeBytes)}</span>
                        <span className={styles.versionMetaSep}>·</span>
                        <span>{new Date(selectedDoc.latestVersion.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className={styles.detailMeta} style={{ marginTop: 0 }}>
                    No uploads yet.
                  </p>
                )}
              </section>

              <section className={styles.detailsSection}>
                <h3 className={styles.detailsSectionTitle}>Action</h3>
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
                  {isManagerOrAdmin ? (
                    <button type="button" className={styles.actionItem} onClick={() => void onDelete(selectedDoc.id)}>
                      <span className={styles.actionIcon} aria-hidden>
                        <ActionIconDelete />
                      </span>
                      <span className={styles.actionLabel}>Delete</span>
                    </button>
                  ) : null}
                </div>
              </section>

              <section className={styles.detailsSection}>
                <p className={styles.detailMeta}>Uploaded by: {selectedDoc.createdBy.name}</p>
                <p className={styles.detailMeta}>Date: {new Date(selectedDoc.createdAt).toLocaleDateString()}</p>
                <p className={styles.detailMeta}>Type: {selectedDoc.latestVersion?.mimeType ?? "-"}</p>
              </section>
            </>
          ) : (
            <p className={styles.detailMeta}>Single click a file to open details. Double click to open file page.</p>
          )}
        </div>
      </aside>

      <button
        type="button"
        className={styles.uploadFab}
        onClick={() => {
          setUploadError(null);
          setUploadOk(null);
          setUploadStep(1);
          setFile(null);
          setTitle("");
          setUploadModalOpen(true);
        }}
        aria-label="Upload file"
        title="Upload file"
      >
        <svg className={styles.uploadFabIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M12 5v14M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

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
                  {uploadStep === 1 ? "Choose a file, then add document details." : "Review details and publish to the library."}
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
              <div className={`${styles.uploadStepperTrack} ${uploadStep === 2 ? styles.uploadStepperTrackDone : ""}`} />
              <div className={styles.uploadStepperSteps}>
                <div className={`${styles.uploadStepperItem} ${uploadStep >= 1 ? styles.uploadStepperItemActive : ""}`}>
                  <span className={styles.uploadStepperBadge}>1</span>
                  <span className={styles.uploadStepperLabel}>File</span>
                </div>
                <div className={`${styles.uploadStepperItem} ${uploadStep >= 2 ? styles.uploadStepperItemActive : ""}`}>
                  <span className={styles.uploadStepperBadge}>2</span>
                  <span className={styles.uploadStepperLabel}>Details</span>
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
            ) : (
              <form onSubmit={onUpload} className={styles.uploadForm}>
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
                      setUploadStep(1);
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

function SideIconStar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 4l.5 2L15 7l-2.3 1.7L14 15l-2-1.3L10 15l1.3-6.3L9 7l2.5-1L12 4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
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

type FileIconKind = "pdf" | "doc" | "xls" | "ppt" | "other";

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

function resolveFileIconKind(fileName: string | undefined): { kind: FileIconKind; bannerLabel: string } {
  const ext = (fileName?.split(".").pop() ?? "").toLowerCase();
  if (ext === "pdf") return { kind: "pdf", bannerLabel: "PDF" };
  if (["doc", "docx", "odt"].includes(ext)) return { kind: "doc", bannerLabel: "DOC" };
  if (["xls", "xlsx", "csv", "ods"].includes(ext)) {
    if (ext === "csv") return { kind: "xls", bannerLabel: "CSV" };
    if (ext === "ods") return { kind: "xls", bannerLabel: "ODS" };
    return { kind: "xls", bannerLabel: "XLS" };
  }
  if (["ppt", "pptx", "odp"].includes(ext)) return { kind: "ppt", bannerLabel: "PPT" };
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
