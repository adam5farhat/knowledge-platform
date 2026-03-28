"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "../../../lib/authClient";
import { AdminHubGlyph, type AdminHubGlyphType } from "../AdminHubIcons";
import dash from "../../components/shellNav.module.css";
import styles from "./adminUsers.module.css";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function IconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.25" />
      <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

function IconFilter() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 6h16M7 12h10M10 18h4"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconExport() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 4v10m0 0 3.5-3.5M12 14 8.5 10.5M5 18h14"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconMore() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="5" cy="12" r="1.35" fill="currentColor" />
      <circle cx="12" cy="12" r="1.35" fill="currentColor" />
      <circle cx="19" cy="12" r="1.35" fill="currentColor" />
    </svg>
  );
}

function IconChevronRight() {
  return (
    <svg className={styles.profileMenuChevron} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M10 7l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconProfileLock() {
  return (
    <svg className={styles.profileMenuIcon} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.35" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

function IconProfileUnlock() {
  return (
    <svg className={styles.profileMenuIcon} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.35" />
      <path d="M8 11V8a4 4 0 0 1 7.5-1" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

function IconProfileKey() {
  return (
    <svg className={styles.profileMenuIcon} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.35" />
      <path d="M10.5 10.5L21 21M15 16l2 2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconProfileTrash() {
  return (
    <svg className={styles.profileMenuIconDanger} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconProfileBack() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function adminNavActive(href: string, pathname: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

const ADMIN_SIDEBAR_LINKS: { href: string; label: string; icon: AdminHubGlyphType }[] = [
  { href: "/admin", label: "Hub", icon: "hub" },
  { href: "/admin/users", label: "Users", icon: "users" },
  { href: "/admin/departments", label: "Departments", icon: "departments" },
  { href: "/admin/documents", label: "Documents", icon: "documents" },
  { href: "/admin/activity", label: "Activity", icon: "activity" },
  { href: "/admin/document-audit", label: "Doc audit", icon: "audit" },
  { href: "/admin/system", label: "System", icon: "system" },
];

type RoleOption = { id: string; name: string; description: string | null };
type DeptOption = { id: string; name: string; parentDepartmentId?: string | null };

type AdminUserRow = {
  id: string;
  email: string;
  name: string;
  employeeBadgeNumber: string | null;
  phoneNumber: string | null;
  position: string | null;
  profilePictureUrl: string | null;
  isActive: boolean;
  role: string;
  department: { id: string; name: string };
  failedLoginAttempts: number;
  loginLockedUntil: string | null;
  createdAt: string;
};

type Phase = "checking" | "need-login" | "forbidden" | "load-error" | "ready";

type SessionUser = { id: string; name: string; email: string; role: string };

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "—";
  }
}

function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default function AdminUsersClient() {
  const router = useRouter();
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>("checking");
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [departments, setDepartments] = useState<DeptOption[]>([]);

  const [listPage, setListPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);
  const [listPageSize] = useState(25);
  const [userSearch, setUserSearch] = useState("");
  const [userQ, setUserQ] = useState("");
  const [filterDepartmentId, setFilterDepartmentId] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [filterActive, setFilterActive] = useState("");
  const [directoryUsers, setDirectoryUsers] = useState<AdminUserRow[]>([]);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [directoryLoading, setDirectoryLoading] = useState(false);

  const [editUser, setEditUser] = useState<AdminUserRow | null>(null);
  const [passwordUserId, setPasswordUserId] = useState<string | null>(null);
  const [passwordValue, setPasswordValue] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalBusy, setModalBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [roleName, setRoleName] = useState("EMPLOYEE");
  const [departmentId, setDepartmentId] = useState("");
  const [employeeBadgeNumber, setEmployeeBadgeNumber] = useState("");
  const [position, setPosition] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const filterWrapRef = useRef<HTMLDivElement | null>(null);
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);
  const rowMenuBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [rowMenuUserId, setRowMenuUserId] = useState<string | null>(null);
  const [rowMenuBox, setRowMenuBox] = useState<{ top: number; left: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [panelUser, setPanelUser] = useState<AdminUserRow | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setUserQ(userSearch.trim());
    }, 350);
    return () => window.clearTimeout(id);
  }, [userSearch]);

  useEffect(() => {
    setListPage(1);
  }, [userQ, filterDepartmentId, filterRole, filterActive]);

  useLayoutEffect(() => {
    if (!rowMenuUserId) {
      setRowMenuBox(null);
      return;
    }
    const openForUserId = rowMenuUserId;
    const menuW = 168;
    function updatePosition() {
      const btn = rowMenuBtnRefs.current.get(openForUserId);
      if (!btn) {
        setRowMenuBox(null);
        return;
      }
      const rect = btn.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.right - menuW, window.innerWidth - menuW - 8));
      setRowMenuBox({ top: rect.bottom + 4, left });
    }
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [rowMenuUserId]);

  const loadDirectory = useCallback(async () => {
    setDirectoryError(null);
    setDirectoryLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(listPage));
      params.set("pageSize", String(listPageSize));
      if (userQ.trim()) params.set("q", userQ.trim());
      if (filterDepartmentId) params.set("departmentId", filterDepartmentId);
      if (filterRole) params.set("role", filterRole);
      if (filterActive === "true" || filterActive === "false") params.set("isActive", filterActive);
      const res = await fetchWithAuth(`${API}/admin/users?${params.toString()}`);
      if (!res.ok) {
        setDirectoryError("Could not load users.");
        return;
      }
      const data = (await res.json()) as {
        users?: AdminUserRow[];
        total?: number;
        page?: number;
      };
      setDirectoryUsers(Array.isArray(data.users) ? data.users : []);
      setListTotal(data.total ?? 0);
    } catch {
      setDirectoryError("Could not load users.");
    } finally {
      setDirectoryLoading(false);
    }
  }, [listPage, listPageSize, userQ, filterDepartmentId, filterRole, filterActive]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const t = await getValidAccessToken();
      if (!t) {
        if (!cancelled) {
          setPhase("need-login");
          router.replace("/login");
        }
        return;
      }

      try {
        const meRes = await fetchWithAuth(`${API}/auth/me`);
        if (meRes.status === 401) {
          clearStoredSession();
          if (!cancelled) {
            setPhase("need-login");
            router.replace("/login");
          }
          return;
        }

        let me: { user?: { id: string; role: string; name?: string; email?: string } };
        try {
          me = (await meRes.json()) as { user?: { id: string; role: string; name?: string; email?: string } };
        } catch {
          if (!cancelled) setPhase("load-error");
          return;
        }

        if (!meRes.ok || me.user?.role !== "ADMIN") {
          if (!cancelled) setPhase("forbidden");
          return;
        }

        if (!cancelled) {
          setSessionUser({
            id: me.user?.id ?? "",
            name: me.user?.name ?? "",
            email: me.user?.email ?? "",
            role: me.user?.role ?? "ADMIN",
          });
        }

        const [dr, rr] = await Promise.all([
          fetchWithAuth(`${API}/admin/departments`),
          fetchWithAuth(`${API}/admin/roles`),
        ]);

        if (!dr.ok || !rr.ok) {
          if (!cancelled) setPhase("load-error");
          return;
        }

        let dJson: { departments: DeptOption[] };
        let rJson: { roles: RoleOption[] };
        try {
          dJson = (await dr.json()) as { departments: DeptOption[] };
          rJson = (await rr.json()) as { roles: RoleOption[] };
        } catch {
          if (!cancelled) setPhase("load-error");
          return;
        }

        if (!cancelled) {
          setDepartments(dJson.departments);
          setRoles(rJson.roles);
          if (dJson.departments.length > 0 && !departmentId) {
            setDepartmentId(dJson.departments[0].id);
          }
          setPhase("ready");
        }
      } catch {
        if (!cancelled) setPhase("load-error");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "ready") return;
    void loadDirectory();
  }, [phase, loadDirectory]);

  useEffect(() => {
    setPanelUser((prev) => {
      if (!prev) return null;
      const fresh = directoryUsers.find((x) => x.id === prev.id);
      return fresh ?? null;
    });
  }, [directoryUsers]);

  useEffect(() => {
    if (!panelUser) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPanelUser(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelUser]);

  const totalListPages = Math.max(1, Math.ceil(listTotal / listPageSize));

  async function onSubmitCreate(e: React.FormEvent) {
    e.preventDefault();
    const authToken = await getValidAccessToken();
    if (!authToken) {
      setSubmitError("Not signed in. Please sign in again.");
      setPhase("need-login");
      router.replace("/login");
      return;
    }
    setSubmitError(null);
    setSuccess(null);
    if (roleName === "EMPLOYEE" && !employeeBadgeNumber.trim()) {
      setSubmitError("Employee badge is required when role is EMPLOYEE.");
      return;
    }
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        email,
        password,
        name,
        role: roleName,
        departmentId,
      };
      if (employeeBadgeNumber.trim()) body.employeeBadgeNumber = employeeBadgeNumber.trim();
      if (position.trim()) body.position = position.trim();

      const res = await fetchWithAuth(`${API}/admin/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      let data: { error?: string };
      try {
        data = (await res.json()) as { error?: string };
      } catch {
        setSubmitError("Invalid response from server");
        return;
      }
      if (!res.ok) {
        setSubmitError(data.error ?? "Could not create user");
        return;
      }
      setSuccess("User created. They can sign in with the email and password you set.");
      setEmail("");
      setPassword("");
      setName("");
      setEmployeeBadgeNumber("");
      setPosition("");
      void loadDirectory();
    } catch {
      setSubmitError("Could not reach the API");
    } finally {
      setLoading(false);
    }
  }

  async function saveEdit() {
    if (!editUser) return;
    setModalError(null);
    setModalBusy(true);
    try {
      const body: Record<string, unknown> = {
        email: editUser.email,
        name: editUser.name,
        role: editUser.role,
        departmentId: editUser.department.id,
        employeeBadgeNumber: editUser.employeeBadgeNumber,
        phoneNumber: editUser.phoneNumber,
        position: editUser.position,
        isActive: editUser.isActive,
      };
      const res = await fetchWithAuth(`${API}/admin/users/${editUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setModalError(data.error ?? "Update failed.");
        return;
      }
      setEditUser(null);
      void loadDirectory();
    } catch {
      setModalError("Could not reach the API.");
    } finally {
      setModalBusy(false);
    }
  }

  async function submitPassword() {
    if (!passwordUserId) return;
    if (passwordValue.length < 8) {
      setModalError("Password must be at least 8 characters.");
      return;
    }
    setModalError(null);
    setModalBusy(true);
    try {
      const res = await fetchWithAuth(`${API}/admin/users/${passwordUserId}/set-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordValue }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setModalError(data.error ?? "Could not set password.");
        return;
      }
      setPasswordUserId(null);
      setPasswordValue("");
    } catch {
      setModalError("Could not reach the API.");
    } finally {
      setModalBusy(false);
    }
  }

  async function unlockUser(id: string) {
    const res = await fetchWithAuth(`${API}/admin/users/${id}/unlock`, { method: "POST" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      window.alert(data.error ?? "Unlock failed.");
      return;
    }
    void loadDirectory();
  }

  async function lockUser(id: string) {
    const res = await fetchWithAuth(`${API}/admin/users/${id}/lock`, { method: "POST" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      window.alert(data.error ?? "Lock failed.");
      return;
    }
    void loadDirectory();
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function bulkLockSelected() {
    const ids = [...selectedIds].filter((id) => id !== sessionUser?.id);
    if (ids.length === 0) {
      window.alert("Remove your own account from the selection to lock others.");
      return;
    }
    if (
      !window.confirm(
        `Lock sign-in for ${ids.length} user(s)? They cannot log in until you unlock them or the lock period ends (7 days).`,
      )
    ) {
      return;
    }
    setBulkBusy(true);
    let fail = 0;
    for (const id of ids) {
      const res = await fetchWithAuth(`${API}/admin/users/${id}/lock`, { method: "POST" });
      if (!res.ok) fail++;
    }
    setBulkBusy(false);
    setSelectedIds(new Set());
    void loadDirectory();
    if (fail) window.alert(`${fail} lock operation(s) failed.`);
  }

  async function bulkDeleteSelected() {
    const ids = [...selectedIds].filter((id) => id !== sessionUser?.id);
    if (ids.length === 0) {
      window.alert("You cannot delete only your own account from this bulk action.");
      return;
    }
    if (!window.confirm(`Permanently delete ${ids.length} user(s)? This cannot be undone.`)) return;
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    const removed = new Set(ids);
    for (const id of ids) {
      const res = await fetchWithAuth(`${API}/admin/users/${id}`, { method: "DELETE" });
      if (res.status === 204) ok++;
      else fail++;
    }
    setBulkBusy(false);
    setSelectedIds(new Set());
    setPanelUser((p) => (p && removed.has(p.id) ? null : p));
    void loadDirectory();
    if (fail) window.alert(`Removed ${ok}. ${fail} could not be deleted (e.g. last admin).`);
  }

  async function deleteUser(u: AdminUserRow) {
    if (!window.confirm(`Permanently delete ${u.email}? This cannot be undone.`)) return;
    const res = await fetchWithAuth(`${API}/admin/users/${u.id}`, { method: "DELETE" });
    if (res.status === 204) {
      void loadDirectory();
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    window.alert(data.error ?? "Delete failed.");
  }

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

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const el = e.target as HTMLElement | null;
      if (menuRef.current?.contains(el as Node)) return;
      if (filterWrapRef.current?.contains(el as Node)) return;
      if (el?.closest("[data-admin-users-row-menu]")) return;
      setMenuOpen(false);
      setFiltersOpen(false);
      setRowMenuUserId(null);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function toggleSelectAllOnPage() {
    const ids = directoryUsers.map((u) => u.id);
    const allOn = ids.length > 0 && ids.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (allOn) ids.forEach((id) => n.delete(id));
      else ids.forEach((id) => n.add(id));
      return n;
    });
  }

  function exportCsv() {
    const rows =
      selectedIds.size > 0 ? directoryUsers.filter((u) => selectedIds.has(u.id)) : directoryUsers;
    const esc = (s: string | null | undefined) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const header = ["Name", "Email", "Role", "Department", "Status", "Phone", "Badge", "Position"];
    const lines = [header.join(",")];
    for (const u of rows) {
      lines.push(
        [
          esc(u.name),
          esc(u.email),
          esc(u.role),
          esc(u.department.name),
          esc(u.isActive ? "Active" : "Inactive"),
          esc(u.phoneNumber),
          esc(u.employeeBadgeNumber),
          esc(u.position),
        ].join(","),
      );
    }
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `users-page-${listPage}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const pageAllSelected = directoryUsers.length > 0 && directoryUsers.every((u) => selectedIds.has(u.id));
  const pageSomeSelected = directoryUsers.some((u) => selectedIds.has(u.id));

  useEffect(() => {
    const el = headerCheckboxRef.current;
    if (el) el.indeterminate = pageSomeSelected && !pageAllSelected;
  }, [pageSomeSelected, pageAllSelected]);

  if (phase === "checking") {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }

  if (phase === "need-login") {
    return (
      <main style={{ maxWidth: 480 }}>
        <h1>Users</h1>
        <p style={{ color: "#52525b" }}>You need to sign in to access this page.</p>
        <p style={{ marginTop: "1rem" }}>
          <Link href="/login">Sign in</Link>
          {" · "}
          <Link href="/documents">Home</Link>
        </p>
      </main>
    );
  }

  if (phase === "load-error") {
    return (
      <main>
        <p style={{ color: "var(--error)" }}>Could not load departments or roles.</p>
        <Link href="/dashboard">Dashboard</Link>
      </main>
    );
  }

  if (phase === "forbidden") {
    return (
      <main style={{ maxWidth: 480 }}>
        <h1>Users</h1>
        <p style={{ color: "var(--error)" }}>Only administrators can manage users.</p>
        <p>
          <Link href="/dashboard">Dashboard</Link>
          {" · "}
          <Link href="/documents">Home</Link>
        </p>
      </main>
    );
  }

  if (!sessionUser) {
    return (
      <main className={styles.shell}>
        <p style={{ padding: "1rem" }}>Loading…</p>
      </main>
    );
  }

  const nameParts = sessionUser.name.trim().split(/\s+/);
  const navInitials = ((nameParts[0]?.[0] ?? "A") + (nameParts[1]?.[0] ?? "")).toUpperCase();

  return (
    <main className={styles.shell} data-dashboard-fullscreen="true">
      <header className={`${dash.navbar} ${styles.navbarRow}`}>
        <nav className={dash.navLeft} aria-label="Primary">
          <a className={dash.brand} href="/dashboard">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={dash.brandMark} src="/logo-swapped.svg" alt="Platform" />
          </a>
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/documents">Documents</Link>
        </nav>

        <div className={dash.profileWrap} ref={menuRef}>
          <button
            type="button"
            className={dash.profileBtn}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            title={`${sessionUser.name} (${sessionUser.role})`}
          >
            {navInitials}
          </button>
          {menuOpen ? (
            <div className={dash.menu} role="menu">
              <div className={dash.menuHeader}>
                <div>{sessionUser.name}</div>
                <div>{sessionUser.email}</div>
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

      <div className={styles.adminBody}>
        <aside className={styles.adminSidebar} aria-label="Admin sections">
          {ADMIN_SIDEBAR_LINKS.map(({ href, label, icon }) => {
            const active = adminNavActive(href, pathname ?? "");
            return (
              <Link
                key={href}
                href={href}
                className={active ? `${styles.sidebarLink} ${styles.sidebarLinkActive}` : styles.sidebarLink}
                aria-current={active ? "page" : undefined}
              >
                <AdminHubGlyph type={icon} className={styles.sidebarIcon} />
                <span className={styles.sidebarLabel}>{label}</span>
              </Link>
            );
          })}
        </aside>

        <div className={styles.main}>
        <div className={styles.pageHead}>
          <div>
            <h1 className={styles.pageTitle}>Users</h1>
            <p className={styles.pageSubtitle}>Directory, sign-in lock state, and provisioning new accounts.</p>
          </div>
          <button
            type="button"
            className={styles.addButton}
            onClick={() => {
              setSubmitError(null);
              setSuccess(null);
              setCreateOpen(true);
            }}
          >
            <IconPlus />
            Add new user
          </button>
        </div>

        <div className={styles.tableCard}>
          <div className={styles.cardToolbar}>
            <h2 className={styles.cardToolbarTitle}>User list</h2>
            <div className={styles.toolbarRight}>
              <div className={styles.toolbarSearch}>
                <IconSearch />
                <input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Filter list…"
                  aria-label="Filter user list"
                />
              </div>
              <div className={styles.filterWrap} ref={filterWrapRef}>
                <button
                  type="button"
                  className={styles.filterToggle}
                  aria-expanded={filtersOpen}
                  aria-haspopup="true"
                  aria-label="Open table filters"
                  onClick={() => setFiltersOpen((v) => !v)}
                >
                  <IconFilter />
                  <span>Filter</span>
                </button>
                {filtersOpen ? (
                  <div className={styles.filterPopover} role="group" aria-label="Table filters">
                    <label>
                      Department
                      <select
                        value={filterDepartmentId}
                        onChange={(e) => setFilterDepartmentId(e.target.value)}
                      >
                        <option value="">All departments</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Role
                      <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)}>
                        <option value="">All roles</option>
                        {roles.map((r) => (
                          <option key={r.id} value={r.name}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Status
                      <select value={filterActive} onChange={(e) => setFilterActive(e.target.value)}>
                        <option value="">Active + inactive</option>
                        <option value="true">Active only</option>
                        <option value="false">Inactive only</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className={styles.btnGhost}
                      style={{ justifySelf: "start" }}
                      onClick={() => void loadDirectory()}
                    >
                      Refresh data
                    </button>
                  </div>
                ) : null}
              </div>
              <button type="button" className={styles.iconButton} title="Export CSV" onClick={() => exportCsv()}>
                <IconExport />
              </button>
            </div>
          </div>

          {selectedIds.size > 0 ? (
            <div className={styles.bulkBar}>
              <span className={styles.bulkBarCount}>{selectedIds.size} selected</span>
              <button
                type="button"
                className={styles.btnGhost}
                disabled={bulkBusy}
                onClick={() => void bulkLockSelected()}
              >
                Lock sign-in
              </button>
              <button
                type="button"
                className={styles.btnDanger}
                disabled={bulkBusy}
                onClick={() => void bulkDeleteSelected()}
              >
                Delete selected
              </button>
              <button type="button" className={styles.btnGhost} disabled={bulkBusy} onClick={clearSelection}>
                Clear selection
              </button>
            </div>
          ) : null}

          {directoryError ? (
            <p role="alert" style={{ color: "var(--error)", padding: "0 1.1rem" }}>
              {directoryError}
            </p>
          ) : null}

          <div className={styles.tableScroll}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th className={styles.checkboxTh} scope="col">
                    <input
                      ref={headerCheckboxRef}
                      type="checkbox"
                      checked={pageAllSelected}
                      onChange={() => toggleSelectAllOnPage()}
                      aria-label="Select all on this page"
                    />
                  </th>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Department</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Lock</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {directoryLoading ? (
                  <tr>
                    <td colSpan={9} className={styles.cellMuted} style={{ padding: "1.25rem" }}>
                      Loading…
                    </td>
                  </tr>
                ) : null}
                {!directoryLoading && directoryUsers.length === 0 ? (
                  <tr>
                    <td colSpan={9} className={styles.cellMuted} style={{ padding: "1.25rem" }}>
                      No users match your filters.
                    </td>
                  </tr>
                ) : null}
                {!directoryLoading &&
                  directoryUsers.map((u) => {
                    const initials = userInitials(u.name);
                    const photoOk =
                      u.profilePictureUrl &&
                      (u.profilePictureUrl.startsWith("http://") || u.profilePictureUrl.startsWith("https://"));
                    return (
                      <tr
                        key={u.id}
                        className={`${styles.clickableRow}${selectedIds.has(u.id) ? ` ${styles.rowSelected}` : ""}`}
                        onClick={(e) => {
                          const el = e.target as HTMLElement;
                          if (el.closest("input, button, [role='menu'], [data-admin-users-row-menu]")) return;
                          setRowMenuUserId(null);
                          setPanelUser(u);
                        }}
                      >
                        <td className={styles.checkboxCell} onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(u.id)}
                            onChange={() => toggleSelected(u.id)}
                            aria-label={`Select ${u.name}`}
                          />
                        </td>
                        <td>
                          <div className={styles.userCell}>
                            {photoOk ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img className={styles.avatar} src={u.profilePictureUrl!} alt="" width={36} height={36} />
                            ) : (
                              <span className={styles.avatarFallback} aria-hidden>
                                {initials}
                              </span>
                            )}
                            <span>{u.name}</span>
                          </div>
                        </td>
                        <td>{u.email}</td>
                        <td className={styles.cellMuted}>{u.phoneNumber ?? "—"}</td>
                        <td>{u.department.name}</td>
                        <td>{u.role}</td>
                        <td>{u.isActive ? "Active" : "Inactive"}</td>
                        <td className={styles.cellMuted}>
                          {u.loginLockedUntil || u.failedLoginAttempts > 0 ? (
                            <span style={{ color: "#b45309" }} title={u.loginLockedUntil ?? undefined}>
                              {u.failedLoginAttempts > 0 ? `${u.failedLoginAttempts} fails` : "Locked"}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className={styles.rowMenuWrap} data-admin-users-row-menu>
                            <button
                              type="button"
                              ref={(el) => {
                                const m = rowMenuBtnRefs.current;
                                if (el) m.set(u.id, el);
                                else m.delete(u.id);
                              }}
                              className={styles.rowMenuBtn}
                              aria-expanded={rowMenuUserId === u.id}
                              aria-haspopup="menu"
                              aria-label={`Actions for ${u.name}`}
                              onClick={() => setRowMenuUserId((id) => (id === u.id ? null : u.id))}
                            >
                              <IconMore />
                            </button>
                            {rowMenuUserId === u.id && rowMenuBox ? (
                              <div
                                className={styles.rowMenuFixed}
                                style={{ top: rowMenuBox.top, left: rowMenuBox.left, minWidth: 168 }}
                                role="menu"
                              >
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setRowMenuUserId(null);
                                    setModalError(null);
                                    setEditUser({ ...u });
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setRowMenuUserId(null);
                                    void unlockUser(u.id);
                                  }}
                                >
                                  Unlock
                                </button>
                                {u.id !== sessionUser.id ? (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      setRowMenuUserId(null);
                                      void lockUser(u.id);
                                    }}
                                  >
                                    Lock sign-in
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setRowMenuUserId(null);
                                    setModalError(null);
                                    setPasswordValue("");
                                    setPasswordUserId(u.id);
                                  }}
                                >
                                  Set password
                                </button>
                                {u.id !== sessionUser.id ? (
                                  <button
                                    type="button"
                                    className={styles.rowMenuDanger}
                                    role="menuitem"
                                    onClick={() => {
                                      setRowMenuUserId(null);
                                      void deleteUser(u);
                                    }}
                                  >
                                    Delete
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          <div className={styles.paginationBar}>
            <button type="button" disabled={listPage <= 1} onClick={() => setListPage((p) => Math.max(1, p - 1))}>
              Previous
            </button>
            <span>
              Page {listPage} of {totalListPages} ({listTotal} users)
            </span>
            <button type="button" disabled={listPage >= totalListPages} onClick={() => setListPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </div>
        </div>
      </div>

      {panelUser ? (
        <>
          <div className={styles.detailBackdrop} aria-hidden onClick={() => setPanelUser(null)} />
          <div
            className={styles.detailPanel}
            role="dialog"
            aria-modal={true}
            aria-labelledby="user-detail-title"
          >
            <div className={styles.detailPanelInner}>
              <header className={styles.profileTopBar}>
                <button
                  type="button"
                  className={styles.profileBackBtn}
                  aria-label="Close profile"
                  onClick={() => setPanelUser(null)}
                >
                  <IconProfileBack />
                </button>
                <h2 id="user-detail-title" className={styles.profileTopTitle}>
                  Profile
                </h2>
                <span className={styles.profileTopSpacer} aria-hidden />
              </header>

              <div className={styles.profileHero}>
                <div className={styles.profileAvatarRing}>
                  {panelUser.profilePictureUrl &&
                  (panelUser.profilePictureUrl.startsWith("http://") ||
                    panelUser.profilePictureUrl.startsWith("https://")) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className={styles.profileAvatarImg}
                      src={panelUser.profilePictureUrl}
                      alt=""
                      width={88}
                      height={88}
                    />
                  ) : (
                    <span className={styles.profileAvatarFallback} aria-hidden>
                      {userInitials(panelUser.name)}
                    </span>
                  )}
                </div>
                <h3 className={styles.profileName}>{panelUser.name}</h3>
                <p className={styles.profileEmail}>{panelUser.email}</p>
                <p className={styles.profileJoined}>Joined {fmtDateTime(panelUser.createdAt)}</p>
                <button
                  type="button"
                  className={styles.profileEditCta}
                  onClick={() => {
                    setPanelUser(null);
                    setModalError(null);
                    setEditUser({ ...panelUser });
                  }}
                >
                  Edit profile
                </button>
              </div>

              <div className={styles.profileFieldsCard}>
                <div className={styles.profileField}>
                  <span className={styles.profileFieldLabel}>Department</span>
                  <div className={styles.profileFieldBox}>{panelUser.department.name}</div>
                </div>
                <div className={styles.profileField}>
                  <span className={styles.profileFieldLabel}>Role</span>
                  <div className={styles.profileFieldBox}>{panelUser.role}</div>
                </div>
                <div className={styles.profileField}>
                  <span className={styles.profileFieldLabel}>Phone</span>
                  <div className={styles.profileFieldBox}>{panelUser.phoneNumber ?? "—"}</div>
                </div>
                <div className={styles.profileField}>
                  <span className={styles.profileFieldLabel}>Status</span>
                  <div className={styles.profileFieldBox}>{panelUser.isActive ? "Active" : "Inactive"}</div>
                </div>
                <div className={styles.profileField}>
                  <span className={styles.profileFieldLabel}>Employee badge</span>
                  <div className={styles.profileFieldBox}>{panelUser.employeeBadgeNumber ?? "—"}</div>
                </div>
                <div className={styles.profileField}>
                  <span className={styles.profileFieldLabel}>Job title</span>
                  <div className={styles.profileFieldBox}>{panelUser.position ?? "—"}</div>
                </div>
                <div className={styles.profileField}>
                  <span className={styles.profileFieldLabel}>Sign-in lock</span>
                  <div className={styles.profileFieldBox}>
                    {panelUser.loginLockedUntil || panelUser.failedLoginAttempts > 0
                      ? `${panelUser.failedLoginAttempts > 0 ? `${panelUser.failedLoginAttempts} failed attempts` : "Locked"}${panelUser.loginLockedUntil ? ` · until ${fmtDateTime(panelUser.loginLockedUntil)}` : ""}`
                      : "Not locked"}
                  </div>
                </div>
              </div>

              <ul className={styles.profileMenu} role="list">
                {panelUser.id !== sessionUser.id ? (
                  <li>
                    <button type="button" className={styles.profileMenuItem} onClick={() => void lockUser(panelUser.id)}>
                      <IconProfileLock />
                      <span className={styles.profileMenuLabel}>Lock sign-in (7 days)</span>
                      <IconChevronRight />
                    </button>
                  </li>
                ) : null}
                <li>
                  <button type="button" className={styles.profileMenuItem} onClick={() => void unlockUser(panelUser.id)}>
                    <IconProfileUnlock />
                    <span className={styles.profileMenuLabel}>Unlock sign-in</span>
                    <IconChevronRight />
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className={styles.profileMenuItem}
                    onClick={() => {
                      setPanelUser(null);
                      setModalError(null);
                      setPasswordValue("");
                      setPasswordUserId(panelUser.id);
                    }}
                  >
                    <IconProfileKey />
                    <span className={styles.profileMenuLabel}>Set password</span>
                    <IconChevronRight />
                  </button>
                </li>
                {panelUser.id !== sessionUser.id ? (
                  <li>
                    <button
                      type="button"
                      className={`${styles.profileMenuItem} ${styles.profileMenuItemDanger}`}
                      onClick={() => void deleteUser(panelUser)}
                    >
                      <IconProfileTrash />
                      <span className={styles.profileMenuLabel}>Delete user</span>
                      <IconChevronRight />
                    </button>
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        </>
      ) : null}

      {createOpen ? (
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal
          aria-labelledby="create-user-title"
          onClick={() => {
            setCreateOpen(false);
            setSubmitError(null);
            setSuccess(null);
          }}
        >
          <div className={styles.modalPanel} onClick={(e) => e.stopPropagation()}>
            <h2 id="create-user-title">Add new user</h2>
            <p className={styles.hint}>They sign in with the email and temporary password you set here.</p>
            <form
              className={styles.formGrid}
              onSubmit={(e) => {
                void onSubmitCreate(e);
              }}
            >
              <label>
                <span>Full name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
              </label>
              <label>
                <span>Email</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
              </label>
              <label>
                <span>Temporary password (min 8 characters)</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </label>
              <label>
                <span>Role</span>
                <select value={roleName} onChange={(e) => setRoleName(e.target.value)}>
                  {roles.map((r) => (
                    <option key={r.id} value={r.name}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Department</span>
                <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} required>
                  {departments.length === 0 ? (
                    <option value="">No departments</option>
                  ) : (
                    departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))
                  )}
                </select>
                <p className={styles.hint} style={{ marginTop: "0.35rem" }}>
                  Need a new one? <Link href="/admin/departments">Departments</Link>
                </p>
              </label>
              <label>
                <span>Employee badge {roleName === "EMPLOYEE" ? "(required for EMPLOYEE)" : "(optional)"}</span>
                <input
                  value={employeeBadgeNumber}
                  onChange={(e) => setEmployeeBadgeNumber(e.target.value)}
                  required={roleName === "EMPLOYEE"}
                />
              </label>
              <label>
                <span>Job title (optional)</span>
                <input value={position} onChange={(e) => setPosition(e.target.value)} />
              </label>
              {submitError ? (
                <p role="alert" style={{ color: "var(--error)", margin: 0 }}>
                  {submitError}
                </p>
              ) : null}
              {success ? (
                <p role="status" style={{ color: "var(--success)", margin: 0 }}>
                  {success}
                </p>
              ) : null}
              <div className={styles.modalActions}>
                <button type="submit" className={styles.btnPrimary} disabled={loading || departments.length === 0}>
                  {loading ? "Creating…" : "Create user"}
                </button>
                <button
                  type="button"
                  className={styles.btnGhost}
                  onClick={() => {
                    setCreateOpen(false);
                    setSubmitError(null);
                    setSuccess(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editUser ? (
        <div className={styles.modalOverlay} role="dialog" aria-modal onClick={() => setEditUser(null)}>
          <div className={styles.modalPanel} onClick={(e) => e.stopPropagation()}>
            <h2>Edit user</h2>
            <div className={styles.formGrid}>
              <label>
                <span>Email</span>
                <input
                  value={editUser.email}
                  onChange={(e) => setEditUser({ ...editUser, email: e.target.value })}
                />
              </label>
              <label>
                <span>Name</span>
                <input value={editUser.name} onChange={(e) => setEditUser({ ...editUser, name: e.target.value })} />
              </label>
              <label>
                <span>Role</span>
                <select value={editUser.role} onChange={(e) => setEditUser({ ...editUser, role: e.target.value })}>
                  {roles.map((r) => (
                    <option key={r.id} value={r.name}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Department</span>
                <select
                  value={editUser.department.id}
                  onChange={(e) => {
                    const id = e.target.value;
                    const d = departments.find((x) => x.id === id);
                    if (d) setEditUser({ ...editUser, department: { id: d.id, name: d.name } });
                  }}
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Employee badge</span>
                <input
                  value={editUser.employeeBadgeNumber ?? ""}
                  onChange={(e) => setEditUser({ ...editUser, employeeBadgeNumber: e.target.value || null })}
                />
              </label>
              <label>
                <span>Phone</span>
                <input
                  value={editUser.phoneNumber ?? ""}
                  onChange={(e) => setEditUser({ ...editUser, phoneNumber: e.target.value || null })}
                />
              </label>
              <label>
                <span>Position</span>
                <input
                  value={editUser.position ?? ""}
                  onChange={(e) => setEditUser({ ...editUser, position: e.target.value || null })}
                />
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={editUser.isActive}
                  onChange={(e) => setEditUser({ ...editUser, isActive: e.target.checked })}
                />
                <span>Active</span>
              </label>
            </div>
            {modalError ? (
              <p role="alert" style={{ color: "var(--error)" }}>
                {modalError}
              </p>
            ) : null}
            <div className={styles.modalActions}>
              <button type="button" disabled={modalBusy} className={styles.btnPrimary} onClick={() => void saveEdit()}>
                Save
              </button>
              <button type="button" className={styles.btnGhost} onClick={() => setEditUser(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {passwordUserId ? (
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal
          onClick={() => {
            setPasswordUserId(null);
            setPasswordValue("");
            setModalError(null);
          }}
        >
          <div className={styles.modalPanel} style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <h2>Set password</h2>
            <div className={styles.formGrid}>
              <label>
                <span>New password (min 8 characters)</span>
                <input
                  type="password"
                  value={passwordValue}
                  onChange={(e) => setPasswordValue(e.target.value)}
                  minLength={8}
                  autoComplete="new-password"
                />
              </label>
            </div>
            {modalError ? (
              <p role="alert" style={{ color: "var(--error)" }}>
                {modalError}
              </p>
            ) : null}
            <div className={styles.modalActions}>
              <button type="button" disabled={modalBusy} className={styles.btnPrimary} onClick={() => void submitPassword()}>
                Update password
              </button>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => {
                  setPasswordUserId(null);
                  setPasswordValue("");
                  setModalError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
