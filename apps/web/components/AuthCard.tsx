import type { ReactNode } from "react";

type AuthCardProps = {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
};

export default function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <main style={{ maxWidth: 440, margin: "0 auto" }}>
      <section
        style={{
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "1.1rem",
          background: "var(--card-bg)",
          boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
        }}
      >
        <a className="logoLink" href="/" style={{ marginBottom: "0.85rem" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logoMark" src="/logo.svg" alt="Knowledge Platform" />
          <span className="logo" style={{ fontSize: "1.05rem" }}>
            Knowledge Platform
          </span>
        </a>
        <h1 style={{ margin: 0 }}>{title}</h1>
        {subtitle ? (
          <p style={{ color: "var(--muted)", fontSize: "0.92rem", lineHeight: 1.45, margin: "0.55rem 0 0" }}>
            {subtitle}
          </p>
        ) : null}
        <div style={{ marginTop: "1rem" }}>{children}</div>
        {footer ? <p style={{ marginTop: "1.25rem", marginBottom: 0 }}>{footer}</p> : null}
      </section>
    </main>
  );
}
