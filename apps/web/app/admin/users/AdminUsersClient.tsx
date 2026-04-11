"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ProfileAvatarImage } from "@/components/ProfileAvatarImage";
import { ProfilePhotoModal } from "@/components/ProfilePhotoModal";
import { profilePictureDisplayUrl } from "@/lib/profilePicture";
import { fetchWithAuth, getValidAccessToken } from "../../../lib/authClient";
import {
  DepartmentAccessLevelApi,
  type DepartmentAccessLevelApiValue,
  RoleNameApi,
  type UserRestrictionsDto,
} from "../../../lib/restrictions";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { AdminChromeHeader } from "../AdminChromeHeader";
import { useAdminGuard } from "../useAdminGuard";
import { AdminHubGlyph, type AdminHubGlyphType } from "../AdminHubIcons";
import dash from "../../components/shellNav.module.css";
import styles from "./adminUsers.module.css";
import { API_BASE as API } from "@/lib/apiBase";

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
  restrictions?: UserRestrictionsDto;
  mustChangePassword?: boolean;
  lastLoginAt: string | null;
  deletedAt: string | null;
  departmentAccess?: DeptAccessRow[];
};

type DeptAccessRow = {
  departmentId: string;
  departmentName: string;
  accessLevel: DepartmentAccessLevelApiValue;
};

const DEFAULT_RESTRICTIONS: UserRestrictionsDto = {
  loginAllowed: true,
  accessDocumentsAllowed: true,
  manageDocumentsAllowed: true,
  accessDashboardAllowed: true,
  useAiQueriesAllowed: true,
};

function normalizeAdminUserRow(u: AdminUserRow): AdminUserRow {
  return {
    ...u,
    restrictions: u.restrictions ?? { ...DEFAULT_RESTRICTIONS },
    mustChangePassword: u.mustChangePassword ?? false,
    lastLoginAt: u.lastLoginAt ?? null,
    deletedAt: u.deletedAt ?? null,
  };
}

type TriBoolFilter = "" | "true" | "false";

function appendTriBoolParam(params: URLSearchParams, key: string, v: TriBoolFilter) {
  if (v === "true" || v === "false") params.set(key, v);
}

const RESTRICTION_PILLS: { key: keyof UserRestrictionsDto; label: string; tooltip: string }[] = [
  { key: "loginAllowed", label: "Login access", tooltip: "Allow or block sign-in for this user." },
  { key: "accessDocumentsAllowed", label: "Access documents", tooltip: "Open the document library and view files." },
  { key: "manageDocumentsAllowed", label: "Manage documents", tooltip: "Upload, edit metadata, archive, or delete (requires manager/admin role)." },
  { key: "accessDashboardAllowed", label: "Access dashboard", tooltip: "Open the main dashboard hub after sign-in." },
  { key: "useAiQueriesAllowed", label: "Use AI queries", tooltip: "Run semantic (embedding) search over documents." },
];

type SessionUser = { id: string; name: string; email: string; role: string; profilePictureUrl?: string | null };

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "—";
  }
}

function accountStatusLabel(u: AdminUserRow): string {
  if (u.deletedAt) return "Archived";
  return u.isActive ? "Active" : "Inactive";
}

