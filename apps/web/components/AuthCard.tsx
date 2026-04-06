import type { ReactNode } from "react";

type AuthCardProps = {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
};

export default function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        background: "#f8f9fb",
        boxSizing: "border-box" as const,
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 440,
          border: "1px solid #e2e8f0",
          borderRadius: 14,
          padding: "2rem 1.75rem",
          background: "#fff",
          boxShadow: "0 1px 4px rgba(15,23,42,0.04)",
        }}
      >
        <a
          className="logoLink"
          href="/dashboard"
          style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", marginBottom: "1.25rem", textDecoration: "none" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logoMark" src="/logo.svg" alt="Knowledge Platform" />
        </a>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.03em" }}>{title}</h1>
        {subtitle ? (
          <p style={{ color: "#94a3b8", fontSize: "0.875rem", lineHeight: 1.5, margin: "0.4rem 0 0" }}>
            {subtitle}
          </p>
        ) : null}
        <div style={{ marginTop: "1.25rem" }}>{children}</div>
        {footer ? (
          <p style={{ marginTop: "1.25rem", marginBottom: 0, fontSize: "0.875rem" }}>{footer}</p>
        ) : null}
      </section>
    </main>
  );
}
