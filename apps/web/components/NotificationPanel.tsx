"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNotifications, type UserNotificationItem } from "./NotificationContext";
import { SendNotificationModal } from "./SendNotificationModal";
import { fetchWithAuth } from "@/lib/authClient";
import { API_BASE as API } from "@/lib/apiBase";
import styles from "./Notifications.module.css";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function typeIcon(type: string): string {
  switch (type) {
    case "DOCUMENT_CREATED":
      return "\u{1F4C4}";
    case "DOCUMENT_UPDATED":
      return "\u{1F4DD}";
    case "DOCUMENT_DELETED":
      return "\u{1F5D1}";
    case "MANAGER_ASSIGNED":
      return "\u{1F451}";
    case "MANAGER_REMOVED":
      return "\u{1F6AB}";
    case "MEMBER_ADDED":
      return "\u{1F465}";
    case "MANUAL":
      return "\u{1F4E2}";
    default:
      return "\u{1F514}";
  }
}

function typeLabel(type: string): string {
  switch (type) {
    case "DOCUMENT_CREATED":
      return "Document created";
    case "DOCUMENT_UPDATED":
      return "Document updated";
    case "DOCUMENT_DELETED":
      return "Document deleted";
    case "MANAGER_ASSIGNED":
      return "Manager assigned";
    case "MANAGER_REMOVED":
      return "Manager removed";
    case "MEMBER_ADDED":
      return "Member added";
    case "MANUAL":
      return "Announcement";
    default:
      return "Notification";
  }
}

/* ------------------------------------------------------------------ */
/*  Single item row                                                    */
/* ------------------------------------------------------------------ */

function NotificationRow({
  item,
  onRead,
  onDelete,
  onSelect,
}: {
  item: UserNotificationItem;
  onRead: (id: string) => void;
  onDelete: (id: string) => void;
  onSelect: (item: UserNotificationItem) => void;
}) {
  return (
    <div
      className={`${styles.row} ${item.read ? styles.rowRead : styles.rowUnread}`}
      role="button"
      tabIndex={0}
      onClick={() => {
        if (!item.read) onRead(item.id);
        onSelect(item);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (!item.read) onRead(item.id);
          onSelect(item);
        }
      }}
    >
      <span className={styles.rowIcon}>{typeIcon(item.notification.type)}</span>
      <div className={styles.rowBody}>
        <div className={styles.rowTitle}>{item.notification.title}</div>
        <div className={styles.rowMeta}>
          {item.notification.actor && (
            <span className={styles.rowActor}>{item.notification.actor.name}</span>
          )}
          <span className={styles.rowTime}>{timeAgo(item.createdAt)}</span>
        </div>
      </div>
      <button
        type="button"
        className={styles.rowDeleteBtn}
        aria-label="Delete notification"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(item.id);
        }}
      >
        &times;
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Detail modal                                                       */
/* ------------------------------------------------------------------ */

function NotificationDetail({
  item,
  onClose,
}: {
  item: UserNotificationItem;
  onClose: () => void;
}) {
  const n = item.notification;
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    if (downloading || !n.attachmentKey) return;
    setDownloading(true);
    try {
      const res = await fetchWithAuth(`${API}/notifications/${n.id}/attachment`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = n.attachmentName ?? "attachment";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* network error */
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className={styles.detailOverlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Notification detail">
      <div className={styles.detailCard} onClick={(e) => e.stopPropagation()}>
        <header className={styles.detailHeader}>
          <span className={styles.detailIcon}>{typeIcon(n.type)}</span>
          <h3 className={styles.detailTitle}>{n.title}</h3>
          <button type="button" className={styles.detailClose} onClick={onClose}>
            &times;
          </button>
        </header>
        {n.body && <p className={styles.detailBody}>{n.body}</p>}
        <div className={styles.detailMeta}>
          {n.actor && <span>From: {n.actor.name} ({n.actor.email})</span>}
          <span>{new Date(n.createdAt).toLocaleString()}</span>
          <span className={styles.detailType}>{typeLabel(n.type)}</span>
        </div>
        {n.attachmentName && (
          <button
            type="button"
            className={styles.detailAttachment}
            onClick={() => void handleDownload()}
            disabled={downloading}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>{downloading ? "Downloading..." : n.attachmentName}</span>
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Panel                                                              */
/* ------------------------------------------------------------------ */

export function NotificationPanel() {
  const {
    items,
    unreadCount,
    panelOpen,
    setPanelOpen,
    markAsRead,
    markAllRead,
    deleteNotification,
    loadMore,
    hasMore,
    loading,
    refresh,
    userRole,
    manageableDepartmentIds,
  } = useNotifications();

  const panelRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<UserNotificationItem | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const canSend = userRole === "ADMIN" || userRole === "MANAGER" || manageableDepartmentIds.length > 0;

  useEffect(() => {
    if (panelOpen) {
      void refresh();
    } else {
      setSelected(null);
      setSendOpen(false);
    }
  }, [panelOpen, refresh]);

  useEffect(() => {
    if (!panelOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (sendOpen) return;
        if (selected) setSelected(null);
        else setPanelOpen(false);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [panelOpen, setPanelOpen, selected, sendOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    function handleClick(e: MouseEvent) {
      if (sendOpen) return;
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [panelOpen, setPanelOpen, sendOpen]);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40 && hasMore && !loading) {
        void loadMore();
      }
    },
    [hasMore, loading, loadMore],
  );

  if (!panelOpen) return null;

  return (
    <>
      <div className={styles.backdrop} />
      <div className={styles.panel} ref={panelRef} role="dialog" aria-label="Notifications">
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Notifications</h2>
          {canSend && (
            <button
              type="button"
              className={styles.markAllBtn}
              onClick={() => setSendOpen(true)}
            >
              Send
            </button>
          )}
          {unreadCount > 0 && (
            <button
              type="button"
              className={styles.markAllBtn}
              onClick={() => void markAllRead()}
            >
              Mark all read
            </button>
          )}
          <button
            type="button"
            className={styles.panelCloseBtn}
            aria-label="Close notifications"
            onClick={() => setPanelOpen(false)}
          >
            &times;
          </button>
        </header>

        <div className={styles.panelList} onScroll={handleScroll}>
          {items.length === 0 && !loading && (
            <div className={styles.empty}>No notifications yet</div>
          )}
          {items.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              onRead={(id) => void markAsRead(id)}
              onDelete={(id) => void deleteNotification(id)}
              onSelect={setSelected}
            />
          ))}
          {loading && <div className={styles.loadingRow}>Loading...</div>}
        </div>

        {selected && (
          <NotificationDetail item={selected} onClose={() => setSelected(null)} />
        )}
      </div>

      {sendOpen && (
        <SendNotificationModal
          open={sendOpen}
          onClose={() => setSendOpen(false)}
          onSent={() => void refresh()}
          userRole={userRole}
          manageableDepartmentIds={manageableDepartmentIds}
        />
      )}
    </>
  );
}

