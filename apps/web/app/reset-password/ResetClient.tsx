"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AuthCard from "../../components/AuthCard";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function ResetClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!token) {
      setError("Missing token. Open the link from your email.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setError(data.error ?? "Reset failed");
        return;
      }
      router.push("/login?reset=1");
    } catch {
      setError("Could not reach the API.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthCard
        title="Reset password"
        subtitle="Invalid or missing reset link. Request a new one from the forgot password page."
        footer={<Link href="/forgot-password">Forgot password</Link>}
      >
        <p style={{ color: "var(--error)", margin: 0, fontSize: "0.875rem" }}>This link may have expired or already been used.</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Set a new password"
      subtitle="Use at least 8 characters. You’ll be redirected to sign in when complete."
      footer={<Link href="/login">Sign in</Link>}
    >
      <form onSubmit={(e) => void onSubmit(e)} style={{ display: "grid", gap: "1rem" }}>
        <label style={{ display: "grid", gap: "0.3rem", fontSize: "0.8125rem", fontWeight: 600, color: "#475569" }}>
          <span>New password (min 8 characters)</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            style={{ padding: "0.6rem 0.75rem", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.9rem", font: "inherit" }}
          />
        </label>
        <label style={{ display: "grid", gap: "0.3rem", fontSize: "0.8125rem", fontWeight: 600, color: "#475569" }}>
          <span>Confirm password</span>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            style={{ padding: "0.6rem 0.75rem", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.9rem", font: "inherit" }}
          />
        </label>
        {error ? (
          <p role="alert" style={{ color: "var(--error)", margin: 0, fontSize: "0.875rem" }}>
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "0.65rem 1rem",
            borderRadius: 8,
            border: "none",
            background: "#1e293b",
            color: "#fff",
            fontSize: "0.9rem",
            fontWeight: 600,
            font: "inherit",
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Saving…" : "Update password"}
        </button>
      </form>
    </AuthCard>
  );
}
