import Link from "next/link";

export default function ContactPage() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1 className="logo" style={{ marginTop: 0 }}>
        Contact
      </h1>
      <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>
        For access requests, account issues, or platform support, contact your organization administrator or your internal IT
        support channel.
      </p>
      <p style={{ marginTop: "1rem" }}>
        <Link prefetch={false} href="/documents">Documents</Link>
      </p>
    </main>
  );
}