function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default function AdminUsersClient() {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { phase: authPhase, sessionUser: guardSession } = useAdminGuard();
  const [bootstrapPhase, setBootstrapPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
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
  const [filterIncludeDeleted, setFilterIncludeDeleted] = useState(false);
  const [filterLoginAllowed, setFilterLoginAllowed] = useState<TriBoolFilter>("");
  const [filterAccessDocuments, setFilterAccessDocuments] = useState<TriBoolFilter>("");
  const [filterManageDocuments, setFilterManageDocuments] = useState<TriBoolFilter>("");
  const [filterAccessDashboard, setFilterAccessDashboard] = useState<TriBoolFilter>("");
  const [filterUseAi, setFilterUseAi] = useState<TriBoolFilter>("");
  const [filterMustChangePassword, setFilterMustChangePassword] = useState<TriBoolFilter>("");
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
  const [roleName, setRoleName] = useState<string>(RoleNameApi.EMPLOYEE);
  const [departmentId, setDepartmentId] = useState("");
  const [employeeBadgeNumber, setEmployeeBadgeNumber] = useState("");
  const [position, setPosition] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const filterWrapRef = useRef<HTMLDivElement | null>(null);
  const filterToggleRef = useRef<HTMLButtonElement | null>(null);
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);
  const rowMenuBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterPopoverPlacement, setFilterPopoverPlacement] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [rowMenuUserId, setRowMenuUserId] = useState<string | null>(null);
  const [rowMenuBox, setRowMenuBox] = useState<{ top: number; left: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [panelUser, setPanelUser] = useState<AdminUserRow | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pillBusy, setPillBusy] = useState<string | null>(null);
  const [restrictionToast, setRestrictionToast] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [forcePwdAfterSet, setForcePwdAfterSet] = useState(false);
  const [panelPhotoModalOpen, setPanelPhotoModalOpen] = useState(false);
  const [panelPhotoUrlDraft, setPanelPhotoUrlDraft] = useState("");
  const [editPhotoModalOpen, setEditPhotoModalOpen] = useState(false);
  const [editPhotoUrlDraft, setEditPhotoUrlDraft] = useState("");

  const [panelDeptAccess, setPanelDeptAccess] = useState<DeptAccessRow[]>([]);
  const [deptAccessBusy, setDeptAccessBusy] = useState(false);
  const [deptAccessAddDeptId, setDeptAccessAddDeptId] = useState("");
  const [deptAccessAddLevel, setDeptAccessAddLevel] = useState<DepartmentAccessLevelApiValue>(
    DepartmentAccessLevelApi.VIEWER,
  );

  const bumpUserProfilePicture = useCallback((userId: string, url: string | null) => {
    setDirectoryUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, profilePictureUrl: url } : u)));
    setPanelUser((p) => (p && p.id === userId ? { ...p, profilePictureUrl: url } : p));
    setEditUser((e) => (e && e.id === userId ? { ...e, profilePictureUrl: url } : e));
    setSessionUser((s) => (s && s.id === userId ? { ...s, profilePictureUrl: url } : s));
  }, []);

  useEffect(() => {
    if (authPhase !== "ready" || !guardSession?.id) {
      setSessionUser(null);
      return;
    }
    setSessionUser({
      id: guardSession.id,
      name: guardSession.name,
      email: guardSession.email,
      role: guardSession.role,
      profilePictureUrl: guardSession.profilePictureUrl ?? null,
    });
  }, [authPhase, guardSession]);

  useEffect(() => {
    if (!panelUser) {
      setPanelPhotoModalOpen(false);
      setPanelDeptAccess([]);
      return;
    }
    if (panelUser.departmentAccess) {
      setPanelDeptAccess(panelUser.departmentAccess);
    } else {
      let cancelled = false;
      void (async () => {
        try {
          const r = await fetchWithAuth(`${API}/admin/users/${panelUser.id}/department-access`);
          if (!r.ok || cancelled) return;
          const data = (await r.json()) as DeptAccessRow[];
          if (!cancelled) setPanelDeptAccess(Array.isArray(data) ? data : []);
        } catch { /* ignore */ }
      })();
      return () => { cancelled = true; };
    }
  }, [panelUser]);

  useEffect(() => {
    if (!editUser) setEditPhotoModalOpen(false);
  }, [editUser]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setUserQ(userSearch.trim());
    }, 350);
    return () => window.clearTimeout(id);
  }, [userSearch]);

  useEffect(() => {
    setListPage(1);
  }, [
    userQ,
    filterDepartmentId,
    filterRole,
    filterActive,
    filterIncludeDeleted,
    filterLoginAllowed,
    filterAccessDocuments,
    filterManageDocuments,
    filterAccessDashboard,
    filterUseAi,
    filterMustChangePassword,
  ]);

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

  useLayoutEffect(() => {
    if (!filtersOpen) {
      setFilterPopoverPlacement(null);
      return;
    }
    function updateFilterPopover() {
      const btn = filterToggleRef.current;
      if (!btn) {
        setFilterPopoverPlacement(null);
        return;
      }
      const rect = btn.getBoundingClientRect();
      const width =
        window.innerWidth < 520
          ? Math.min(340, Math.max(260, window.innerWidth - 16))
          : Math.min(560, Math.max(480, window.innerWidth - 24));
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      const gap = 6;
      const minH = 200;
      const belowSpace = window.innerHeight - rect.bottom - 10;
      const aboveSpace = rect.top - 10;
      /** Prefer opening below; flip above when the toolbar is low and there is more room above (avoids cramped panels). */
      const openUp =
        belowSpace < minH + 100 && aboveSpace > belowSpace && aboveSpace >= minH + 40;
      let top: number;
      let maxHeight: number;
      if (openUp) {
        maxHeight = Math.max(minH, Math.min(aboveSpace - gap, window.innerHeight * 0.88));
        top = Math.max(8, rect.top - gap - maxHeight);
      } else {
        top = rect.bottom + gap;
        maxHeight = Math.max(minH, window.innerHeight - top - 10);
      }
      setFilterPopoverPlacement({ top, left, width, maxHeight });
    }
    updateFilterPopover();
    window.addEventListener("scroll", updateFilterPopover, true);
    window.addEventListener("resize", updateFilterPopover);
    return () => {
      window.removeEventListener("scroll", updateFilterPopover, true);
      window.removeEventListener("resize", updateFilterPopover);
    };
  }, [filtersOpen]);

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
      if (filterIncludeDeleted) params.set("includeDeleted", "true");
      appendTriBoolParam(params, "loginAllowed", filterLoginAllowed);
      appendTriBoolParam(params, "accessDocumentsAllowed", filterAccessDocuments);
      appendTriBoolParam(params, "manageDocumentsAllowed", filterManageDocuments);
      appendTriBoolParam(params, "accessDashboardAllowed", filterAccessDashboard);
      appendTriBoolParam(params, "useAiQueriesAllowed", filterUseAi);
      appendTriBoolParam(params, "mustChangePassword", filterMustChangePassword);
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
      setDirectoryUsers(
        Array.isArray(data.users) ? data.users.map((u) => normalizeAdminUserRow(u as AdminUserRow)) : [],
      );
      setListTotal(data.total ?? 0);
    } catch {
      setDirectoryError("Could not load users.");
    } finally {
      setDirectoryLoading(false);
    }
  }, [
    listPage,
    listPageSize,
    userQ,
    filterDepartmentId,
    filterRole,
    filterActive,
    filterIncludeDeleted,
    filterLoginAllowed,
    filterAccessDocuments,
    filterManageDocuments,
    filterAccessDashboard,
    filterUseAi,
    filterMustChangePassword,
  ]);

  useEffect(() => {
    if (authPhase !== "ready") {
      setBootstrapPhase("idle");
      return;
    }
    let cancelled = false;
    setBootstrapPhase("loading");
    void (async () => {
      try {
        const [dr, rr] = await Promise.all([
          fetchWithAuth(`${API}/admin/departments`),
          fetchWithAuth(`${API}/admin/roles`),
        ]);

        if (!dr.ok || !rr.ok) {
          if (!cancelled) setBootstrapPhase("error");
          return;
        }

        let dJson: { departments: DeptOption[] };
        let rJson: { roles: RoleOption[] };
        try {
          dJson = (await dr.json()) as { departments: DeptOption[] };
          rJson = (await rr.json()) as { roles: RoleOption[] };
        } catch {
          if (!cancelled) setBootstrapPhase("error");
          return;
        }

        if (!cancelled) {
          setDepartments(dJson.departments);
          setRoles(rJson.roles);
          if (dJson.departments.length > 0 && !departmentId) {
            setDepartmentId(dJson.departments[0].id);
          }
          try {
            const sp = new URLSearchParams(window.location.search);
            const qParam = sp.get("q");
            if (qParam) {
              setUserSearch(qParam);
              setUserQ(qParam.trim());
            }
          } catch {
            /* ignore */
          }
          setBootstrapPhase("ready");
        }
      } catch {
        if (!cancelled) setBootstrapPhase("error");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authPhase]);

  const adminReady = authPhase === "ready" && bootstrapPhase === "ready";

  useEffect(() => {
    if (!adminReady) return;
    void loadDirectory();
  }, [adminReady, loadDirectory]);

  useEffect(() => {
    setPanelUser((prev) => {
      if (!prev) return null;
      const fresh = directoryUsers.find((x) => x.id === prev.id);
      return fresh ? normalizeAdminUserRow(fresh) : null;
    });
  }, [directoryUsers]);

  useEffect(() => {
    if (!restrictionToast) return;
    const id = window.setTimeout(() => setRestrictionToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [restrictionToast]);

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
      router.replace("/login");
      return;
    }
    setSubmitError(null);
    setSuccess(null);
    if (roleName === RoleNameApi.EMPLOYEE && !employeeBadgeNumber.trim()) {
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
      const r = editUser.restrictions ?? DEFAULT_RESTRICTIONS;
      const body: Record<string, unknown> = {
        email: editUser.email,
        name: editUser.name,
        role: editUser.role,
        departmentId: editUser.department.id,
        employeeBadgeNumber: editUser.employeeBadgeNumber,
        phoneNumber: editUser.phoneNumber,
        position: editUser.position,
        isActive: editUser.isActive,
        loginAllowed: r.loginAllowed,
        accessDocumentsAllowed: r.accessDocumentsAllowed,
        manageDocumentsAllowed: r.manageDocumentsAllowed,
        accessDashboardAllowed: r.accessDashboardAllowed,
        useAiQueriesAllowed: r.useAiQueriesAllowed,
        mustChangePassword: editUser.mustChangePassword ?? false,
        profilePictureUrl: editUser.profilePictureUrl,
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

  async function setRestrictionForPanel(key: keyof UserRestrictionsDto, value: boolean) {
    if (!panelUser?.restrictions) return;
    if (panelUser.id === sessionUser?.id && key === "loginAllowed" && !value) {
      toast("You cannot disable login for your own account.", "warning");
      return;
    }
    setPillBusy(key);
    setRestrictionToast(null);
    try {
      const res = await fetchWithAuth(`${API}/admin/users/${panelUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; user?: AdminUserRow };
      if (!res.ok) {
        toast(data.error ?? "Update failed.", "error");
        return;
      }
      if (data.user) {
        const nu = normalizeAdminUserRow(data.user);
        setPanelUser(nu);
        setDirectoryUsers((rows) => rows.map((r) => (r.id === nu.id ? nu : r)));
      } else {
        void loadDirectory();
      }
      setRestrictionToast(value ? "Permission enabled" : "Restriction applied");
    } catch {
      toast("Could not reach the API.", "error");
    } finally {
      setPillBusy(null);
    }
  }

  async function resetRestrictionsForPanel() {
    if (!panelUser) return;
    setPillBusy("reset");
    setRestrictionToast(null);
    try {
      const res = await fetchWithAuth(`${API}/admin/users/${panelUser.id}/reset-restrictions`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; user?: AdminUserRow };
      if (!res.ok) {
        toast(data.error ?? "Reset failed.", "error");
        return;
      }
      if (data.user) {
        const nu = normalizeAdminUserRow(data.user);
        setPanelUser(nu);
        setDirectoryUsers((rows) => rows.map((r) => (r.id === nu.id ? nu : r)));
      } else {
        void loadDirectory();
      }
      setRestrictionToast("All permissions reset to allowed");
    } catch {
      toast("Could not reach the API.", "error");
    } finally {
      setPillBusy(null);
    }
  }

  async function addDeptAccess() {
    if (!panelUser || !deptAccessAddDeptId) return;
    setDeptAccessBusy(true);
    try {
      const res = await fetchWithAuth(`${API}/admin/users/${panelUser.id}/department-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentId: deptAccessAddDeptId, accessLevel: deptAccessAddLevel }),
      });
      const data = (await res.json().catch(() => ({}))) as DeptAccessRow & { error?: string };
      if (!res.ok) {
        toast(data.error ?? "Failed to add access.", "error");
        return;
      }
      if (data.departmentId) {
        setPanelDeptAccess((prev) => {
          const next = prev.filter((r) => r.departmentId !== data.departmentId);
          next.push({ departmentId: data.departmentId, departmentName: data.departmentName, accessLevel: data.accessLevel });
          return next.sort((a, b) => a.departmentName.localeCompare(b.departmentName));
        });
      }
      setDeptAccessAddDeptId("");
    } catch {
      toast("Could not reach the API.", "error");
    } finally {
      setDeptAccessBusy(false);
    }
  }

  async function removeDeptAccess(departmentId: string) {
    if (!panelUser) return;
    setDeptAccessBusy(true);
    try {
      const res = await fetchWithAuth(
        `${API}/admin/users/${panelUser.id}/department-access/${departmentId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast(data.error ?? "Failed to remove access.", "error");
        return;
      }
      setPanelDeptAccess((prev) => prev.filter((r) => r.departmentId !== departmentId));
    } catch {
      toast("Could not reach the API.", "error");
    } finally {
      setDeptAccessBusy(false);
    }
  }

  async function changeDeptAccessLevel(departmentId: string, level: DepartmentAccessLevelApiValue) {
    if (!panelUser) return;
    setDeptAccessBusy(true);
    try {
      const res = await fetchWithAuth(`${API}/admin/users/${panelUser.id}/department-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentId, accessLevel: level }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast(data.error ?? "Failed to update access.", "error");
        return;
      }
      setPanelDeptAccess((prev) =>
        prev.map((r) => (r.departmentId === departmentId ? { ...r, accessLevel: level } : r)),
      );
    } catch {
      toast("Could not reach the API.", "error");
    } finally {
      setDeptAccessBusy(false);
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
      if (forcePwdAfterSet) {
        const pr = await fetchWithAuth(`${API}/admin/users/${passwordUserId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mustChangePassword: true }),
        });
        if (!pr.ok) {
          const data = (await pr.json().catch(() => ({}))) as { error?: string };
          setModalError(data.error ?? "Password was set but could not flag “change on next sign-in”.");
          return;
        }
      }
      setPasswordUserId(null);
      setPasswordValue("");
      setForcePwdAfterSet(false);
      void loadDirectory();
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
      toast(data.error ?? "Unlock failed.", "error");
      return;
    }
    void loadDirectory();
  }

  async function lockUser(id: string) {
    const res = await fetchWithAuth(`${API}/admin/users/${id}/lock`, { method: "POST" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast(data.error ?? "Lock failed.", "error");
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
      toast("Remove your own account from the selection to lock others.", "warning");
      return;
    }
    if (
      !(await confirm({
        title: "Confirm Action",
        message: `Lock sign-in for ${ids.length} user(s)? They cannot log in until you unlock them or the lock period ends (7 days).`,
        danger: true,
      }))
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
    if (fail) toast(`${fail} lock operation(s) failed.`, "error");
  }

  async function bulkApplyRestrictions(patch: Partial<UserRestrictionsDto>) {
    let ids = [...selectedIds];
    if (patch.loginAllowed === false) {
      ids = ids.filter((id) => id !== sessionUser?.id);
      if (ids.length === 0) {
        toast("Remove your own account from the selection to block sign-in for others.", "warning");
        return;
      }
    }
    const keys = Object.keys(patch) as (keyof UserRestrictionsDto)[];
    if (keys.length === 0) return;
    const label = keys.map((k) => RESTRICTION_PILLS.find((p) => p.key === k)?.label ?? k).join(", ");
    if (!(await confirm({ title: "Confirm Action", message: `Apply restriction changes to ${ids.length} user(s)?\n${label}`, danger: true }))) return;
    setBulkBusy(true);
    let fail = 0;
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const res = await fetchWithAuth(`${API}/admin/users/bulk-restrictions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: chunk, ...patch }),
      });
      if (!res.ok) fail += chunk.length;
    }
    setBulkBusy(false);
    setSelectedIds(new Set());
    void loadDirectory();
    if (fail) toast(`${fail} user(s) could not be updated (check permissions or try a smaller batch).`, "error");
  }

  async function bulkResetRestrictionsSelected() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!(await confirm({ title: "Confirm Action", message: `Reset all access permissions to “allowed” for ${ids.length} user(s)?`, danger: true }))) return;
    setBulkBusy(true);
    let fail = 0;
    const allowAll: Partial<UserRestrictionsDto> = {
      loginAllowed: true,
      accessDocumentsAllowed: true,
      manageDocumentsAllowed: true,
      accessDashboardAllowed: true,
      useAiQueriesAllowed: true,
    };
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const res = await fetchWithAuth(`${API}/admin/users/bulk-restrictions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: chunk, ...allowAll }),
      });
      if (!res.ok) fail += chunk.length;
    }
    setBulkBusy(false);
    setSelectedIds(new Set());
    void loadDirectory();
    if (fail) toast(`${fail} user(s) could not be updated.`, "error");
  }

  async function bulkDeleteSelected() {
    const ids = [...selectedIds].filter((id) => id !== sessionUser?.id);
    if (ids.length === 0) {
      toast("You cannot delete only your own account from this bulk action.", "warning");
      return;
    }
    if (
      !(await confirm({
        title: "Archive Users",
        message: `Archive ${ids.length} user(s)? They will be hidden from the directory and signed out. Users who created documents may need content reassigned first.`,
        danger: true,
      }))
    )
      return;
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
    if (fail) toast(`Archived ${ok}. ${fail} could not be archived (e.g. last admin or documents owned).`, "error");
  }

  async function deleteUser(u: AdminUserRow) {
    if (
      !(await confirm({
        title: "Archive User",
        message: `Archive ${u.email}? They will be hidden from the directory and signed out. This does not remove database rows unless you erase them later (when allowed).`,
        danger: true,
      }))
    )
      return;
    const res = await fetchWithAuth(`${API}/admin/users/${u.id}`, { method: "DELETE" });
    if (res.status === 204) {
      void loadDirectory();
      setPanelUser((p) => (p?.id === u.id ? null : p));
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    toast(data.error ?? "Archive failed.", "error");
  }

  async function restoreUser(id: string) {
    const res = await fetchWithAuth(`${API}/admin/users/${id}/restore`, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { error?: string; user?: AdminUserRow };
    if (!res.ok) {
      toast(data.error ?? "Restore failed.", "error");
      return;
    }
    if (data.user) {
      const nu = normalizeAdminUserRow(data.user);
      setDirectoryUsers((rows) => rows.map((r) => (r.id === nu.id ? nu : r)));
      setPanelUser((p) => (p?.id === nu.id ? nu : p));
    } else {
      void loadDirectory();
    }
  }

  async function revokeAllSessionsForUser(id: string) {
    if (!(await confirm({ title: "Revoke Sessions", message: "Revoke every refresh session for this user? They must sign in again on all devices.", danger: true }))) return;
    const res = await fetchWithAuth(`${API}/admin/users/${id}/revoke-sessions`, { method: "POST" });
    if (res.status === 204) {
      void loadDirectory();
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    toast(data.error ?? "Could not revoke sessions.", "error");
  }

  async function hardEraseUser(u: AdminUserRow) {
    if (
      !(await confirm({
        title: "Permanently Erase",
        message: `Permanently erase ${u.email} from the database? This cannot be undone. Only use when the account is already archived and has no documents.`,
        danger: true,
      }))
    )
      return;
    const res = await fetchWithAuth(`${API}/admin/users/${u.id}?hard=1`, { method: "DELETE" });
    if (res.status === 204) {
      setPanelUser((p) => (p?.id === u.id ? null : p));
      void loadDirectory();
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    toast(data.error ?? "Erase failed.", "error");
  }

  async function submitImport() {
    setImportMessage(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importJson.trim()) as unknown;
    } catch {
      setImportMessage("Invalid JSON.");
      return;
    }
    const body =
      parsed && typeof parsed === "object" && !Array.isArray(parsed) && "users" in parsed
        ? parsed
        : { users: parsed };
    setImportBusy(true);
    try {
      const res = await fetchWithAuth(`${API}/admin/users/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        created?: number;
        errors?: { email: string; error: string }[];
      };
      if (!res.ok) {
        setImportMessage(data.error ?? "Import failed.");
        return;
      }
      const errCount = data.errors?.length ?? 0;
      setImportMessage(
        `Created ${data.created ?? 0} user(s).${errCount ? ` ${errCount} row(s) failed — see console.` : ""}`,
      );
      if (errCount && data.errors) {
        console.warn("Import errors", data.errors);
      }
      setImportJson("");
      void loadDirectory();
    } catch {
      setImportMessage("Could not reach the API.");
    } finally {
      setImportBusy(false);
    }
  }

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const el = e.target as HTMLElement | null;
      if (filterWrapRef.current?.contains(el as Node)) return;
      if (el?.closest("[data-admin-users-filter-popover]")) return;
      if (el?.closest("[data-admin-users-row-menu]")) return;
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

  function toggleEditRestriction(key: keyof UserRestrictionsDto, next: boolean) {
    if (!editUser) return;
    if (editUser.id === sessionUser?.id && key === "loginAllowed" && !next) {
      toast("You cannot disable login for your own account.", "warning");
      return;
    }
    const base = editUser.restrictions ?? DEFAULT_RESTRICTIONS;
    setEditUser({
      ...editUser,
      restrictions: { ...base, [key]: next },
    });
  }

  function exportCsv() {
    const rows =
      selectedIds.size > 0 ? directoryUsers.filter((u) => selectedIds.has(u.id)) : directoryUsers;
    const esc = (s: string | null | undefined) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const header = [
      "Name",
      "Email",
      "Role",
      "Department",
      "Status",
      "LastSignIn",
      "ForcePasswordChange",
      "Archived",
      "Phone",
      "Badge",
      "Position",
    ];
    const lines = [header.join(",")];
    for (const u of rows) {
      lines.push(
        [
          esc(u.name),
          esc(u.email),
          esc(u.role),
          esc(u.department.name),
          esc(accountStatusLabel(u)),
          esc(u.lastLoginAt),
          esc(u.mustChangePassword ? "yes" : "no"),
          esc(u.deletedAt ? "yes" : "no"),
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

  if (authPhase === "checking") {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }

  if (authPhase === "need-login") {
    return (
      <main style={{ maxWidth: 480 }}>
        <h1>Users</h1>
        <p style={{ color: "var(--muted)" }}>You need to sign in to access this page.</p>
        <p style={{ marginTop: "1rem" }}>
          <Link href="/login">Sign in</Link>
          {" · "}
          <Link prefetch={false} href="/documents">Home</Link>
        </p>
      </main>
    );
  }

  if (authPhase === "forbidden") {
    return (
      <main style={{ maxWidth: 480 }}>
        <h1>Users</h1>
        <p style={{ color: "var(--error)" }}>Only administrators can manage users.</p>
        <p>
          <Link prefetch={false} href="/dashboard">Dashboard</Link>
          {" · "}
          <Link prefetch={false} href="/documents">Home</Link>
        </p>
      </main>
    );
  }

  if (authPhase === "load-error") {
    return (
      <main style={{ maxWidth: 480 }}>
        <h1>Users</h1>
        <p style={{ color: "var(--error)" }}>Could not verify access.</p>
        <p style={{ marginTop: "1rem" }}>
          <Link href="/login">Sign in</Link>
          {" · "}
          <Link prefetch={false} href="/admin">Admin hub</Link>
        </p>
      </main>
    );
  }

  if (authPhase === "ready" && bootstrapPhase === "error") {
    return (
      <main>
        <p style={{ color: "var(--error)" }}>Could not load departments or roles.</p>
        <Link prefetch={false} href="/dashboard">Dashboard</Link>
      </main>
    );
  }

  if (authPhase === "ready" && bootstrapPhase !== "ready") {
    return (
      <main>
        <p>Loading…</p>
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

  return (
    <main className={styles.shell} data-dashboard-fullscreen="true">
      <AdminChromeHeader user={sessionUser} className={`${dash.navbar} ${styles.navbarRow}`} />

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
            <p className={styles.pageSubtitle}>
              Directory, access restrictions, sign-in lock, archives, and bulk updates.
            </p>
          </div>
          <div className={styles.pageHeadActions}>
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => {
                setImportOpen(true);
                setImportMessage(null);
              }}
            >
              Import JSON
            </button>
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
                  ref={filterToggleRef}
                  className={styles.filterToggle}
                  aria-expanded={filtersOpen}
                  aria-haspopup="true"
                  aria-label="Open table filters"
                  onClick={() => setFiltersOpen((v) => !v)}
                >
                  <IconFilter />
                  <span>Filter</span>
                </button>
                {filtersOpen && filterPopoverPlacement
                  ? createPortal(
                      <div
                        className={styles.filterPopoverFixed}
                        data-admin-users-filter-popover
                        role="group"
                        aria-label="Table filters"
                        style={{
                          top: filterPopoverPlacement.top,
                          left: filterPopoverPlacement.left,
                          width: filterPopoverPlacement.width,
                          maxHeight: filterPopoverPlacement.maxHeight,
                        }}
                      >
                        <div className={styles.filterPopoverGrid}>
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
                          <label>
                            Login access
                            <select
                              value={filterLoginAllowed}
                              onChange={(e) => setFilterLoginAllowed(e.target.value as TriBoolFilter)}
                            >
                              <option value="">Any</option>
                              <option value="true">Sign-in allowed</option>
                              <option value="false">Sign-in disabled</option>
                            </select>
                          </label>
                          <label>
                            Document access
                            <select
                              value={filterAccessDocuments}
                              onChange={(e) => setFilterAccessDocuments(e.target.value as TriBoolFilter)}
                            >
                              <option value="">Any</option>
                              <option value="true">Documents allowed</option>
                              <option value="false">Documents blocked</option>
                            </select>
                          </label>
                          <label>
                            Manage documents
                            <select
                              value={filterManageDocuments}
                              onChange={(e) => setFilterManageDocuments(e.target.value as TriBoolFilter)}
                            >
                              <option value="">Any</option>
                              <option value="true">Allowed</option>
                              <option value="false">Blocked</option>
                            </select>
                          </label>
                          <label>
                            Dashboard access
                            <select
                              value={filterAccessDashboard}
                              onChange={(e) => setFilterAccessDashboard(e.target.value as TriBoolFilter)}
                            >
                              <option value="">Any</option>
                              <option value="true">Allowed</option>
                              <option value="false">Blocked</option>
                            </select>
                          </label>
                          <label>
                            AI queries
                            <select value={filterUseAi} onChange={(e) => setFilterUseAi(e.target.value as TriBoolFilter)}>
                              <option value="">Any</option>
                              <option value="true">Allowed</option>
                              <option value="false">Blocked</option>
                            </select>
                          </label>
                          <label>
                            Password change required
                            <select
                              value={filterMustChangePassword}
                              onChange={(e) => setFilterMustChangePassword(e.target.value as TriBoolFilter)}
                            >
                              <option value="">Any</option>
                              <option value="true">Must change password</option>
                              <option value="false">Not forced</option>
                            </select>
                          </label>
                          <label className={styles.filterPopoverFullRow}>
                            <span className={styles.filterPopoverCheckbox}>
                              <input
                                type="checkbox"
                                checked={filterIncludeDeleted}
                                onChange={(e) => setFilterIncludeDeleted(e.target.checked)}
                              />
                              <span>Show archived users</span>
                            </span>
                          </label>
                          <div className={styles.filterPopoverFullRow}>
                            <button type="button" className={styles.btnGhost} onClick={() => void loadDirectory()}>
                              Refresh data
                            </button>
                          </div>
                        </div>
                      </div>,
                      document.body,
                    )
                  : null}
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
                className={styles.btnGhost}
                disabled={bulkBusy}
                onClick={() =>
                  void bulkApplyRestrictions({
                    accessDocumentsAllowed: false,
                  })
                }
              >
                Block document access
              </button>
              <button
                type="button"
                className={styles.btnGhost}
                disabled={bulkBusy}
                onClick={() =>
                  void bulkApplyRestrictions({
                    accessDocumentsAllowed: true,
                  })
                }
              >
                Allow document access
              </button>
              <button
                type="button"
                className={styles.btnGhost}
                disabled={bulkBusy}
                onClick={() =>
                  void bulkApplyRestrictions({
                    loginAllowed: false,
                  })
                }
              >
                Disable sign-in
              </button>
              <button
                type="button"
                className={styles.btnGhost}
                disabled={bulkBusy}
                onClick={() =>
                  void bulkApplyRestrictions({
                    loginAllowed: true,
                  })
                }
              >
                Enable sign-in
              </button>
              <button
                type="button"
                className={styles.btnGhost}
                disabled={bulkBusy}
                onClick={() => void bulkResetRestrictionsSelected()}
              >
                Reset permissions
              </button>
              <button
                type="button"
                className={styles.btnDanger}
                disabled={bulkBusy}
                onClick={() => void bulkDeleteSelected()}
              >
                Archive selected
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
                  <th scope="col">Last sign-in</th>
                  <th scope="col">Force pwd</th>
                  <th scope="col">Lock</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {directoryLoading ? (
                  <tr>
                    <td colSpan={11} className={styles.cellMuted} style={{ padding: "1.25rem" }}>
                      Loading…
                    </td>
                  </tr>
                ) : null}
                {!directoryLoading && directoryUsers.length === 0 ? (
                  <tr>
                    <td colSpan={11} className={styles.cellMuted} style={{ padding: "1.25rem" }}>
                      No users match your filters.
                    </td>
                  </tr>
                ) : null}
                {!directoryLoading &&
                  directoryUsers.map((u) => {
                    const initials = userInitials(u.name);
                    const photoSrc = profilePictureDisplayUrl(u.profilePictureUrl);
                    return (
                      <tr
                        key={u.id}
                        className={`${styles.clickableRow}${u.deletedAt ? ` ${styles.rowArchived}` : ""}${
                          selectedIds.has(u.id) ? ` ${styles.rowSelected}` : ""
                        }`}
                        onClick={(e) => {
                          const el = e.target as HTMLElement;
                          if (el.closest("input, button, [role='menu'], [data-admin-users-row-menu]")) return;
                          setRowMenuUserId(null);
                          setPanelUser(normalizeAdminUserRow(u));
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
                            {photoSrc ? (
                              <ProfileAvatarImage className={styles.avatar} src={photoSrc} alt="" width={36} height={36} sizes="36px" />
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
                        <td>{accountStatusLabel(u)}</td>
                        <td className={styles.cellMuted}>{fmtDateTime(u.lastLoginAt)}</td>
                        <td className={styles.cellMuted}>{u.mustChangePassword ? "Yes" : "—"}</td>
                        <td className={styles.cellMuted}>
                          {u.loginLockedUntil || u.failedLoginAttempts > 0 ? (
                            <span style={{ color: "var(--warning)" }} title={u.loginLockedUntil ?? undefined}>
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
                                    setEditUser(normalizeAdminUserRow({ ...u }));
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
                                    setForcePwdAfterSet(false);
                                    setPasswordUserId(u.id);
                                  }}
                                >
                                  Set password
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setRowMenuUserId(null);
                                    void revokeAllSessionsForUser(u.id);
                                  }}
                                >
                                  Revoke all sessions
                                </button>
                                {u.deletedAt ? (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      setRowMenuUserId(null);
                                      void restoreUser(u.id);
                                    }}
                                  >
                                    Restore account
                                  </button>
                                ) : u.id !== sessionUser.id ? (
                                  <button
                                    type="button"
                                    className={styles.rowMenuDanger}
                                    role="menuitem"
                                    onClick={() => {
                                      setRowMenuUserId(null);
                                      void deleteUser(u);
                                    }}
                                  >
                                    Archive user
                                  </button>
                                ) : null}
                                {u.deletedAt && u.id !== sessionUser.id ? (
                                  <button
                                    type="button"
                                    className={styles.rowMenuDanger}
                                    role="menuitem"
                                    onClick={() => {
                                      setRowMenuUserId(null);
                                      void hardEraseUser(u);
                                    }}
                                  >
                                    Erase permanently
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
                  {profilePictureDisplayUrl(panelUser.profilePictureUrl) ? (
                    <ProfileAvatarImage
                      className={styles.profileAvatarImg}
                      src={profilePictureDisplayUrl(panelUser.profilePictureUrl)!}
                      alt=""
                      width={88}
                      height={88}
                      sizes="88px"
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
                <p className={styles.profileJoined} style={{ marginTop: "0.2rem" }}>
                  Last sign-in {fmtDateTime(panelUser.lastLoginAt)}
                </p>
                {!panelUser.deletedAt ? (
                  <>
                    <button
                      type="button"
                      className={styles.profilePhotoBtn}
                      onClick={() => {
                        setPanelPhotoUrlDraft(panelUser.profilePictureUrl ?? "");
                        setPanelPhotoModalOpen(true);
                      }}
                    >
                      Change photo
                    </button>
                    <ProfilePhotoModal
                      open={panelPhotoModalOpen}
                      onClose={() => setPanelPhotoModalOpen(false)}
                      mode="admin"
                      targetUserId={panelUser.id}
                      displayName={panelUser.name}
                      pictureUrl={panelUser.profilePictureUrl}
                      pictureUrlDraft={panelPhotoUrlDraft}
                      onPictureUrlDraftChange={setPanelPhotoUrlDraft}
                      onPictureUpdated={(url) => bumpUserProfilePicture(panelUser.id, url)}
                    />
                  </>
                ) : null}
                <button
                  type="button"
                  className={styles.profileEditCta}
                  onClick={() => {
                    setPanelUser(null);
                    setModalError(null);
                    setEditUser(normalizeAdminUserRow({ ...panelUser }));
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
                  <span className={styles.profileFieldLabel}>Account status</span>
                  <div className={styles.profileFieldBox}>{accountStatusLabel(panelUser)}</div>
                </div>
                <div className={styles.profileField}>
                  <span className={styles.profileFieldLabel}>Must change password</span>
                  <div className={styles.profileFieldBox}>{panelUser.mustChangePassword ? "Yes" : "No"}</div>
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

              <div className={styles.restrictionSection}>
                <h4 className={styles.restrictionSectionTitle}>Access controls</h4>
                <p style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", lineHeight: 1.45, color: "var(--muted)" }}>
                  Toggle permissions for this user. Allowed is highlighted; restricted is muted or red. Role still
                  applies—e.g. employees cannot manage documents unless they are a manager.
                </p>
                <div className={styles.restrictionPills} role="group" aria-label="Permission toggles">
                  {RESTRICTION_PILLS.map(({ key, label, tooltip }) => {
                    const r = panelUser.restrictions ?? DEFAULT_RESTRICTIONS;
                    const allowed = r[key];
                    const busy = pillBusy === key || pillBusy === "reset";
                    const blockSelfLoginOff =
                      panelUser.id === sessionUser?.id && key === "loginAllowed" && allowed;
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`${styles.restrictionPill} ${
                          allowed
                            ? styles.restrictionPillAllowed
                            : key === "loginAllowed"
                              ? styles.restrictionPillRestrictedWarn
                              : styles.restrictionPillRestricted
                        }`}
                        title={
                          blockSelfLoginOff
                            ? `${tooltip} You cannot remove your own login access here.`
                            : `${tooltip} Click to ${allowed ? "restrict" : "allow"}.`
                        }
                        disabled={busy || blockSelfLoginOff || !!panelUser.deletedAt}
                        onClick={() => void setRestrictionForPanel(key, !allowed)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className={styles.restrictionResetBtn}
                  disabled={pillBusy !== null || !!panelUser.deletedAt}
                  onClick={() => void resetRestrictionsForPanel()}
                >
                  Reset permissions
                </button>
                {restrictionToast ? (
                  <div className={styles.restrictionToast} role="status">
                    {restrictionToast}
                  </div>
                ) : (
                  <div className={styles.restrictionToast} aria-hidden />
                )}
              </div>

              <div className={styles.restrictionSection}>
                <h4 className={styles.restrictionSectionTitle}>Department access</h4>
                <p style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", lineHeight: 1.45, color: "var(--muted)" }}>
                  Assign which departments this user can access or manage. Inherited access from parent departments is automatic.
                </p>
                {panelDeptAccess.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.75rem" }}>
                    {panelDeptAccess.map((da) => (
                      <div
                        key={da.departmentId}
                        style={{
                          display: "flex", alignItems: "center", gap: "0.5rem",
                          padding: "0.45rem 0.7rem", background: "var(--surface-subtle)", borderRadius: 8,
                          fontSize: "0.85rem",
                        }}
                      >
                        <span style={{ flex: 1, fontWeight: 500 }}>{da.departmentName}</span>
                        <select
                          value={da.accessLevel}
                          disabled={deptAccessBusy}
                          onChange={(e) =>
                            void changeDeptAccessLevel(da.departmentId, e.target.value as DepartmentAccessLevelApiValue)
                          }
                          style={{
                            padding: "0.2rem 0.4rem", borderRadius: 6, border: "1px solid var(--border)",
                            fontSize: "0.8rem", background: "var(--input-bg)", color: "var(--text)", cursor: "pointer",
                          }}
                        >
                          <option value={DepartmentAccessLevelApi.MEMBER}>Member</option>
                          <option value={DepartmentAccessLevelApi.MANAGER}>Manager</option>
                          <option value={DepartmentAccessLevelApi.VIEWER}>Viewer</option>
                        </select>
                        <button
                          type="button"
                          disabled={deptAccessBusy}
                          onClick={() => void removeDeptAccess(da.departmentId)}
                          style={{
                            background: "none", border: "none", color: "var(--error)", cursor: "pointer",
                            fontSize: "0.8rem", fontWeight: 600, padding: "0.15rem 0.3rem", borderRadius: 4,
                          }}
                          title="Remove access"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: "0 0 0.75rem", fontSize: "0.84rem", color: "var(--muted)" }}>
                    No department access assigned yet.
                  </p>
                )}
                <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
                  <select
                    value={deptAccessAddDeptId}
                    onChange={(e) => setDeptAccessAddDeptId(e.target.value)}
                    disabled={deptAccessBusy}
                    style={{
                      flex: "1 1 120px", padding: "0.35rem 0.5rem", borderRadius: 8,
                      border: "1px solid var(--border)", fontSize: "0.84rem", minWidth: 0,
                    }}
                  >
                    <option value="">Add department…</option>
                    {departments
                      .filter((d) => !panelDeptAccess.some((a) => a.departmentId === d.id))
                      .map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                  </select>
                  <select
                    value={deptAccessAddLevel}
                    onChange={(e) => setDeptAccessAddLevel(e.target.value as "MEMBER" | "MANAGER" | "VIEWER")}
                    disabled={deptAccessBusy}
                    style={{
                      padding: "0.35rem 0.5rem", borderRadius: 8,
                      border: "1px solid #e4e4e7", fontSize: "0.84rem",
                    }}
                  >
                    <option value="MEMBER">Member</option>
                    <option value="MANAGER">Manager</option>
                    <option value="VIEWER">Viewer</option>
                  </select>
                  <button
                    type="button"
                    className={styles.restrictionResetBtn}
                    disabled={deptAccessBusy || !deptAccessAddDeptId}
                    onClick={() => void addDeptAccess()}
                    style={{ margin: 0, padding: "0.35rem 0.75rem" }}
                  >
                    Add
                  </button>
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
                      setForcePwdAfterSet(false);
                      setPasswordUserId(panelUser.id);
                    }}
                  >
                    <IconProfileKey />
                    <span className={styles.profileMenuLabel}>Set password</span>
                    <IconChevronRight />
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className={styles.profileMenuItem}
                    onClick={() => void revokeAllSessionsForUser(panelUser.id)}
                  >
                    <IconProfileLock />
                    <span className={styles.profileMenuLabel}>Revoke all sessions</span>
                    <IconChevronRight />
                  </button>
                </li>
                {panelUser.deletedAt ? (
                  <li>
                    <button
                      type="button"
                      className={styles.profileMenuItem}
                      onClick={() => void restoreUser(panelUser.id)}
                    >
                      <IconProfileUnlock />
                      <span className={styles.profileMenuLabel}>Restore account</span>
                      <IconChevronRight />
                    </button>
                  </li>
                ) : panelUser.id !== sessionUser.id ? (
                  <li>
                    <button
                      type="button"
                      className={`${styles.profileMenuItem} ${styles.profileMenuItemDanger}`}
                      onClick={() => void deleteUser(panelUser)}
                    >
                      <IconProfileTrash />
                      <span className={styles.profileMenuLabel}>Archive user</span>
                      <IconChevronRight />
                    </button>
                  </li>
                ) : null}
                {panelUser.deletedAt && panelUser.id !== sessionUser.id ? (
                  <li>
                    <button
                      type="button"
                      className={`${styles.profileMenuItem} ${styles.profileMenuItemDanger}`}
                      onClick={() => void hardEraseUser(panelUser)}
                    >
                      <IconProfileTrash />
                      <span className={styles.profileMenuLabel}>Erase permanently</span>
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
                <span>Temporary password (min 10 characters)</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={10}
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
                  Need a new one? <Link prefetch={false} href="/admin/departments">Departments</Link>
                </p>
              </label>
              <label>
                <span>
                  Employee badge {roleName === RoleNameApi.EMPLOYEE ? "(required for EMPLOYEE)" : "(optional)"}
                </span>
                <input
                  value={employeeBadgeNumber}
                  onChange={(e) => setEmployeeBadgeNumber(e.target.value)}
                  required={roleName === RoleNameApi.EMPLOYEE}
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
              <div style={{ gridColumn: "1 / -1" }}>
                <span style={{ fontWeight: 600, fontSize: "0.9rem", display: "block", marginBottom: "0.5rem" }}>
                  Profile photo
                </span>
                <button
                  type="button"
                  className={styles.profilePhotoBtn}
                  disabled={!!editUser.deletedAt}
                  onClick={() => {
                    setEditPhotoUrlDraft(editUser.profilePictureUrl ?? "");
                    setEditPhotoModalOpen(true);
                  }}
                >
                  Change photo
                </button>
                <ProfilePhotoModal
                  open={editPhotoModalOpen && !!editUser}
                  onClose={() => setEditPhotoModalOpen(false)}
                  mode="admin"
                  targetUserId={editUser.id}
                  displayName={editUser.name}
                  pictureUrl={editUser.profilePictureUrl}
                  pictureUrlDraft={editPhotoUrlDraft}
                  onPictureUrlDraftChange={setEditPhotoUrlDraft}
                  onPictureUpdated={(url) => bumpUserProfilePicture(editUser.id, url)}
                />
              </div>
              <label style={{ gridColumn: "1 / -1" }}>
                <span>Photo URL (optional, external https only)</span>
                <input
                  value={editUser.profilePictureUrl ?? ""}
                  onChange={(e) => setEditUser({ ...editUser, profilePictureUrl: e.target.value.trim() || null })}
                  placeholder="https://…"
                  disabled={!!editUser.deletedAt}
                />
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
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={editUser.mustChangePassword ?? false}
                  onChange={(e) => setEditUser({ ...editUser, mustChangePassword: e.target.checked })}
                />
                <span>Require password change on next sign-in</span>
              </label>
              <div className={styles.modalRestrictionSection}>
                <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Access controls</span>
                <p className={styles.hint} style={{ marginTop: "0.35rem" }}>
                  Saved with this form. Archived accounts must be restored before changing permissions here.
                </p>
                <div className={styles.modalRestrictionPills} role="group" aria-label="Edit permission toggles">
                  {RESTRICTION_PILLS.map(({ key, label, tooltip }) => {
                    const r = editUser.restrictions ?? DEFAULT_RESTRICTIONS;
                    const allowed = r[key];
                    const blockSelfLoginOff =
                      editUser.id === sessionUser.id && key === "loginAllowed" && allowed;
                    const archived = !!editUser.deletedAt;
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`${styles.restrictionPill} ${
                          allowed
                            ? styles.restrictionPillAllowed
                            : key === "loginAllowed"
                              ? styles.restrictionPillRestrictedWarn
                              : styles.restrictionPillRestricted
                        }`}
                        title={
                          archived
                            ? "Restore the account before editing permissions."
                            : blockSelfLoginOff
                              ? `${tooltip} You cannot remove your own login access here.`
                              : `${tooltip} Click to ${allowed ? "restrict" : "allow"}.`
                        }
                        disabled={archived || blockSelfLoginOff}
                        onClick={() => toggleEditRestriction(key, !allowed)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
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
            setForcePwdAfterSet(false);
          }}
        >
          <div className={styles.modalPanel} style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <h2>Set password</h2>
            <div className={styles.formGrid}>
              <label>
                <span>New password (min 10 characters)</span>
                <input
                  type="password"
                  value={passwordValue}
                  onChange={(e) => setPasswordValue(e.target.value)}
                  minLength={10}
                  autoComplete="new-password"
                />
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={forcePwdAfterSet}
                  onChange={(e) => setForcePwdAfterSet(e.target.checked)}
                />
                <span>Require password change on next sign-in</span>
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
                  setForcePwdAfterSet(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {importOpen ? (
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal
          aria-labelledby="import-users-title"
          onClick={() => {
            setImportOpen(false);
            setImportMessage(null);
          }}
        >
          <div className={styles.modalPanel} style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <h2 id="import-users-title">Import users (JSON)</h2>
            <p className={styles.hint}>
              POST body shape: <code>{"{ \"users\": [ ... ] }"}</code> or a raw array. Each row matches &quot;Add new
              user&quot; (email, password, name, role, departmentId; badge required for EMPLOYEE). Up to 50 rows per
              request.
            </p>
            <label style={{ display: "grid", gap: 6, marginTop: "0.75rem" }}>
              <span>JSON</span>
              <textarea
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                rows={10}
                style={{
                  width: "100%",
                  fontFamily: "ui-monospace, monospace",
                  fontSize: "0.82rem",
                  padding: "0.5rem",
                  border: "1px solid var(--border)",
                }}
                placeholder={`{\n  "users": [\n    {\n      "email": "user@company.com",\n      "password": "temporary-password",\n      "name": "Sample User",\n      "role": "EMPLOYEE",\n      "departmentId": "…uuid…",\n      "employeeBadgeNumber": "B123"\n    }\n  ]\n}`}
              />
            </label>
            {importMessage ? (
              <p role="status" style={{ marginTop: "0.65rem", color: "var(--text)", fontSize: "0.9rem" }}>
                {importMessage}
              </p>
            ) : null}
            <div className={styles.modalActions} style={{ marginTop: "1rem" }}>
              <button
                type="button"
                className={styles.btnPrimary}
                disabled={importBusy || !importJson.trim()}
                onClick={() => void submitImport()}
              >
                {importBusy ? "Importing…" : "Run import"}
              </button>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => {
                  setImportOpen(false);
                  setImportMessage(null);
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
