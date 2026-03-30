import Link from "next/link";

export default function AboutPage() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1 className="logo" style={{ marginTop: 0 }}>
        About
      </h1>
      <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>
        The AI-Powered Enterprise Knowledge Platform helps teams manage documents and retrieve answers quickly using semantic
        search. It is built to be simple for everyday users while supporting role-aware administration for enterprise
        operations.
      </p>
      <p style={{ marginTop: "1rem" }}>
        <Link prefetch={false} href="/documents">Documents</Link>
      </p>
    </main>
  );
}
