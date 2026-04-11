"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UserAvatarNavButton } from "@/components/UserAvatarNavButton";
import { NotificationBell } from "@/components/NotificationBell";
import { ThemeToggleMenu } from "@/components/ThemeToggle";
import { signOut } from "@/lib/authClient";
import dash from "../components/shellNav.module.css";
import { API_BASE as API } from "@/lib/apiBase";

export type AdminChromeSessionUser = {
  /** Present when loaded from `/auth/me` (used by admin screens that compare acting user id). */
  id?: string;
  name: string;
  email: string;
  role: string;
  profilePictureUrl?: string | null;
};

type Props = {
  user: AdminChromeSessionUser;
  /** e.g. `${dash.navbar} ${styles.navbarRow}` */
  className?: string;
  /** Manager screens: profile, dashboard, documents only (no admin links). */
  navVariant?: "admin" | "manager";
};

export function AdminChromeHeader({ user, className, navVariant = "admin" }: Props) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

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

  return (
    <header className={className ?? dash.navbar}>
      <nav className={dash.navLeft} aria-label="Primary">
        <Link prefetch={false} className={dash.brand} href="/dashboard">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={`${dash.brandMark} kp-platform-logo`} src="/logo-swapped.svg" alt="Platform" />
        </Link>
      </nav>

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
            <Link prefetch={false} className={dash.menuItem} href="/dashboard" role="menuitem" onClick={() => setMenuOpen(false)}>
              Dashboard
            </Link>
            {navVariant === "manager" ? (
              <Link prefetch={false} className={dash.menuItem} href="/documents" role="menuitem" onClick={() => setMenuOpen(false)}>
                Documents
              </Link>
            ) : (
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
                <Link prefetch={false} className={dash.menuItem} href="/admin/documents" role="menuitem" onClick={() => setMenuOpen(false)}>
                  Document tools
                </Link>
                <Link prefetch={false} className={dash.menuItem} href="/admin/activity" role="menuitem" onClick={() => setMenuOpen(false)}>
                  Sign-in activity
                </Link>
                <Link prefetch={false} className={dash.menuItem} href="/admin/document-audit" role="menuitem" onClick={() => setMenuOpen(false)}>
                  Document audit
                </Link>
                <Link prefetch={false} className={dash.menuItem} href="/admin/system" role="menuitem" onClick={() => setMenuOpen(false)}>
                  System stats
                </Link>
              </>
            )}
            <ThemeToggleMenu />
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
  );
}
