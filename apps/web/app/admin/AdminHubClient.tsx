"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "@/lib/authClient";
import dash from "../components/shellNav.module.css";
import { AdminHubGlyph } from "./AdminHubIcons";
import styles from "./adminHub.module.css";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Phase = "checking" | "need-login" | "forbidden" | "ready";

type HubUser = {
  name: string;
  email: string;
  role: string;
};

type HubCard = {
  href: string;
  title: string;
  blurb: string;
  accent: string;
  icon: "users" | "departments" | "documents" | "activity" | "audit" | "system";
};

const cards: HubCard[] = [
  {
    href: "/admin/users",
    title: "Users",
    blurb: "Directory, create accounts, edit roles, reset passwords, unlock, deactivate, or delete.",
    accent: styles.accentUsers,
    icon: "users",
  },
  {
    href: "/admin/departments",
    title: "Departments",
    blurb: "Create and rename departments, set parents, merge, or remove unused ones.",
    accent: styles.accentDepartments,
    icon: "departments",
  },
  {
    href: "/admin/documents",
    title: "Documents",
    blurb: "Export the library to CSV and bulk-delete documents (destructive).",
    accent: styles.accentDocuments,
    icon: "documents",
  },
  {
    href: "/admin/activity",
    title: "Auth activity",
    blurb: "Recent sign-in and security-related events across the organization.",
    accent: styles.accentActivity,
    icon: "activity",
  },
  {
    href: "/admin/document-audit",
    title: "Document audit",
    blurb: "Library-wide audit trail: uploads, edits, views, archives, and deletions.",
    accent: styles.accentAudit,
    icon: "audit",
  },
  {
    href: "/admin/system",
    title: "System",
    blurb: "High-level counts: users, documents, departments, and processing health.",
    accent: styles.accentSystem,
    icon: "system",
  },
];

export default function AdminHubClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [user, setUser] = useState<HubUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const t = await getValidAccessToken();
      if (!t) {
        if (!cancelled) {
          setPhase("need-login");
          router.replace("/login");
        }
        return;
      }
      try {
        const meRes = await fetchWithAuth(`${API}/auth/me`);
        if (meRes.status === 401) {
          clearStoredSession();
          if (!cancelled) {
            setPhase("need-login");
            router.replace("/login");
          }
          return;
        }
        const me = (await meRes.json().catch(() => ({}))) as {
          user?: { name?: string; email?: string; role?: string };
        };
        if (!meRes.ok || me.user?.role !== "ADMIN") {
          if (!cancelled) setPhase("forbidden");
          return;
        }
        if (!cancelled) {
          setUser({
            name: me.user?.name ?? "",
            email: me.user?.email ?? "",
            role: me.user?.role ?? "ADMIN",
          });
          setPhase("ready");
        }
      } catch {
        if (!cancelled) setPhase("forbidden");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

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
        /* best-effort */
      }
    }
    clearStoredSession();
    router.replace("/login");
    router.refresh();
  }

  if (phase === "checking") {
    return (
      <main className={dash.page} data-dashboard-fullscreen="true">
        <p style={{ padding: "1rem" }}>Loading…</p>
      </main>
    );
  }

  if (phase === "need-login") {
    return (
      <main style={{ maxWidth: 520 }}>
        <h1>Administration</h1>
        <p style={{ color: "#52525b" }}>Sign in to continue.</p>
        <p style={{ marginTop: "1rem" }}>
          <Link href="/login">Sign in</Link>
          {" · "}
          <Link href="/documents">Home</Link>
        </p>
      </main>
    );
  }

  if (phase === "forbidden") {
    return (
      <main style={{ maxWidth: 520 }}>
        <h1>Administration</h1>
        <p style={{ color: "var(--error)" }}>This area is only available to administrators.</p>
        <p style={{ marginTop: "1rem" }}>
          <Link href="/dashboard">Dashboard</Link>
          {" · "}
          <Link href="/documents">Home</Link>
        </p>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  const nameParts = user.name.trim().split(/\s+/);
  const initials = ((nameParts[0]?.[0] ?? "A") + (nameParts[1]?.[0] ?? "")).toUpperCase();

  return (
    <main className={dash.page} data-dashboard-fullscreen="true">
      <header className={dash.navbar}>
        <nav className={dash.navLeft} aria-label="Primary">
          <a className={dash.brand} href="/dashboard">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={dash.brandMark} src="/logo-swapped.svg" alt="Platform" />
          </a>
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/documents">Documents</Link>
        </nav>

        <div className={dash.profileWrap} ref={menuRef}>
          <button
            type="button"
            className={dash.profileBtn}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            title={`${user.name} (${user.role})`}
          >
            {initials}
          </button>
          {menuOpen ? (
            <div className={dash.menu} role="menu">
              <div className={dash.menuHeader}>
                <div>{user.name}</div>
                <div>{user.email}</div>
              </div>
              <Link className={dash.menuItem} href="/profile" role="menuitem" onClick={() => setMenuOpen(false)}>
                View Profile
              </Link>
              <Link className={dash.menuItem} href="/dashboard" role="menuitem" onClick={() => setMenuOpen(false)}>
                Dashboard
              </Link>
              <Link className={dash.menuItem} href="/admin" role="menuitem" onClick={() => setMenuOpen(false)}>
                Admin hub
              </Link>
              <Link className={dash.menuItem} href="/admin/users" role="menuitem" onClick={() => setMenuOpen(false)}>
                Users
              </Link>
              <Link className={dash.menuItem} href="/admin/departments" role="menuitem" onClick={() => setMenuOpen(false)}>
                Departments
              </Link>
              <Link className={dash.menuItem} href="/admin/documents" role="menuitem" onClick={() => setMenuOpen(false)}>
                Document tools
              </Link>
              <Link className={dash.menuItem} href="/admin/activity" role="menuitem" onClick={() => setMenuOpen(false)}>
                Sign-in activity
              </Link>
              <Link className={dash.menuItem} href="/admin/document-audit" role="menuitem" onClick={() => setMenuOpen(false)}>
                Document audit
              </Link>
              <Link className={dash.menuItem} href="/admin/system" role="menuitem" onClick={() => setMenuOpen(false)}>
                System stats
              </Link>
              <button
                type="button"
                className={dash.menuItem}
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

      <section className={styles.featureGrid} aria-label="Administration">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className={`${styles.featureCard} ${c.accent}`}
            aria-label={c.title}
          >
            <div className={styles.featureInner}>
              <div className={styles.icon} aria-hidden>
                <AdminHubGlyph type={c.icon} className={styles.iconGlyph} />
              </div>
              <h2 className={styles.featureTitle}>{c.title}</h2>
              <p className={styles.featureHint}>{c.blurb}</p>
            </div>
          </Link>
        ))}
      </section>
    </main>
  );
}
