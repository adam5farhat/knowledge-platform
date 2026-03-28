"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "../../lib/authClient";
import AdminNav from "./AdminNav";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Phase = "checking" | "need-login" | "forbidden" | "ready";

const cards: { href: string; title: string; blurb: string }[] = [
  {
    href: "/admin/users",
    title: "Users",
    blurb: "Directory, create accounts, edit roles, reset passwords, unlock, deactivate, or delete.",
  },
  {
    href: "/admin/departments",
    title: "Departments",
    blurb: "Create and rename departments, set parents, merge, or remove unused ones.",
  },
  {
    href: "/admin/documents",
    title: "Documents",
    blurb: "Export the library to CSV and bulk-delete documents (destructive).",
  },
  {
    href: "/admin/activity",
    title: "Auth activity",
    blurb: "Recent sign-in and security-related events across the organization.",
  },
  {
    href: "/admin/document-audit",
    title: "Document audit",
    blurb: "Library-wide audit trail: uploads, edits, views, archives, and deletions.",
  },
  {
    href: "/admin/system",
    title: "System",
    blurb: "High-level counts: users, documents, departments, and processing health.",
  },
];

export default function AdminHubClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");

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
        const me = (await meRes.json().catch(() => ({}))) as { user?: { role?: string } };
        if (!meRes.ok || me.user?.role !== "ADMIN") {
          if (!cancelled) setPhase("forbidden");
          return;
        }
        if (!cancelled) setPhase("ready");
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
      <main style={{ maxWidth: 720 }}>
        <p>Loading…</p>
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
          <Link href="/">Home</Link>
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
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 720 }}>
      <h1 style={{ marginBottom: "0.35rem" }}>Administration</h1>
      <p style={{ color: "#52525b", marginTop: 0 }}>Manage users, structure, and platform data.</p>
      <AdminNav />
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "grid",
          gap: "0.75rem",
        }}
      >
        {cards.map((c) => (
          <li key={c.href}>
            <Link
              href={c.href}
              style={{
                display: "block",
                padding: "1rem 1.1rem",
                borderRadius: 8,
                border: "1px solid #e4e4e7",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <strong style={{ display: "block", marginBottom: 4 }}>{c.title}</strong>
              <span style={{ color: "#52525b", fontSize: "0.9rem" }}>{c.blurb}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
