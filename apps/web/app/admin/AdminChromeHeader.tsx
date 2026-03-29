"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UserAvatarNavButton } from "@/components/UserAvatarNavButton";
import { clearStoredSession } from "@/lib/authClient";
import dash from "../components/shellNav.module.css";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type AdminChromeSessionUser = {
  name: string;
  email: string;
  role: string;
  profilePictureUrl?: string | null;
};

type Props = {
  user: AdminChromeSessionUser;
  /** e.g. `${dash.navbar} ${styles.navbarRow}` */
  className?: string;
};

export function AdminChromeHeader({ user, className }: Props) {
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

  async function signOut() {
    const refreshToken = localStorage.getItem("kp_refresh_token");
    if (refreshToken) {
      try {
        await fetch(`${API}/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
      } catch {
        /* best-effort */
      }
    }
    clearStoredSession();
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className={className ?? dash.navbar}>
      <nav className={dash.navLeft} aria-label="Primary">
        <a className={dash.brand} href="/dashboard">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={dash.brandMark} src="/logo-swapped.svg" alt="Platform" />
        </a>
      </nav>

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
            <Link className={dash.menuItem} href="/profile" role="menuitem" onClick={() => setMenuOpen(false)}>
              View Profile
            </Link>
            <Link className={dash.menuItem} href="/dashboard" role="menuitem" onClick={() => setMenuOpen(false)}>
              Dashboard
            </Link>
            <Link className={dash.menuItem} href="/admin" role="menuitem" onClick={() => setMenuOpen(false)}>
              Admin hub
            </Link>
            <Link className={dash.menuItem} href="/admin/users" role="menuitem" onClick={() => setMenuOpen(false)}>
              Users
            </Link>
            <Link className={dash.menuItem} href="/admin/departments" role="menuitem" onClick={() => setMenuOpen(false)}>
              Departments
            </Link>
            <Link className={dash.menuItem} href="/admin/documents" role="menuitem" onClick={() => setMenuOpen(false)}>
              Document tools
            </Link>
            <Link className={dash.menuItem} href="/admin/activity" role="menuitem" onClick={() => setMenuOpen(false)}>
              Sign-in activity
            </Link>
            <Link className={dash.menuItem} href="/admin/document-audit" role="menuitem" onClick={() => setMenuOpen(false)}>
              Document audit
            </Link>
            <Link className={dash.menuItem} href="/admin/system" role="menuitem" onClick={() => setMenuOpen(false)}>
              System stats
            </Link>
            <button
              type="button"
              className={dash.menuItem}
              onClick={() => {
                setMenuOpen(false);
                void signOut();
              }}
              role="menuitem"
            >
              Logout
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
