"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "@/lib/authClient";
import dash from "../components/shellNav.module.css";
import { AdminChromeHeader } from "./AdminChromeHeader";
import { AdminHubGlyph } from "./AdminHubIcons";
import styles from "./adminHub.module.css";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Phase = "checking" | "need-login" | "forbidden" | "ready";

type HubUser = {
  name: string;
  email: string;
  role: string;
  profilePictureUrl?: string | null;
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
          user?: { name?: string; email?: string; role?: string; profilePictureUrl?: string | null };
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
            profilePictureUrl: me.user?.profilePictureUrl ?? null,
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

  return (
    <main className={dash.page} data-dashboard-fullscreen="true">
      <AdminChromeHeader user={user} />

      <Link
        href="/dashboard"
        className={styles.hubBackFab}
        aria-label="Back to dashboard"
        title="Back to dashboard"
      >
        <svg className={styles.hubBackFabIcon} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M15 18 9 12l6-6"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Link>

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
