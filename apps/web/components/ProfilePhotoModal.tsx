"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ProfileAvatarImage } from "@/components/ProfileAvatarImage";
import { fetchWithAuth, getValidAccessToken } from "@/lib/authClient";
import { fileToAvatarBlob } from "@/lib/fileToAvatarBlob";
import { hasProfilePicture, profilePictureDisplayUrl, userInitialsFromName } from "@/lib/profilePicture";
import styles from "./ProfilePhotoModal.module.css";
import { API_BASE as API } from "../lib/apiBase";

type UserShape = { profilePictureUrl?: string | null };

export type ProfilePhotoModalProps = {
  open: boolean;
  onClose: () => void;
  mode: "self" | "admin";
  targetUserId?: string;
  displayName: string;
  pictureUrl: string | null;
  pictureUrlDraft: string;
  onPictureUrlDraftChange: (v: string) => void;
  onPictureUpdated: (nextUrl: string | null) => void;
};

export function ProfilePhotoModal({
  open,
  onClose,
  mode,
  targetUserId,
  displayName,
  pictureUrl,
  pictureUrlDraft,
  onPictureUrlDraftChange,
  onPictureUpdated,
}: ProfilePhotoModalProps) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const uploadEndpoint =
    mode === "self" ? `${API}/auth/profile/avatar` : `${API}/admin/users/${targetUserId}/avatar`;
  const deleteEndpoint =
    mode === "self" ? `${API}/auth/profile/avatar` : `${API}/admin/users/${targetUserId}/avatar`;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      setError(null);
      setOk(null);
      setDragOver(false);
    }
  }, [open]);

  const runUpload = useCallback(
    async (blob: Blob) => {
      setError(null);
      setOk(null);
      const token = await getValidAccessToken();
      if (!token) {
        setError("Not signed in.");
        return;
      }
      if (mode === "admin" && !targetUserId) {
        setError("Missing user.");
        return;
      }
      setBusy(true);
      try {
        const fd = new FormData();
        fd.append("file", blob, "avatar.jpg");
        const res = await fetch(uploadEndpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string; user?: UserShape };
        if (!res.ok) {
          setError(data.error ?? "Upload failed");
          return;
        }
        const next = data.user?.profilePictureUrl ?? null;
        onPictureUpdated(next);
        onPictureUrlDraftChange(next ?? "");
        setOk("Photo uploaded.");
      } catch {
        setError("Could not reach the server.");
      } finally {
        setBusy(false);
      }
    },
    [mode, onPictureUpdated, onPictureUrlDraftChange, targetUserId, uploadEndpoint],
  );

  const onPickFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      try {
        const blob = await fileToAvatarBlob(file);
        await runUpload(blob);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Invalid file");
      }
    },
    [runUpload],
  );

  const removePhoto = useCallback(async () => {
    setError(null);
    setOk(null);
    const token = await getValidAccessToken();
    if (!token) {
      setError("Not signed in.");
      return;
    }
    if (mode === "admin" && !targetUserId) {
      setError("Missing user.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(deleteEndpoint, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not remove photo");
        return;
      }
      onPictureUpdated(null);
      onPictureUrlDraftChange("");
      setOk("Photo removed.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }, [deleteEndpoint, mode, onPictureUpdated, onPictureUrlDraftChange, targetUserId]);

  const applyPictureUrl = useCallback(async () => {
    setError(null);
    setOk(null);
    const token = await getValidAccessToken();
    if (!token) {
      setError("Not signed in.");
      return;
    }
    if (mode === "admin" && !targetUserId) {
      setError("Missing user.");
      return;
    }
    const raw = pictureUrlDraft.trim();
    const body = { profilePictureUrl: raw === "" ? null : raw };
    setBusy(true);
    try {
      const path =
        mode === "self" ? `${API}/auth/profile` : `${API}/admin/users/${targetUserId}`;
      const res = await fetchWithAuth(path, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        user?: UserShape;
      };
      if (!res.ok) {
        setError(data.error ?? "Could not save image URL");
        return;
      }
      const next = data.user?.profilePictureUrl ?? (raw === "" ? null : raw);
      onPictureUpdated(next ?? null);
      onPictureUrlDraftChange(next ?? "");
      setOk("Picture URL applied.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }, [mode, onPictureUpdated, onPictureUrlDraftChange, pictureUrlDraft, targetUserId]);

  if (!open) return null;

  const src = profilePictureDisplayUrl(pictureUrl);
  const initials = userInitialsFromName(displayName);
  const showRemove = hasProfilePicture(pictureUrl);

  return (
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            Profile photo
          </h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className={styles.body}>
          <div className={styles.preview}>
            {src ? (
              <ProfileAvatarImage className={styles.previewImg} src={src} alt="" width={400} height={400} sizes="240px" />
            ) : (
              <span className={styles.previewFallback} aria-hidden>
                {initials}
              </span>
            )}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className={styles.hiddenInput}
            disabled={busy}
            onChange={(e) => void onPickFiles(e.target.files)}
          />

          <button
            type="button"
            className={`${styles.dropzone} ${dragOver ? styles.dropzoneActive : ""}`}
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void onPickFiles(e.dataTransfer.files);
            }}
          >
            <p className={styles.dropTitle}>{busy ? "Uploading…" : "Drag and drop an image here"}</p>
            <p className={styles.dropHint}>or click to browse · JPEG, PNG or WebP · max 2 MB</p>
          </button>

          <div className={styles.row}>
            <button type="button" className={styles.btn} disabled={busy} onClick={() => inputRef.current?.click()}>
              Browse files
            </button>
            {showRemove ? (
              <button type="button" className={styles.btnDanger} disabled={busy} onClick={() => void removePhoto()}>
                Remove photo
              </button>
            ) : null}
          </div>

          <div className={styles.urlSection}>
            <label className={styles.urlLabel} htmlFor={`${titleId}-url`}>
              Image URL
            </label>
            <input
              id={`${titleId}-url`}
              className={styles.urlInput}
              type="url"
              value={pictureUrlDraft}
              onChange={(e) => onPictureUrlDraftChange(e.target.value)}
              placeholder="https://…"
              autoComplete="off"
            />
            <p className={styles.urlHint}>Use a direct https link to an image, or upload a file above.</p>
            <button type="button" className={styles.btnPrimary} disabled={busy} onClick={() => void applyPictureUrl()}>
              Apply URL
            </button>
          </div>

          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          {ok ? (
            <p className={styles.ok} role="status">
              {ok}
            </p>
          ) : null}

          <div className={styles.footer}>
            <button type="button" className={styles.btnPrimary} onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
