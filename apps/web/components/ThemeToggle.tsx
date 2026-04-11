"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import styles from "./ThemeToggle.module.css";

/** Segmented control for profile / nav dropdowns */
export function ThemeToggleMenu() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className={styles.placeholder} aria-hidden />;
  }

  return (
    <div className={styles.row} role="group" aria-label="Color theme">
      <p className={styles.label}>Theme</p>
      <button
        type="button"
        className={`${styles.btn} ${theme === "light" ? styles.btnActive : ""}`}
        onClick={() => setTheme("light")}
        aria-pressed={theme === "light"}
      >
        Light
      </button>
      <button
        type="button"
        className={`${styles.btn} ${theme === "dark" ? styles.btnActive : ""}`}
        onClick={() => setTheme("dark")}
        aria-pressed={theme === "dark"}
      >
        Dark
      </button>
      <button
        type="button"
        className={`${styles.btn} ${theme === "system" ? styles.btnActive : ""}`}
        onClick={() => setTheme("system")}
        aria-pressed={theme === "system"}
      >
        System
      </button>
    </div>
  );
}

function IconSun() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function IconMonitor() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

/** Icon buttons for auth pages and minimal chrome */
export function ThemeToggleCorner() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className={styles.cornerWrap} aria-hidden />;
  }

  return (
    <div className={styles.cornerWrap} role="toolbar" aria-label="Color theme">
      <button
        type="button"
        className={`${styles.cornerBtn} ${theme === "light" ? styles.cornerBtnActive : ""}`}
        onClick={() => setTheme("light")}
        aria-label="Light theme"
        aria-pressed={theme === "light"}
        title="Light"
      >
        <IconSun />
      </button>
      <button
        type="button"
        className={`${styles.cornerBtn} ${theme === "dark" ? styles.cornerBtnActive : ""}`}
        onClick={() => setTheme("dark")}
        aria-label="Dark theme"
        aria-pressed={theme === "dark"}
        title="Dark"
      >
        <IconMoon />
      </button>
      <button
        type="button"
        className={`${styles.cornerBtn} ${theme === "system" ? styles.cornerBtnActive : ""}`}
        onClick={() => setTheme("system")}
        aria-label="Match system theme"
        aria-pressed={theme === "system"}
        title="System"
      >
        <IconMonitor />
      </button>
    </div>
  );
}
