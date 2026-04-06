"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithAuth } from "@/lib/authClient";
import { API_BASE as API } from "@/lib/apiBase";
import styles from "./SendNotification.module.css";

type Department = { id: string; name: string };

type TargetType = "ALL_USERS" | "DEPARTMENT" | "ROLE";

interface Props {
  open: boolean;
  onClose: () => void;
  onSent: () => void;
  userRole: string;
  manageableDepartmentIds?: string[];
}

export function SendNotificationModal({
  open,
  onClose,
  onSent,
  userRole,
  manageableDepartmentIds,
}: Props) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [targetType, setTargetType] = useState<TargetType>("ALL_USERS");
  const [targetDepartmentId, setTargetDepartmentId] = useState("");
  const [targetRoleName, setTargetRoleName] = useState("EMPLOYEE");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const isAdmin = userRole === "ADMIN";
  const isManager = userRole === "MANAGER" || (manageableDepartmentIds?.length ?? 0) > 0;

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setBody("");
    setAttachment(null);
    setError("");
    if (isAdmin) {
      setTargetType("ALL_USERS");
    } else {
      setTargetType("DEPARTMENT");
      if (manageableDepartmentIds?.length) {
        setTargetDepartmentId(manageableDepartmentIds[0]);
      }
    }
  }, [open, isAdmin, manageableDepartmentIds]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await fetchWithAuth(`${API}/admin/departments`);
        if (res.ok) {
          const data = await res.json();
          setDepartments(data.departments ?? []);
        }
      } catch {
        /* ignore */
      }
    })();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [open, onClose]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");
      if (!title.trim()) {
        setError("Title is required");
        return;
      }
      if (targetType === "DEPARTMENT" && !targetDepartmentId) {
        setError("Please select a department");
        return;
      }
      if (targetType === "ROLE" && !targetRoleName) {
        setError("Please select a role");
        return;
      }

      setSending(true);
      try {
        const fd = new FormData();
        fd.append("title", title.trim());
        if (body.trim()) fd.append("body", body.trim());
        fd.append("targetType", targetType);
        if (targetType === "DEPARTMENT" && targetDepartmentId) {
          fd.append("targetDepartmentId", targetDepartmentId);
        }
        if (targetType === "ROLE" && targetRoleName) {
          fd.append("targetRoleName", targetRoleName);
        }
        if (attachment) {
          fd.append("attachment", attachment);
        }

        const res = await fetchWithAuth(`${API}/notifications/send`, {
          method: "POST",
          body: fd,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || `Failed (${res.status})`);
          return;
        }

        onSent();
        onClose();
      } catch {
        setError("Network error");
      } finally {
        setSending(false);
      }
    },
    [title, body, targetType, targetDepartmentId, targetRoleName, attachment, onSent, onClose],
  );

  const availableDepts = isAdmin
    ? departments
    : departments.filter((d) => manageableDepartmentIds?.includes(d.id));

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.card}
        ref={dialogRef}
        role="dialog"
        aria-label="Send notification"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h3 className={styles.headerTitle}>Send Notification</h3>
          <button type="button" className={styles.closeBtn} onClick={onClose}>
            &times;
          </button>
        </header>

        <form onSubmit={(e) => void handleSubmit(e)} className={styles.form}>
          <label className={styles.label}>
            Title *
            <input
              className={styles.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              autoFocus
            />
          </label>

          <label className={styles.label}>
            Body
            <textarea
              className={styles.textarea}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={5000}
              rows={4}
            />
          </label>

          <label className={styles.label}>
            Send to
            {isAdmin ? (
              <select
                className={styles.select}
                value={targetType}
                onChange={(e) => setTargetType(e.target.value as TargetType)}
              >
                <option value="ALL_USERS">All users</option>
                <option value="DEPARTMENT">Department</option>
                <option value="ROLE">Role</option>
              </select>
            ) : (
              <span className={styles.fixedTarget}>Your department</span>
            )}
          </label>

          {targetType === "DEPARTMENT" && (
            <label className={styles.label}>
              Department
              <select
                className={styles.select}
                value={targetDepartmentId}
                onChange={(e) => setTargetDepartmentId(e.target.value)}
              >
                <option value="">Select department...</option>
                {availableDepts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {isAdmin && targetType === "ROLE" && (
            <label className={styles.label}>
              Role
              <select
                className={styles.select}
                value={targetRoleName}
                onChange={(e) => setTargetRoleName(e.target.value)}
              >
                <option value="EMPLOYEE">Employee</option>
                <option value="MANAGER">Manager</option>
                <option value="ADMIN">Admin</option>
              </select>
            </label>
          )}

          <div className={styles.attachRow}>
            <button
              type="button"
              className={styles.attachBtn}
              onClick={() => fileRef.current?.click()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
              {attachment ? attachment.name : "Attach file"}
            </button>
            {attachment && (
              <button
                type="button"
                className={styles.removeAttach}
                onClick={() => {
                  setAttachment(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              >
                &times;
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              className={styles.fileInput}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f && f.size > 10 * 1024 * 1024) {
                  setError("Attachment must be under 10 MB");
                  e.target.value = "";
                  return;
                }
                setError("");
                setAttachment(f);
              }}
            />
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={sending}>
              Cancel
            </button>
            <button type="submit" className={styles.sendBtn} disabled={sending}>
              {sending ? "Sending..." : "Send"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
