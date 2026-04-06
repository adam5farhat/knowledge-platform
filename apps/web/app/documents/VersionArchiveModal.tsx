"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import { fetchWithAuth } from "@/lib/authClient";
import { useToast } from "@/components/Toast";
import archStyles from "../admin/documents/adminDocuments.module.css";

type VersionRow = {
  id: string;
  versionNumber: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  processingStatus: string;
  processingError: string | null;
  createdAt: string;
};

type DocumentDetailPayload = {
  document: {
    id: string;
    title: string;
    versions: VersionRow[];
  };
  canManage: boolean;
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

function statusPillClass(status: string) {
  switch (status) {
    case "READY":
      return archStyles.statusReady;
    case "PROCESSING":
      return archStyles.statusProcessing;
    case "PENDING":
      return archStyles.statusPending;
    case "FAILED":
      return archStyles.statusFailed;
    default:
      return archStyles.statusPending;
  }
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

export type VersionArchiveModalProps = {
  open: boolean;
  documentId: string | null;
  apiBase: string;
  onClose: () => void;
  /** Called after upload or reprocess so the parent list can refresh */
  onVersionsChanged?: () => void;
};

export function VersionArchiveModal({
  open,
  documentId,
  apiBase,
  onClose,
  onVersionsChanged,
}: VersionArchiveModalProps) {
  const titleId = useId();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [detail, setDetail] = useState<DocumentDetailPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [archivesError, setArchivesError] = useState<string | null>(null);
  const [archivesUploadBusy, setArchivesUploadBusy] = useState(false);
  const [archivesDownloadingId, setArchivesDownloadingId] = useState<string | null>(null);
  const [archivesReprocessId, setArchivesReprocessId] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (!documentId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchWithAuth(`${apiBase}/documents/${documentId}`);
      const body = (await res.json().catch(() => ({}))) as DocumentDetailPayload & { error?: string };
      if (!res.ok) {
        setDetail(null);
        setLoadError(body.error ?? `Could not load document (${res.status})`);
        return;
      }
      setDetail(body);
    } catch {
      setDetail(null);
      setLoadError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, [apiBase, documentId]);

  useEffect(() => {
    if (!open || !documentId) {
      setDetail(null);
      setLoadError(null);
      setArchivesError(null);
      return;
    }
    void loadDetail();
  }, [open, documentId, loadDetail]);

  async function downloadFile(versionId: string, fileName: string) {
    if (!documentId) return;
    setArchivesDownloadingId(versionId);
    try {
      const res = await fetchWithAuth(`${apiBase}/documents/${documentId}/versions/${versionId}/file`);
      if (!res.ok) {
        toast("Download failed.", "error");
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
    } finally {
      setArchivesDownloadingId(null);
    }
  }

  async function uploadVersion(file: File) {
    if (!documentId) return;
    setArchivesUploadBusy(true);
    setArchivesError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetchWithAuth(`${apiBase}/documents/${documentId}/versions`, {
        method: "POST",
        body: fd,
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setArchivesError(body.error ?? "Upload failed.");
        return;
      }
      await loadDetail();
      onVersionsChanged?.();
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch {
      setArchivesError("Could not reach the server.");
    } finally {
      setArchivesUploadBusy(false);
    }
  }

  async function reprocessVersion(versionId: string) {
    if (!documentId) return;
    setArchivesReprocessId(versionId);
    setArchivesError(null);
    try {
      const res = await fetchWithAuth(`${apiBase}/documents/${documentId}/versions/${versionId}/reprocess`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setArchivesError(body.error ?? "Reprocess failed.");
        return;
      }
      await loadDetail();
      onVersionsChanged?.();
    } catch {
      setArchivesError("Could not reach the server.");
    } finally {
      setArchivesReprocessId(null);
    }
  }

  async function copyVersionId(versionId: string) {
    try {
      await navigator.clipboard.writeText(versionId);
    } catch {
      /* ignore */
    }
  }

  if (!open || !documentId) return null;

  const panelDetail = detail;
  const showBody = !loading && !loadError && panelDetail;

  return (
    <>
      <button type="button" className={archStyles.archivesBackdrop} aria-label="Close version archive" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={archStyles.archivesDialog}
      >
        <div className={archStyles.archivesDialogHeader}>
          <h2 id={titleId} className={archStyles.archivesDialogTitle}>
            Version archive
          </h2>
          <button type="button" className={archStyles.archivesDialogClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {loading ? (
          <p style={{ margin: "1rem 1.15rem", color: "var(--muted)" }}>Loading…</p>
        ) : loadError ? (
          <p style={{ margin: "1rem 1.15rem", color: "var(--error)" }} role="alert">
            {loadError}
          </p>
        ) : showBody ? (
          <>
            <p className={archStyles.archivesDialogSubtitle}>{panelDetail.document.title}</p>
            <p className={archStyles.archivesDialogHint}>
              All file versions for this document. Download any revision, re-run processing, or add a new upload.
            </p>
            {archivesError ? (
              <div className={archStyles.archivesError} role="alert">
                {archivesError}
              </div>
            ) : null}

            {panelDetail.canManage ? (
              <div className={archStyles.archivesUploadBar}>
                <div className={archStyles.archivesUploadHead}>
                  <span className={archStyles.archivesUploadLabel}>New version</span>
                  <p className={archStyles.archivesUploadLead}>Upload a new file to create the next revision.</p>
                </div>
                <div className={archStyles.archivesUploadActions}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className={archStyles.archivesFileInput}
                    accept=".pdf,.doc,.docx,.txt,.html,.htm,.md,.csv,.xlsx,.xls,.pptx,.png,.jpg,.jpeg,.gif,.webp"
                    disabled={archivesUploadBusy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadVersion(f);
                    }}
                  />
                  <button
                    type="button"
                    className={archStyles.archivesUploadBtn}
                    disabled={archivesUploadBusy}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {archivesUploadBusy ? "Uploading…" : "Upload file…"}
                  </button>
                </div>
                <p className={archStyles.archivesUploadHint}>
                  Same rules as the document library (supported types, max 50 MB).
                </p>
              </div>
            ) : null}

            <div className={archStyles.archivesTableWrap}>
              <table className={archStyles.archivesTable}>
                <thead>
                  <tr>
                    <th className={archStyles.archivesTh}>File</th>
                    <th className={archStyles.archivesTh}>Status</th>
                    <th className={archStyles.archivesTh}>Uploaded</th>
                    <th className={archStyles.archivesTh}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {panelDetail.document.versions.length === 0 ? (
                    <tr>
                      <td className={archStyles.archivesTd} colSpan={4}>
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
                          className={`${archStyles.archivesTr} ${isLatest ? archStyles.archivesTrLatest : ""}`}
                        >
                          <td className={`${archStyles.archivesTd} ${archStyles.archivesFileCell}`}>
                            <div className={archStyles.docRow}>
                              <span className={archStyles.docIcon}>
                                <FileTypeIcon fileName={v.fileName} variant="row" />
                              </span>
                              <div className={archStyles.docText}>
                                <p className={archStyles.docTitle}>{v.fileName}</p>
                                <p className={archStyles.docMeta}>
                                  v{v.versionNumber} · {formatDocSize(v.sizeBytes)}
                                  {isLatest ? (
                                    <>
                                      {" "}
                                      · <span className={archStyles.archivesLatestBadge}>Latest</span>
                                    </>
                                  ) : null}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className={archStyles.archivesTd}>
                            <span
                              className={`${archStyles.statusPill} ${statusPillClass(v.processingStatus)}`}
                              title={processingErrorHoverTitle(v.processingStatus, v.processingError)}
                            >
                              {statusLabel(v.processingStatus)}
                            </span>
                          </td>
                          <td className={archStyles.archivesTd}>
                            <time className={archStyles.archivesTime} dateTime={v.createdAt}>
                              {formatUploadedDate(v.createdAt)}
                            </time>
                          </td>
                          <td className={archStyles.archivesTd}>
                            <div className={archStyles.archivesActions}>
                              <button
                                type="button"
                                className={archStyles.archivesIconBtn}
                                title="Download this version"
                                aria-label={`Download ${v.fileName}`}
                                disabled={!!archivesDownloadingId || archivesUploadBusy}
                                onClick={() => void downloadFile(v.id, v.fileName)}
                              >
                                {archivesDownloadingId === v.id ? (
                                  <span className={archStyles.archivesIconSpinner} aria-hidden />
                                ) : (
                                  <ArchivesIconDownload />
                                )}
                              </button>
                              <button
                                type="button"
                                className={archStyles.archivesIconBtn}
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
                                  className={archStyles.archivesIconBtn}
                                  title="Reprocess this version"
                                  aria-label="Reprocess file"
                                  disabled={!!archivesReprocessId || archivesUploadBusy}
                                  onClick={() => void reprocessVersion(v.id)}
                                >
                                  {archivesReprocessId === v.id ? (
                                    <span className={archStyles.archivesIconSpinner} aria-hidden />
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
          </>
        ) : null}

        <div className={archStyles.archivesFooter}>
          <button type="button" className={archStyles.archivesDoneBtn} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </>
  );
}
