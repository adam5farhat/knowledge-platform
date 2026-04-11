"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchPublicApi, fetchWithAuth, getValidAccessToken, setAccessToken } from "@/lib/authClient";
import { homePathForUser, type MeUserDto } from "@/lib/restrictions";
import styles from "./page.module.css";
import { API_BASE as API } from "@/lib/apiBase";
import { ThemeToggleCorner } from "@/components/ThemeToggle";

export default function LoginClient() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [passwordResetOk, setPasswordResetOk] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("reset") === "1") setPasswordResetOk(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await getValidAccessToken();
      if (!token) return;
      const res = await fetchWithAuth(`${API}/auth/me`);
      if (!cancelled && res.ok) {
        const body = (await res.json().catch(() => null)) as { user: MeUserDto } | null;
        if (body?.user) {
          if (body.user.mustChangePassword) {
            router.replace("/profile?pwd=1");
          } else {
            router.replace(homePathForUser(body.user));
          }
        } else {
          router.replace("/dashboard");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetchPublicApi(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      let data: {
        error?: string;
        code?: string;
        supportContact?: string;
        token?: string;
        user?: MeUserDto;
      };
      try {
        data = (await res.json()) as typeof data;
      } catch {
        setError("Invalid response from server (is the API running?)");
        return;
      }
      if (!res.ok) {
        if (res.status === 403 && data.code === "ACCOUNT_RESTRICTED") {
          const msg = data.error ?? "Your account has been restricted.";
          const extra = data.supportContact ? `\n\n${data.supportContact}` : "";
          setError(`${msg}${extra}`);
          return;
        }
        setError(data.error ?? "Login failed");
        return;
      }
      if (data.token) {
        setAccessToken(data.token);
      }
      if (data.user) {
        if (data.user.mustChangePassword) {
          router.push("/profile?pwd=1");
        } else {
          router.push(homePathForUser(data.user));
        }
      } else {
        router.push("/dashboard");
      }
      router.refresh();
    } catch {
      setError("Could not reach the API");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.shell} data-auth-fullscreen="true" suppressHydrationWarning>
      <ThemeToggleCorner />
      <section className={styles.frame}>
        <aside className={styles.left}>
          <a className={styles.brand} href="/dashboard">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.brandMark} src="/logo.svg" alt="Knowledge Platform" />
          </a>

          <div>
            <p className={styles.quote}>
              &quot;Find answers across your organization&apos;s documents in seconds. Secure access, strong search
              foundations, and a clean user experience &mdash; built for teams.&quot;
            </p>
            <div className={styles.attribution}>&mdash; Platform demo environment</div>
          </div>
        </aside>

        <section className={styles.right}>
          <div className={styles.card}>
            <h1 className={styles.title}>Sign in</h1>
            <p className={styles.subtitle}>Use the account your administrator created for you.</p>

            {passwordResetOk ? <p className={styles.status}>Password updated successfully. Sign in below.</p> : null}

            <form onSubmit={onSubmit} className={styles.form}>
              <label className={styles.label}>
                <span>Email</span>
                <input
                  className={styles.input}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="name@example.com"
                  suppressHydrationWarning
                />
              </label>
              <label className={styles.label}>
                <span>Password</span>
                <input
                  className={styles.input}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  suppressHydrationWarning
                />
              </label>
              {error ? (
                <p role="alert" className={styles.error}>
                  {error}
                </p>
              ) : null}
              <button type="submit" disabled={loading} className={styles.primary} suppressHydrationWarning>
                {loading ? "Signing in..." : "Sign in"}
              </button>
            </form>

            <nav className={styles.footerLinks} aria-label="Help links">
              <Link href="/forgot-password">Forgot password?</Link>
            </nav>
          </div>
        </section>
      </section>
    </main>
  );
}
