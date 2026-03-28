"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearStoredSession, fetchWithAuth } from "../../lib/authClient";
import styles from "./page.module.css";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type MeResponse = {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    phoneNumber: string | null;
    position: string | null;
    employeeBadgeNumber: string | null;
    profilePictureUrl: string | null;
    department: { id: string; name: string };
  };
};

type LoadState = "loading" | "need-login" | "error" | "ready";

export default function DashboardClient() {
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [data, setData] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetchWithAuth(`${API}/auth/me`);
        if (res.status === 401) {
          clearStoredSession();
          if (!cancelled) {
            setLoadState("need-login");
            router.replace("/login");
          }
          return;
        }
        if (!res.ok) {
          if (!cancelled) {
            setError("Could not load your profile");
            setLoadState("error");
          }
          return;
        }
        let body: MeResponse;
        try {
          body = (await res.json()) as MeResponse;
        } catch {
          if (!cancelled) {
            setError("Invalid response from server");
            setLoadState("error");
          }
          return;
        }
        if (!cancelled) {
          setData(body);
          setLoadState("ready");
        }
      } catch {
        if (!cancelled) {
          setError("Network error");
          setLoadState("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        // Best-effort logout request; local cleanup still completes.
      }
    }
    clearStoredSession();
    router.replace("/login");
    router.refresh();
  }

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  if (loadState === "need-login") {
    return (
      <main style={{ maxWidth: 520 }}>
        <h1>Dashboard</h1>
        <p style={{ color: "#52525b" }}>You need to sign in to view this page.</p>
        <p style={{ marginTop: "1rem" }}>
          <Link href="/login">Sign in</Link>
          {" · "}
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }

  if (loadState === "error" || error) {
    return (
      <main>
        <p style={{ color: "var(--error)" }}>{error ?? "Something went wrong"}</p>
        <Link href="/login">Sign in</Link>
      </main>
    );
  }

  if (loadState === "loading" || !data) {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }

  const { user } = data;
  const nameParts = user.name.trim().split(/\s+/);
  const initials = ((nameParts[0]?.[0] ?? "U") + (nameParts[1]?.[0] ?? "")).toUpperCase();
  const isManagerOrAdmin = user.role === "ADMIN" || user.role === "MANAGER";

  return (
    <main className={styles.page} data-dashboard-fullscreen="true">
      <header className={styles.navbar}>
        <nav className={styles.navLeft} aria-label="Primary">
          <a className={styles.brand} href="/">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.brandMark} src="/logo-swapped.svg" alt="Platform" />
          </a>
          <Link href="/dashboard">Home</Link>
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/documents">Documents</Link>
        </nav>

        <div className={styles.profileWrap} ref={menuRef}>
          <button
            type="button"
            className={styles.profileBtn}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            title={`${user.name} (${user.role})`}
          >
            {initials}
          </button>
          {menuOpen ? (
            <div className={styles.menu} role="menu">
              <div className={styles.menuHeader}>
                <div>{user.name}</div>
                <div>{user.email}</div>
              </div>
              <Link className={styles.menuItem} href="/profile" role="menuitem" onClick={() => setMenuOpen(false)}>
                View Profile
              </Link>
              {isManagerOrAdmin ? (
                <Link className={styles.menuItem} href="/dashboard" role="menuitem" onClick={() => setMenuOpen(false)}>
                  Dashboard
                </Link>
              ) : null}
              {user.role === "ADMIN" ? (
                <>
                  <Link className={styles.menuItem} href="/admin" role="menuitem" onClick={() => setMenuOpen(false)}>
                    Admin hub
                  </Link>
                  <Link className={styles.menuItem} href="/admin/users" role="menuitem" onClick={() => setMenuOpen(false)}>
                    Users
                  </Link>
                  <Link
                    className={styles.menuItem}
                    href="/admin/departments"
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                  >
                    Departments
                  </Link>
                  <Link
                    className={styles.menuItem}
                    href="/admin/documents"
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                  >
                    Document tools
                  </Link>
                  <Link
                    className={styles.menuItem}
                    href="/admin/activity"
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                  >
                    Sign-in activity
                  </Link>
                  <Link
                    className={styles.menuItem}
                    href="/admin/document-audit"
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                  >
                    Document audit
                  </Link>
                  <Link className={styles.menuItem} href="/admin/system" role="menuitem" onClick={() => setMenuOpen(false)}>
                    System stats
                  </Link>
                </>
              ) : null}
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => {
                  setMenuOpen(false);
                  void signOut();
                }}
                role="menuitem"
              >
                Logout
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <section
        className={`${styles.cards} ${user.role === "ADMIN" ? styles.cardsWithAdmin : ""}`}
        aria-label="Core features"
      >
        <Link className={`${styles.card} ${styles.cardDocuments}`} href="/documents" aria-label="Go to document management">
          <div className={styles.cardInner}>
            <div className={styles.icon} aria-hidden>
              <svg className={styles.iconGlyph} viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M7 3.5h7l3 3V20.5H7z" stroke="currentColor" strokeWidth="1.6" />
                <path d="M14 3.5v4h3" stroke="currentColor" strokeWidth="1.6" />
                <path d="M9.5 11.5h5" stroke="currentColor" strokeWidth="1.6" />
                <path d="M9.5 14.5h5" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </div>
            <h2 className={styles.cardTitle}>Documents</h2>
            <p className={styles.cardHint}>Manage and explore enterprise files</p>
          </div>
        </Link>

        <Link
          className={`${styles.card} ${styles.cardQuestions}`}
          href="/documents/search"
          aria-label="Go to semantic search over document embeddings"
        >
          <div className={styles.cardInner}>
            <div className={styles.icon} aria-hidden>
              <svg className={styles.iconGlyph} viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M5 6.5h14v9H9l-4 3z" stroke="currentColor" strokeWidth="1.6" />
                <path d="M9 10.5h6" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </div>
            <h2 className={styles.cardTitle}>Semantic search</h2>
            <p className={styles.cardHint}>Find relevant passages by meaning (embeddings + pgvector)</p>
          </div>
        </Link>

        {user.role === "ADMIN" ? (
          <Link className={`${styles.card} ${styles.cardAdmin}`} href="/admin" aria-label="Open administrator tools">
            <div className={styles.cardInner}>
              <div className={styles.icon} aria-hidden>
                <svg className={styles.iconGlyph} viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M12 3.5l1.8 3.6 4 .6-2.9 2.8.7 4L12 16.9 8.4 14.7l.7-4L6.2 7.7l4-.6L12 3.5z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <path d="M5 20.5h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <h2 className={styles.cardTitle}>Administration</h2>
              <p className={styles.cardHint}>Users, departments, exports, and system overview</p>
            </div>
          </Link>
        ) : null}
      </section>
    </main>
  );
}
