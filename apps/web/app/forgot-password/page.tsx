"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setError(data.error ?? "Request failed");
        return;
      }
      setDone(true);
    } catch {
      setError("Could not reach the API.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.shell} data-auth-fullscreen="true">
      <section className={styles.frame}>
        <aside className={styles.left}>
          <a className={styles.brand} href="/dashboard">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.brandMark} src="/logo.svg" alt="Knowledge Platform" />
          </a>
          <div>
            <p className={styles.quote}>
              “Password recovery stays private and secure. If an account exists, we’ll send reset instructions without
              exposing account existence.”
            </p>
            <div className={styles.attribution}>— Platform security workflow</div>
          </div>
        </aside>

        <section className={styles.right}>
          <div className={styles.card}>
            <h1 className={styles.title}>Forgot password</h1>
            <p className={styles.subtitle}>Enter your email and we’ll send reset instructions if the account exists.</p>

            {done ? (
              <p role="status" className={styles.status}>
                If an account exists for that email, check your inbox for next steps.
              </p>
            ) : (
              <form onSubmit={(e) => void onSubmit(e)} className={styles.form}>
                <label className={styles.label}>
                  <span>Email</span>
                  <input
                    className={styles.input}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="name@example.com"
                  />
                </label>
                {error ? (
                  <p role="alert" className={styles.error}>
                    {error}
                  </p>
                ) : null}
                <button type="submit" disabled={loading} className={styles.primary}>
                  {loading ? "Sending…" : "Send reset link"}
                </button>
              </form>
            )}

            <p className={styles.footerLink}>
              <Link href="/login">Back to sign in</Link>
            </p>
          </div>
        </section>
      </section>
    </main>
  );
}
