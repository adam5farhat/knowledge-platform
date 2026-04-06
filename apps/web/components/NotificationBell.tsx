"use client";

import { useNotifications } from "./NotificationContext";
import styles from "./Notifications.module.css";

export function NotificationBell() {
  const { unreadCount, panelOpen, setPanelOpen } = useNotifications();

  return (
    <button
      type="button"
      className={styles.bell}
      aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
      aria-expanded={panelOpen}
      onClick={() => setPanelOpen(!panelOpen)}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {unreadCount > 0 && (
        <span className={styles.badge}>{unreadCount > 99 ? "99+" : unreadCount}</span>
      )}
    </button>
  );
}
