"use client";

import { useCallback, useId, useRef, useState } from "react";
import { ProfileAvatarImage } from "@/components/ProfileAvatarImage";
import { getValidAccessToken } from "@/lib/authClient";
import { fileToAvatarBlob } from "@/lib/fileToAvatarBlob";
import { hasProfilePicture, profilePictureDisplayUrl, userInitialsFromName } from "@/lib/profilePicture";
import styles from "./ProfilePhotoUploader.module.css";
import { API_BASE as API } from "../lib/apiBase";

type ProfilePhotoUploaderProps = {
  mode: "self" | "admin";
  targetUserId?: string;
  displayName: string;
  pictureUrl: string | null;
  onPictureUpdated: (nextUrl: string | null) => void;
  disabled?: boolean;
  compact?: boolean;
};

export function ProfilePhotoUploader({
  mode,
  targetUserId,
  displayName,
  pictureUrl,
  onPictureUpdated,
  disabled = false,
  compact = false,
}: ProfilePhotoUploaderProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const uploadEndpoint =
    mode === "self" ? `${API}/auth/profile/avatar` : `${API}/admin/users/${targetUserId}/avatar`;
  const deleteEndpoint =
    mode === "self" ? `${API}/auth/profile/avatar` : `${API}/admin/users/${targetUserId}/avatar`;

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
        const data = (await res.json().catch(() => ({}))) as { error?: string; user?: { profilePictureUrl?: string | null } };
        if (!res.ok) {
          setError(data.error ?? "Upload failed");
          return;
        }
        const next = data.user?.profilePictureUrl ?? null;
        onPictureUpdated(next);
        setOk("Photo updated.");
      } catch {
        setError("Could not reach the server.");
      } finally {
        setBusy(false);
      }
    },
    [mode, onPictureUpdated, targetUserId, uploadEndpoint],
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
      setOk("Photo removed.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }, [deleteEndpoint, mode, onPictureUpdated, targetUserId]);

  const src = profilePictureDisplayUrl(pictureUrl);
  const initials = userInitialsFromName(displayName);
  const showRemove = hasProfilePicture(pictureUrl);

  return (
    <div className={`${styles.wrap} ${compact ? styles.wrapCompact : ""}`}>
      <div className={styles.previewRow}>
        {src ? (
          <ProfileAvatarImage className={styles.avatar} src={src} alt="" width={88} height={88} sizes="88px" />
        ) : (
          <span className={styles.fallback} aria-hidden>
            {initials}
          </span>
        )}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className={styles.hiddenInput}
          disabled={disabled || busy}
          onChange={(e) => void onPickFiles(e.target.files)}
        />
        <button
          type="button"
          className={`${styles.dropzone} ${dragOver ? styles.dropzoneActive : ""}`}
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
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
          <p className={styles.dropTitle}>{busy ? "Uploading…" : "Drop a photo here or click to browse"}</p>
          <p className={styles.dropHint}>JPEG, PNG or WebP · resized to 512px max · up to 2 MB</p>
        </button>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.btnPrimary} disabled={disabled || busy} onClick={() => inputRef.current?.click()}>
          Choose file
        </button>
        {showRemove ? (
          <button type="button" className={styles.btnDanger} disabled={disabled || busy} onClick={() => void removePhoto()}>
            Remove photo
          </button>
        ) : null}
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
    </div>
  );
}
