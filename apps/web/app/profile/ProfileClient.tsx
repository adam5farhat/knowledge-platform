"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NotificationBell } from "@/components/NotificationBell";
import { ProfileAvatarImage } from "@/components/ProfileAvatarImage";
import { ProfilePhotoModal } from "@/components/ProfilePhotoModal";
import { UserAvatarNavButton } from "@/components/UserAvatarNavButton";
import { profilePictureDisplayUrl, userInitialsFromName } from "@/lib/profilePicture";
import {
  clearStoredSession,
  fetchWithAuth,
  getValidAccessToken,
  setAccessToken,
  signOut,
  KP_AUTH_SESSION_REFRESHED,
} from "../../lib/authClient";
import {
  DEFAULT_USER_RESTRICTIONS,
  RoleNameApi,
  userCanOpenManagerDashboard,
  type MeUserDto,
} from "../../lib/restrictions";
import dash from "../components/shellNav.module.css";
import p from "./profile.module.css";
import { API_BASE as API } from "@/lib/apiBase";

type User = MeUserDto;

export default function ProfileClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<"loading" | "need-login" | "ready">("loading");
  const [user, setUser] = useState<User | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

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
  const [pwdUrlGate, setPwdUrlGate] = useState(false);
  const [photoModalOpen, setPhotoModalOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    setPwdUrlGate(q.get("pwd") === "1");
  }, []);

  useEffect(() => {
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
      if (!data.user.mustChangePassword) {
        setPwdUrlGate(false);
      }
      setName(data.user.name);
      setEmail(data.user.email);
      setPhoneNumber(data.user.phoneNumber ?? "");
      setPosition(data.user.position ?? "");
      setEmployeeBadgeNumber(data.user.employeeBadgeNumber ?? "");
      setProfilePictureUrl(data.user.profilePictureUrl ?? "");
      setPhase("ready");
    })();
  }, [router]);

  useEffect(() => {
    function onSessionRefreshed() {
      void (async () => {
        const t = await getValidAccessToken();
        if (!t) return;
        const res = await fetchWithAuth(`${API}/auth/me`);
        if (res.status === 401 || !res.ok) return;
        const data = (await res.json()) as { user: User };
        setUser(data.user);
        if (!data.user.mustChangePassword) {
          setPwdUrlGate(false);
        }
        setName(data.user.name);
        setEmail(data.user.email);
        setPhoneNumber(data.user.phoneNumber ?? "");
        setPosition(data.user.position ?? "");
        setEmployeeBadgeNumber(data.user.employeeBadgeNumber ?? "");
        setProfilePictureUrl(data.user.profilePictureUrl ?? "");
      })();
    }
    window.addEventListener(KP_AUTH_SESSION_REFRESHED, onSessionRefreshed);
    return () => window.removeEventListener(KP_AUTH_SESSION_REFRESHED, onSessionRefreshed);
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
    router.refresh();
  }

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
        headers: { "Content-Type": "application/json" },
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
      };
      if (!res.ok) {
        setProfileError(data.error ?? "Could not save profile");
        return;
      }
      if (data.user) setUser(data.user);
      if (data.token) setAccessToken(data.token);
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        token?: string;
        user?: User;
      };
      if (res.status === 200 && data.token) {
        setAccessToken(data.token);
        if (data.user) setUser(data.user);
        setPwdUrlGate(false);
        router.replace("/profile");
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
      <main className={p.shell} data-dashboard-fullscreen="true">
        <p style={{ padding: "1.25rem" }}>Loading…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className={p.shell} data-dashboard-fullscreen="true">
        <p style={{ padding: "1.25rem" }}>Could not load profile.</p>
        <Link prefetch={false} href="/dashboard">Dashboard</Link>
      </main>
    );
  }

  const showPwdBanner = pwdUrlGate || !!user.mustChangePassword;
  const isAdmin = user.role === RoleNameApi.ADMIN;
  const rs = user.restrictions ?? DEFAULT_USER_RESTRICTIONS;
  const showDashboardInMenu = rs.accessDashboardAllowed && userCanOpenManagerDashboard(user);
  const photoDisplaySrc = profilePictureDisplayUrl(user.profilePictureUrl);

  return (
    <main className={p.shell} data-dashboard-fullscreen="true">
      <header className={dash.navbar}>
        <nav className={dash.navLeft} aria-label="Primary">
          <a className={dash.brand} href="/dashboard">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={dash.brandMark} src="/logo-swapped.svg" alt="Platform" />
          </a>
        </nav>
        <div className={p.headerSpacer} aria-hidden />
        <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
          <NotificationBell />
          <div className={dash.profileWrap} ref={menuRef}>
          <UserAvatarNavButton
            className={dash.profileBtn}
            imgClassName={dash.profileBtnImg}
            pictureUrl={user.profilePictureUrl}
            name={user.name}
            email={user.email}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            title={`${user.name} (${user.role})`}
          />
          {menuOpen ? (
            <div className={dash.menu} role="menu">
              <div className={dash.menuHeader}>
                <div>{user.name}</div>
                <div>{user.email}</div>
              </div>
              <Link prefetch={false} className={dash.menuItem} href="/profile" role="menuitem" onClick={() => setMenuOpen(false)}>
                View Profile
              </Link>
              {showDashboardInMenu ? (
                <Link prefetch={false} className={dash.menuItem} href="/dashboard" role="menuitem" onClick={() => setMenuOpen(false)}>
                  Dashboard
                </Link>
              ) : null}
              {userCanOpenManagerDashboard(user) ? (
                <Link prefetch={false} className={dash.menuItem} href="/manager" role="menuitem" onClick={() => setMenuOpen(false)}>
                  Department overview
                </Link>
              ) : null}
              <Link prefetch={false} className={dash.menuItem} href="/documents" role="menuitem" onClick={() => setMenuOpen(false)}>
                Documents
              </Link>
              {isAdmin ? (
                <>
                  <Link prefetch={false} className={dash.menuItem} href="/admin" role="menuitem" onClick={() => setMenuOpen(false)}>
                    Admin hub
                  </Link>
                  <Link prefetch={false} className={dash.menuItem} href="/admin/users" role="menuitem" onClick={() => setMenuOpen(false)}>
                    Users
                  </Link>
                  <Link prefetch={false} className={dash.menuItem} href="/admin/departments" role="menuitem" onClick={() => setMenuOpen(false)}>
                    Departments
                  </Link>
                </>
              ) : null}
              <button
                type="button"
                className={dash.menuItem}
                onClick={() => {
                  setMenuOpen(false);
                  void handleSignOut();
                }}
                role="menuitem"
              >
                Logout
              </button>
            </div>
          ) : null}
          </div>
        </div>
      </header>

      <div className={p.content}>
        <h1 className={p.pageTitle}>Profile settings</h1>
        <p className={p.pageSub}>
          Update how you appear in the platform. Role and department are set by an administrator.
        </p>

        {showPwdBanner ? (
          <div className={p.banner} role="status">
            Your administrator requires you to change your password. Update it in Account management before using other
            parts of the app.
          </div>
        ) : null}

        <div className={p.grid}>
          <aside className={p.leftCol} aria-labelledby="account-mgmt-title">
            <h2 id="account-mgmt-title" className={p.leftTitle}>
              Account management
            </h2>
            <div className={p.photoPreview}>
              {photoDisplaySrc ? (
                <ProfileAvatarImage
                  className={p.photoPreviewImg}
                  src={photoDisplaySrc}
                  alt=""
                  width={400}
                  height={400}
                  sizes="(max-width: 320px) 100vw, 220px"
                />
              ) : (
                <span className={p.photoPreviewFallback} aria-hidden>
                  {userInitialsFromName(user.name)}
                </span>
              )}
            </div>
            <button
              type="button"
              className={p.photoModalTrigger}
              onClick={() => {
                setProfilePictureUrl(user.profilePictureUrl ?? "");
                setPhotoModalOpen(true);
              }}
            >
              Upload photo
            </button>
            <p className={p.photoHint}>Opens a window to drag-and-drop, browse, or paste an image URL.</p>

            <ProfilePhotoModal
              open={photoModalOpen}
              onClose={() => setPhotoModalOpen(false)}
              mode="self"
              displayName={user.name}
              pictureUrl={user.profilePictureUrl ?? null}
              pictureUrlDraft={profilePictureUrl}
              onPictureUrlDraftChange={setProfilePictureUrl}
              onPictureUpdated={(nextUrl) => {
                setUser((prev) => (prev ? { ...prev, profilePictureUrl: nextUrl } : null));
                setProfilePictureUrl(nextUrl ?? "");
              }}
            />

            <hr className={p.divider} />

            <h3 className={p.sideSectionTitle}>Password</h3>
            <form className={p.formSection} onSubmit={(e) => void savePassword(e)}>
              <div className={p.field}>
                <label className={p.label} htmlFor="profile-current-pw">
                  Current password
                </label>
                <input
                  id="profile-current-pw"
                  className={p.input}
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              <div className={p.field}>
                <label className={p.label} htmlFor="profile-new-pw">
                  New password
                </label>
                <input
                  id="profile-new-pw"
                  className={p.input}
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={10}
                  autoComplete="new-password"
                />
              </div>
              <div className={p.field}>
                <label className={p.label} htmlFor="profile-confirm-pw">
                  Confirm new password
                </label>
                <input
                  id="profile-confirm-pw"
                  className={p.input}
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={10}
                  autoComplete="new-password"
                />
              </div>
              {pwError ? (
                <p role="alert" className={p.error}>
                  {pwError}
                </p>
              ) : null}
              {pwOk ? (
                <p role="status" className={p.ok}>
                  {pwOk}
                </p>
              ) : null}
              <button type="submit" className={p.btnPrimary} disabled={savingPw}>
                {savingPw ? "Updating…" : "Change password"}
              </button>
            </form>
          </aside>

          <div className={p.rightCol}>
            <form onSubmit={(e) => void saveProfile(e)}>
              <section className={p.formSection} aria-labelledby="profile-info-heading">
                <h2 id="profile-info-heading" className={p.sectionHeading}>
                  Profile information
                </h2>
                <div className={p.fieldGrid}>
                  <div className={`${p.field} ${p.fieldFull}`}>
                    <label className={p.label} htmlFor="profile-name">
                      Full name
                    </label>
                    <input
                      id="profile-name"
                      className={p.input}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      autoComplete="name"
                    />
                  </div>
                  <div className={p.field}>
                    <span className={p.label}>Role</span>
                    <input className={`${p.input} ${p.inputReadonly}`} readOnly value={user.role} aria-readonly />
                  </div>
                  <div className={p.field}>
                    <span className={p.label}>Department</span>
                    <input className={`${p.input} ${p.inputReadonly}`} readOnly value={user.department.name} aria-readonly />
                  </div>
                  <div className={p.field}>
                    <label className={p.label} htmlFor="profile-badge">
                      Employee badge <span className={p.optional}>(optional)</span>
                    </label>
                    <input
                      id="profile-badge"
                      className={p.input}
                      value={employeeBadgeNumber}
                      onChange={(e) => setEmployeeBadgeNumber(e.target.value)}
                      maxLength={100}
                    />
                  </div>
                  <div className={p.field}>
                    <label className={p.label} htmlFor="profile-position">
                      Job title <span className={p.optional}>(optional)</span>
                    </label>
                    <input
                      id="profile-position"
                      className={p.input}
                      value={position}
                      onChange={(e) => setPosition(e.target.value)}
                      autoComplete="organization-title"
                    />
                  </div>
                </div>
              </section>

              <section className={p.formSection} aria-labelledby="contact-heading">
                <h2 id="contact-heading" className={p.sectionHeading}>
                  Contact
                </h2>
                <div className={p.fieldGrid}>
                  <div className={`${p.field} ${p.fieldFull}`}>
                    <label className={p.label} htmlFor="profile-email">
                      Email
                    </label>
                    <input
                      id="profile-email"
                      className={p.input}
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>
                  <div className={`${p.field} ${p.fieldFull}`}>
                    <label className={p.label} htmlFor="profile-phone">
                      Phone <span className={p.optional}>(optional)</span>
                    </label>
                    <input
                      id="profile-phone"
                      className={p.input}
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      autoComplete="tel"
                    />
                  </div>
                </div>
              </section>

              <div className={p.messages}>
                {profileError ? (
                  <p role="alert" className={p.error}>
                    {profileError}
                  </p>
                ) : null}
                {profileOk ? (
                  <p role="status" className={p.ok}>
                    {profileOk}
                  </p>
                ) : null}
              </div>

              <button type="submit" className={p.btnPrimary} disabled={savingProfile}>
                {savingProfile ? "Saving…" : "Save profile"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
