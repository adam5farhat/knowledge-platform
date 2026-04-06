"use client";

import { useId } from "react";
import styles from "./page.module.css";

export function IconSideBackArrow() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M15 18 9 12l6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Department cards: modern gradient folder only (no outer frame — styling is on the SVG). */
export function DeptCardFolderIcon({ className }: { className?: string }) {
  const uid = useId().replace(/:/g, "");
  const gTab = `dcf-tab-${uid}`;
  const gBody = `dcf-body-${uid}`;
  const fSh = `dcf-sh-${uid}`;

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <defs>
        <linearGradient id={gTab} x1="4" y1="5" x2="15" y2="13" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7dd3fc" />
          <stop offset="0.5" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#0ea5e9" />
        </linearGradient>
        <linearGradient id={gBody} x1="12" y1="11" x2="12" y2="21" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3b82f6" />
          <stop offset="0.55" stopColor="#2563eb" />
          <stop offset="1" stopColor="#1e3a8a" />
        </linearGradient>
        <filter id={fSh} x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="0" dy="1.2" stdDeviation="1" floodColor="#0f172a" floodOpacity="0.14" />
        </filter>
      </defs>
      <g filter={`url(#${fSh})`}>
        <path
          d="M4 11h16v7.5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18.5V11Z"
          fill={`url(#${gBody})`}
        />
        <path
          d="M4 11V8.25A1.25 1.25 0 0 1 5.25 7H9l1.45 2.25H18.5a1.25 1.25 0 0 1 1.25 1.25V11H4Z"
          fill={`url(#${gTab})`}
        />
      </g>
    </svg>
  );
}

export function SideIconHome() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function SideIconFolder() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 10.5 6.5 6.5h4l1.5-2H20a1.5 1.5 0 0 1 1.5 1.5V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V8a1.5 1.5 0 0 1 1.5-1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function SideIconClock() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 8v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function SideIconHeart() {
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

export function SideIconArchive() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 8h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 8V6a1 1 0 0 1 1-1h1l1-2h10l1 2h1a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function StatusLabel({
  status,
  error,
  progress,
}: {
  status: string;
  error: string | null;
  progress?: number;
}) {
  const color =
    status === "READY" ? "#15803d" : status === "FAILED" ? "var(--error)" : status === "PROCESSING" ? "#a16207" : "#52525b";

  if ((status === "PROCESSING" || status === "PENDING") && typeof progress === "number") {
    const pct = Math.max(0, Math.min(100, progress));
    const label = status === "PENDING" ? "Queued" : `Processing ${pct}%`;
    return (
      <span style={{ display: "flex", flexDirection: "column", gap: "0.3rem", minWidth: 120 }}>
        <span style={{ color, fontSize: "0.85rem", fontWeight: 600 }}>{label}</span>
        <span
          style={{
            height: 6,
            background: "#e4e4e7",
            borderRadius: 3,
            overflow: "hidden",
            width: "100%",
          }}
        >
          <span
            style={{
              display: "block",
              height: "100%",
              width: `${pct}%`,
              background: status === "PENDING" ? "#a1a1aa" : "#2563eb",
              borderRadius: 3,
              transition: "width 0.4s ease",
            }}
          />
        </span>
      </span>
    );
  }

  return (
    <span style={{ color }}>
      {status}
      {status === "FAILED" && error ? ` — ${error}` : ""}
    </span>
  );
}

export function ActionIconOpen() {
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

export function ActionIconDownload() {
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

export function ActionIconDelete() {
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

export function TableRowHeartIcon({ active }: { active?: boolean }) {
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

export function ActionIconHeart({ active }: { active?: boolean }) {
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

export function ActionIconArchive() {
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

/** Stacked layers — version history / archive (matches admin document panel). */
export function ActionIconLayers() {
  return (
    <svg className={styles.actionIconSvg} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.84l8.57 3.91a2 2 0 0 0 1.66 0l8.57-3.9a1 1 0 0 0 0-1.84Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2 12.5a1 1 0 0 0 .52.88l8.57 4.91a2 2 0 0 0 1.82 0l8.57-4.9A1 1 0 0 0 22 12.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2 17.5a1 1 0 0 0 .52.88l8.57 4.91a2 2 0 0 0 1.82 0l8.57-4.9A1 1 0 0 0 22 17.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
