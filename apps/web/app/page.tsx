import Link from "next/link";
import HealthStatus from "../components/HealthStatus";

export default function Home() {
  return (
    <main>
      <a className="logoLink" href="/">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="logoMark" src="/logo.svg" alt="Knowledge Platform" />
        <h1 className="logo" style={{ margin: 0 }}>
          Knowledge Platform
        </h1>
      </a>
      <p>Sprint 2 — documents, embeddings &amp; semantic search</p>
      <nav style={{ marginTop: "1rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <Link href="/login">Sign in</Link>
        <Link href="/profile">Profile</Link>
        <Link href="/register">How to get an account</Link>
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/documents">Documents</Link>
        <Link href="/documents/search">Search</Link>
        <Link href="/admin/users">Admin: add user</Link>
      </nav>
      <section style={{ marginTop: "1.5rem" }}>
        <h2>API health</h2>
        <HealthStatus />
      </section>
    </main>
  );
}
