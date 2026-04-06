"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserAvatarNavButton } from "@/components/UserAvatarNavButton";
import { clearStoredSession, fetchWithAuth, getValidAccessToken, signOut } from "../../../lib/authClient";
import { restrictedHref, userCanOpenManagerDashboard, type MeUserDto } from "../../../lib/restrictions";
import { formatSize } from "../documentsFormat";
import shellStyles from "../page.module.css";
import styles from "./documentDetail.module.css";
import { API_BASE as API } from "@/lib/apiBase";

type Version = {
  id: string;
  versionNumber: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  processingStatus: string;
  processingProgress: number;
  processingError: string | null;
  createdAt: string;
};

type DocumentPayload = {
  document: {
    id: string;
    title: string;
    description?: string | null;
    visibility: string;
    departmentId?: string | null;
    isArchived?: boolean;
    createdAt: string;
    updatedAt?: string;
    createdBy: { id: string; name: string; email: string };
    tags: string[];
    versions: Version[];
  };
  canManage?: boolean;
  canViewAudit?: boolean;
};

type AuditEntry = {
  id: string;
  action: string;
  metadata: unknown;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
};

function formatVisibility(v: string): string {
  const s = v.toLowerCase().replace(/_/g, " ");
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusPillClass(status: string): string {
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

function formatAuditAction(action: string): string {
  const t = action.trim().toLowerCase().replace(/_/g, " ");
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusLabel(status: string): string {
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

export default function DocumentDetailClient({ documentId }: { documentId: string }) {
  const router = useRouter();
  const versionFileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<"loading" | "need-login" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DocumentPayload | null>(null);
  const [me, setMe] = useState<MeUserDto | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditStatus, setAuditStatus] = useState<"idle" | "loading" | "ready">("idle");

  const handleSignOut = useCallback(async () => {
    await signOut();
    router.replace("/login");
    router.refresh();
  }, [router]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!profileMenuRef.current?.contains(e.target as Node)) setProfileMenuOpen(false);
    }
    if (profileMenuOpen) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [profileMenuOpen]);

  async function loadMe() {
    const token = await getValidAccessToken();
    if (!token) return;
    const meRes = await fetchWithAuth(`${API}/auth/me`);
    if (meRes.ok) {
      const body = (await meRes.json()) as { user: MeUserDto };
      setMe(body.user);
    }
  }

  async function load() {
    const res = await fetchWithAuth(`${API}/documents/${documentId}`);
    if (res.status === 401) {
      clearStoredSession();
      setPhase("need-login");
      router.replace("/login");
      return;
    }
    const body = (await res.json().catch(() => ({}))) as DocumentPayload & {
      error?: string;
      code?: string;
      feature?: string;
    };
    if (res.status === 403 && body.code === "FEATURE_RESTRICTED" && body.feature) {
      router.replace(restrictedHref(body.feature));
      return;
    }
    if (!res.ok) {
      setError(body.error ?? "Could not load document");
      setPhase("error");
      return;
    }
    setData(body);
    setAuditEntries([]);
    if (body.canViewAudit) {
      setAuditStatus("loading");
      void loadAuditFor(documentId);
    } else {
      setAuditStatus("idle");
    }
    setPhase("ready");
  }

  async function loadAuditFor(id: string) {
    try {
      const res = await fetchWithAuth(`${API}/documents/${id}/audit`);
      if (!res.ok) {
        setAuditEntries([]);
        return;
      }
      const body = (await res.json()) as { entries?: AuditEntry[] };
      setAuditEntries(body.entries ?? []);
    } finally {
      setAuditStatus("ready");
    }
  }

  useEffect(() => {
    void loadMe();
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  useEffect(() => {
    if (!data) return;
    const hasProcessing = data.document.versions.some(
      (v) => v.processingStatus === "PROCESSING" || v.processingStatus === "PENDING",
    );
    if (!hasProcessing) return;
    const id = window.setInterval(() => {
      void load();
    }, 4000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  async function onUploadVersion(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetchWithAuth(`${API}/documents/${documentId}/versions`, {
        method: "POST",
        body: fd,
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Upload version failed");
        return;
      }
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function onRetry(versionId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API}/documents/${documentId}/versions/${versionId}/reprocess`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Retry failed");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function onDownload(versionId: string, fileName: string) {
    setDownloadingId(versionId);
    try {
      const res = await fetchWithAuth(`${API}/documents/${documentId}/versions/${versionId}/file`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Download failed");
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
      setDownloadingId(null);
    }
  }

  if (phase === "loading" || phase === "need-login") {
    return (
      <main className={shellStyles.shell} data-documents-fullscreen="true">
        <header className={shellStyles.docNavbar}>
          <div className={shellStyles.docNavLeft}>
            <Link prefetch={false} href="/dashboard" className={shellStyles.docNavBrand} aria-label="Dashboard">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={shellStyles.docNavLogo} src="/logo-swapped.svg" alt="" />
            </Link>
          </div>
        </header>
        <div className={styles.detailWorkspace}>
          <div className={styles.loadingMain}>
            <p>Loading…</p>
          </div>
        </div>
      </main>
    );
  }

  if (phase === "error" || !data) {
    return (
      <main className={shellStyles.shell} data-documents-fullscreen="true">
        <header className={shellStyles.docNavbar}>
          <div className={shellStyles.docNavLeft}>
            <Link prefetch={false} href="/dashboard" className={shellStyles.docNavBrand} aria-label="Dashboard">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={shellStyles.docNavLogo} src="/logo-swapped.svg" alt="" />
            </Link>
          </div>
        </header>
        <div className={styles.detailWorkspace}>
          <div className={styles.errorMain}>
            <p style={{ color: "var(--error)" }}>{error ?? "Unable to load document"}</p>
            <Link prefetch={false} href="/documents" className={styles.backLink}>
              ← Back to documents
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const doc = data.document;
  const canManage = data.canManage ?? false;
  const canViewAudit = data.canViewAudit ?? false;
  const latestVersionNumber =
    doc.versions.length > 0 ? Math.max(...doc.versions.map((x) => x.versionNumber)) : 0;

  return (
    <main className={shellStyles.shell} data-documents-fullscreen="true">
      <header className={shellStyles.docNavbar}>
        <div className={shellStyles.docNavLeft}>
          <Link prefetch={false} href="/dashboard" className={shellStyles.docNavBrand} aria-label="Dashboard">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={shellStyles.docNavLogo} src="/logo-swapped.svg" alt="" />
          </Link>
        </div>
        <div className={shellStyles.docNavRight}>
          {me ? (
            <div className={shellStyles.profileWrap} ref={profileMenuRef}>
              <UserAvatarNavButton
                className={shellStyles.profileBtn}
                imgClassName={shellStyles.profileBtnImg}
                pictureUrl={me.profilePictureUrl}
                name={me.name}
                email={me.email}
                aria-haspopup="menu"
                aria-expanded={profileMenuOpen}
                onClick={() => setProfileMenuOpen((v) => !v)}
                title={me.email}
              />
              {profileMenuOpen ? (
                <div className={shellStyles.profileMenu} role="menu">
                  <div className={shellStyles.profileMenuHeader}>
                    <div>{me.name ?? me.email}</div>
                    <div>{me.email}</div>
                  </div>
                  <Link
                    prefetch={false}
                    className={shellStyles.profileMenuItem}
                    href="/profile"
                    role="menuitem"
                    onClick={() => setProfileMenuOpen(false)}
                  >
                    Profile
                  </Link>
                  <Link
                    prefetch={false}
                    className={shellStyles.profileMenuItem}
                    href="/dashboard"
                    role="menuitem"
                    onClick={() => setProfileMenuOpen(false)}
                  >
                    Dashboard
                  </Link>
                  {userCanOpenManagerDashboard(me) ? (
                    <Link
                      prefetch={false}
                      className={shellStyles.profileMenuItem}
                      href="/manager"
                      role="menuitem"
                      onClick={() => setProfileMenuOpen(false)}
                    >
                      Department overview
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    className={shellStyles.profileMenuItem}
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

      <div className={styles.detailWorkspace}>
        <div className={styles.detailScroll}>
          <div className={styles.detailInner}>
            <div className={styles.heroCard}>
              <div className={styles.heroTop}>
                <button
                  type="button"
                  className={styles.heroBackBtn}
                  onClick={() => router.back()}
                  aria-label="Go back to previous page"
                  title="Back"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <div className={styles.heroText}>
                  <h1 className={styles.heroTitle}>{doc.title}</h1>
                  <p className={styles.heroMeta}>
                    Visibility: <strong>{formatVisibility(doc.visibility)}</strong>
                    {" · "}
                    Uploaded by {doc.createdBy.name}
                    {" · "}
                    {new Date(doc.createdAt).toLocaleString()}
                    {doc.isArchived ? (
                      <>
                        {" "}
                        · <strong>Archived</strong>
                      </>
                    ) : null}
                  </p>
                </div>
              </div>
            </div>

            {error ? (
              <p className={styles.alertError} role="alert">
                {error}
              </p>
            ) : null}

            <section className={styles.sectionCard} aria-labelledby="versions-heading">
              <h2 id="versions-heading" className={styles.sectionHead}>
                Versions
              </h2>
              {canManage ? (
                <div className={styles.uploadZone}>
                  <p className={styles.uploadIntro}>Add a new file version. Drop a file here or browse — same types as the library (PDF, Office, images, text).</p>
                  <form onSubmit={onUploadVersion} className={styles.uploadForm}>
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
                        id={versionFileInputId}
                        type="file"
                        className={styles.uploadFileInput}
                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      />
                      <label htmlFor={versionFileInputId} className={styles.uploadDropLabel}>
                        <span className={styles.uploadDropIcon} aria-hidden>
                          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M12 16V4m0 0 4 4m-4-4L8 8" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" strokeLinecap="round" />
                          </svg>
                        </span>
                        <span className={styles.uploadDropTitle}>{file ? "Replace file" : "Drop file or click to browse"}</span>
                        <span className={styles.uploadDropHint}>This becomes the next version for this document</span>
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
                    <div className={styles.uploadActions}>
                      <button type="submit" disabled={busy || !file} className={styles.btnPrimary}>
                        {busy ? "Uploading…" : "Add new version"}
                      </button>
                    </div>
                  </form>
                </div>
              ) : null}
              <div className={styles.tableWrap}>
                {doc.versions.length === 0 ? (
                  <p className={styles.emptyHint}>No file versions yet.</p>
                ) : (
                  <table className={styles.versionTable}>
                    <thead>
                      <tr>
                        <th>File</th>
                        <th>Status</th>
                        <th>Size</th>
                        <th style={{ textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.versions.map((v) => (
                        <tr key={v.id}>
                          <td>
                            <span className={styles.versionFile}>{v.fileName}</span>
                            <span className={styles.versionSub}>
                              v{v.versionNumber}
                              {v.versionNumber === latestVersionNumber ? " · Latest" : ""}
                            </span>
                            {(v.processingStatus === "PROCESSING" || v.processingStatus === "PENDING") ? (
                              <div className={styles.progressTrack}>
                                <div
                                  className={styles.progressFill}
                                  style={{
                                    width: `${v.processingProgress}%`,
                                    background: v.processingStatus === "PENDING" ? "#a1a1aa" : "#2563eb",
                                  }}
                                />
                              </div>
                            ) : null}
                            {canManage && v.processingStatus === "FAILED" && v.processingError ? (
                              <span className={styles.versionSub} style={{ color: "var(--error)" }}>
                                {v.processingError}
                              </span>
                            ) : null}
                          </td>
                          <td>
                            <span className={`${styles.statusPill} ${statusPillClass(v.processingStatus)}`}>
                              {v.processingStatus === "PROCESSING"
                                ? `${statusLabel(v.processingStatus)} ${v.processingProgress}%`
                                : statusLabel(v.processingStatus)}
                            </span>
                          </td>
                          <td>{Math.max(1, Math.round(v.sizeBytes / 1024))} KB</td>
                          <td>
                            <div className={styles.rowActions}>
                              <button
                                type="button"
                                className={styles.btnGhost}
                                onClick={() => void onDownload(v.id, v.fileName)}
                                disabled={downloadingId === v.id}
                              >
                                {downloadingId === v.id ? "Downloading…" : "Download"}
                              </button>
                              {canManage && v.processingStatus === "FAILED" ? (
                                <button type="button" className={styles.btnGhost} onClick={() => void onRetry(v.id)} disabled={busy}>
                                  Retry
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            {canViewAudit ? (
              <section className={styles.sectionCard} aria-labelledby="activity-heading">
                <h2 id="activity-heading" className={styles.sectionHead}>
                  Activity
                </h2>
                {auditStatus === "loading" ? (
                  <p className={styles.emptyHint}>Loading activity…</p>
                ) : auditEntries.length === 0 ? (
                  <p className={styles.emptyHint}>No activity recorded yet.</p>
                ) : (
                  <div className={styles.tableWrap}>
                    <table className={styles.activityTable}>
                      <colgroup>
                        <col className={styles.activityColActivity} />
                        <col className={styles.activityColUsers} />
                        <col className={styles.activityColTime} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th scope="col">Activity</th>
                          <th scope="col">Users</th>
                          <th scope="col">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditEntries.map((e) => (
                          <tr key={e.id}>
                            <td>
                              <span className={styles.activityType}>{formatAuditAction(e.action)}</span>
                            </td>
                            <td className={styles.activityUsersCell}>{e.user ? e.user.name ?? e.user.email : "—"}</td>
                            <td className={styles.activityTimeCell}>
                              <time dateTime={e.createdAt}>
                                {new Date(e.createdAt).toLocaleString(undefined, {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                })}
                              </time>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
