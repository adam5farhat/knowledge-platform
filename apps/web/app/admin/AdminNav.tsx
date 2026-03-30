"use client";

import Link from "next/link";

export default function AdminNav() {
  return (
    <nav
      aria-label="Admin sections"
      style={{
        display: "flex",
        gap: "0.5rem",
        flexWrap: "wrap",
        alignItems: "center",
        marginBottom: "1.25rem",
        fontSize: "0.9rem",
        color: "#52525b",
      }}
    >
      <Link prefetch={false} href="/admin">Hub</Link>
      <span aria-hidden>·</span>
      <Link prefetch={false} href="/admin/users">Users</Link>
      <span aria-hidden>·</span>
      <Link prefetch={false} href="/admin/departments">Departments</Link>
      <span aria-hidden>·</span>
      <Link prefetch={false} href="/admin/documents">Documents</Link>
      <span aria-hidden>·</span>
      <Link prefetch={false} href="/admin/activity">Activity</Link>
      <span aria-hidden>·</span>
      <Link prefetch={false} href="/admin/document-audit">Doc audit</Link>
      <span aria-hidden>·</span>
      <Link prefetch={false} href="/admin/system">System</Link>
      <span aria-hidden>·</span>
      <Link prefetch={false} href="/dashboard">Dashboard</Link>
    </nav>
  );
}
