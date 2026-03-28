"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "../../lib/authClient";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type User = {
  id: string;
  email: string;
  name: string;
  phoneNumber: string | null;
  position: string | null;
  employeeBadgeNumber: string | null;
  profilePictureUrl: string | null;
  role: string;
  department: { id: string; name: string };
};

export default function ProfileClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<"loading" | "need-login" | "ready">("loading");
  const [user, setUser] = useState<User | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [position, setPosition] = useState("");
  const [employeeBadgeNumber, setEmployeeBadgeNumber] = useState("");
  const [profilePictureUrl, setProfilePictureUrl] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileOk, setProfileOk] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState<string | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("kp_access_token");
    if (!token) {
      router.replace("/login");
      setPhase("need-login");
      return;
    }
    void (async () => {
      const res = await fetchWithAuth(`${API}/auth/me`);
      if (res.status === 401) {
        clearStoredSession();
        router.replace("/login");
        setPhase("need-login");
        return;
      }
      if (!res.ok) {
        setPhase("ready");
        return;
      }
      const data = (await res.json()) as { user: User };
      setUser(data.user);
      setName(data.user.name);
      setEmail(data.user.email);
      setPhoneNumber(data.user.phoneNumber ?? "");
      setPosition(data.user.position ?? "");
      setEmployeeBadgeNumber(data.user.employeeBadgeNumber ?? "");
      setProfilePictureUrl(data.user.profilePictureUrl ?? "");
      setPhase("ready");
    })();
  }, [router]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileError(null);
    setProfileOk(null);
    const token = await getValidAccessToken();
    if (!token) return;
    setSavingProfile(true);
    try {
      const res = await fetchWithAuth(`${API}/auth/profile`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phoneNumber: phoneNumber.trim() || null,
          position: position.trim() || null,
          employeeBadgeNumber: employeeBadgeNumber.trim() || null,
          profilePictureUrl: profilePictureUrl.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        user?: User;
        token?: string;
        refreshToken?: string;
      };
      if (!res.ok) {
        setProfileError(data.error ?? "Could not save profile");
        return;
      }
      if (data.user) setUser(data.user);
      if (data.token) localStorage.setItem("kp_access_token", data.token);
      if (data.refreshToken) localStorage.setItem("kp_refresh_token", data.refreshToken);
      setProfileOk("Profile saved.");
    } catch {
      setProfileError("Could not reach the API.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwOk(null);
    if (newPassword !== confirmPassword) {
      setPwError("New passwords do not match.");
      return;
    }
    const token = await getValidAccessToken();
    if (!token) return;
    setSavingPw(true);
    try {
      const res = await fetchWithAuth(`${API}/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        token?: string;
        refreshToken?: string;
      };
      if (res.status === 200 && data.token) {
        localStorage.setItem("kp_access_token", data.token);
        if (data.refreshToken) localStorage.setItem("kp_refresh_token", data.refreshToken);
        setPwOk("Password updated.");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        return;
      }
      setPwError(data.error ?? "Could not change password");
    } catch {
      setPwError("Could not reach the API.");
    } finally {
      setSavingPw(false);
    }
  }

  if (phase === "loading" || phase === "need-login") {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main>
        <p>Could not load profile.</p>
        <Link href="/dashboard">Dashboard</Link>
      </main>
    );
  }

  const photoOk =
    user.profilePictureUrl &&
    (user.profilePictureUrl.startsWith("http://") || user.profilePictureUrl.startsWith("https://"));

  return (
    <main style={{ maxWidth: 520 }}>
      <h1>Profile</h1>
      <p style={{ color: "#52525b", fontSize: "0.9rem" }}>
        <strong>Role:</strong> {user.role} · <strong>Department:</strong> {user.department.name}
      </p>
      <p style={{ color: "#71717a", fontSize: "0.85rem", marginTop: "0.25rem" }}>
        User ID: <code style={{ fontSize: "0.8rem" }}>{user.id}</code> · Role and department are assigned by an
        administrator.
      </p>

      {photoOk ? (
        <div style={{ marginTop: "1rem" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={user.profilePictureUrl!}
            alt=""
            width={96}
            height={96}
            style={{ borderRadius: 8, objectFit: "cover", border: "1px solid #e4e4e7" }}
          />
        </div>
      ) : null}

      <section style={{ marginTop: "1.5rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Personal information</h2>
        <p style={{ color: "#71717a", fontSize: "0.85rem", marginTop: "0.35rem" }}>
          Update your contact details. Use an <strong>https</strong> link for the photo, or leave it blank.
        </p>
        <form onSubmit={(e) => void saveProfile(e)} style={{ display: "grid", gap: "0.65rem", marginTop: "0.75rem" }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span>Full name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
              style={{ padding: "0.5rem 0.6rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={{ padding: "0.5rem 0.6rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span>Phone (optional)</span>
            <input
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              autoComplete="tel"
              style={{ padding: "0.5rem 0.6rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span>Job title (optional)</span>
            <input
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              autoComplete="organization-title"
              style={{ padding: "0.5rem 0.6rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span>Employee badge number (optional)</span>
            <input
              value={employeeBadgeNumber}
              onChange={(e) => setEmployeeBadgeNumber(e.target.value)}
              maxLength={100}
              style={{ padding: "0.5rem 0.6rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span>Profile picture URL (optional)</span>
            <input
              type="url"
              value={profilePictureUrl}
              onChange={(e) => setProfilePictureUrl(e.target.value)}
              placeholder="https://example.com/photo.jpg"
              autoComplete="photo"
              style={{ padding: "0.5rem 0.6rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
            />
          </label>
          {profileError ? (
            <p role="alert" style={{ color: "var(--error)", margin: 0 }}>
              {profileError}
            </p>
          ) : null}
          {profileOk ? (
            <p role="status" style={{ color: "#15803d", margin: 0 }}>
              {profileOk}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={savingProfile}
            style={{
              padding: "0.55rem 1rem",
              borderRadius: 6,
              border: "none",
              background: "#18181b",
              color: "#fafafa",
              cursor: savingProfile ? "wait" : "pointer",
            }}
          >
            {savingProfile ? "Saving…" : "Save profile"}
          </button>
        </form>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Change password</h2>
        <form onSubmit={(e) => void savePassword(e)} style={{ display: "grid", gap: "0.65rem", marginTop: "0.75rem" }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span>Current password</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={{ padding: "0.5rem 0.6rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span>New password (min 8 characters)</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              style={{ padding: "0.5rem 0.6rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span>Confirm new password</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              style={{ padding: "0.5rem 0.6rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
            />
          </label>
          {pwError ? (
            <p role="alert" style={{ color: "var(--error)", margin: 0 }}>
              {pwError}
            </p>
          ) : null}
          {pwOk ? (
            <p role="status" style={{ color: "#15803d", margin: 0 }}>
              {pwOk}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={savingPw}
            style={{
              padding: "0.55rem 1rem",
              borderRadius: 6,
              border: "none",
              background: "#18181b",
              color: "#fafafa",
              cursor: savingPw ? "wait" : "pointer",
            }}
          >
            {savingPw ? "Updating…" : "Update password"}
          </button>
        </form>
      </section>

      <p style={{ marginTop: "1.5rem" }}>
        <Link href="/dashboard">Dashboard</Link>
        {" · "}
        <Link href="/documents">Home</Link>
      </p>
    </main>
  );
}
