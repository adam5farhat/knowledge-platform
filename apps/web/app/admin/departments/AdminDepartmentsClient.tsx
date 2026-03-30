"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { fetchWithAuth, getValidAccessToken } from "../../../lib/authClient";
import type { UserRestrictionsDto } from "../../../lib/restrictions";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import { ProfileAvatarImage } from "@/components/ProfileAvatarImage";
import { ProfilePhotoUploader } from "@/components/ProfilePhotoUploader";
import { profilePictureDisplayUrl } from "@/lib/profilePicture";
import { AdminChromeHeader } from "../AdminChromeHeader";
import { useAdminGuard } from "../useAdminGuard";
import { AdminHubGlyph, type AdminHubGlyphType } from "../AdminHubIcons";
import dash from "../../components/shellNav.module.css";
import hubStyles from "../users/adminUsers.module.css";
import styles from "./adminDepartments.module.css";

function IconPlus() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
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

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type MemberPreview = { id: string; name: string; profilePictureUrl: string | null };
type DeptRow = {
  id: string;
  name: string;
  parentDepartmentId: string | null;
  memberPreview: MemberPreview[];
  memberCount: number;
};

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
};

type DocListRow = {
  id: string;
  title: string;
  latestVersion: { mimeType: string; fileName: string } | null;
};

type DocDetail = {
  id: string;
  title: string;
  description: string | null;
  visibility: string;
  departmentId: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string; email: string } | null;
  tags: string[];
  versions: {
    id: string;
    versionNumber: number;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    processingStatus: string;
    processingError?: string | null;
    createdAt: string;
  }[];
};

const DEFAULT_RESTRICTIONS: UserRestrictionsDto = {
  loginAllowed: true,
  accessDocumentsAllowed: true,
  manageDocumentsAllowed: true,
  accessDashboardAllowed: true,
  useAiQueriesAllowed: true,
};

const RESTRICTION_PILLS: { key: keyof UserRestrictionsDto; label: string; tooltip: string }[] = [
  { key: "loginAllowed", label: "Login access", tooltip: "Allow or block sign-in for this user." },
  { key: "accessDocumentsAllowed", label: "Access documents", tooltip: "Open the document library and view files." },
  { key: "manageDocumentsAllowed", label: "Manage documents", tooltip: "Upload and manage files (role limits still apply)." },
  { key: "accessDashboardAllowed", label: "Access dashboard", tooltip: "Open the main dashboard hub after sign-in." },
  { key: "useAiQueriesAllowed", label: "Use AI queries", tooltip: "Run semantic search over documents." },
];

function normalizeDept(d: Partial<DeptRow> & { id: string; name: string; parentDepartmentId: string | null }): DeptRow {
  return {
    id: d.id,
    name: d.name,
    parentDepartmentId: d.parentDepartmentId,
    memberPreview: d.memberPreview ?? [],
    memberCount: d.memberCount ?? 0,
  };
}

function normalizeUser(u: AdminUserRow): AdminUserRow {
  return {
    ...u,
    restrictions: u.restrictions ?? { ...DEFAULT_RESTRICTIONS },
    mustChangePassword: u.mustChangePassword ?? false,
    lastLoginAt: u.lastLoginAt ?? null,
    deletedAt: u.deletedAt ?? null,
  };
}

function parentLabel(depts: DeptRow[], parentId: string | null): string {
  if (!parentId) return "—";
  return depts.find((d) => d.id === parentId)?.name ?? parentId.slice(0, 8) + "…";
}

function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "—";
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function docVersionStatusPillClass(processingStatus: string): string {
  if (processingStatus === "READY") return styles.statusReady;
  if (processingStatus === "FAILED") return styles.statusFailed;
  if (processingStatus === "PENDING" || processingStatus === "PROCESSING") return styles.statusPending;
  return styles.statusOther;
}

function accountStatusLabel(u: AdminUserRow): string {
  if (u.deletedAt) return "Archived";
  return u.isActive ? "Active" : "Inactive";
}

type SessionUser = { id: string; name: string; email: string; role: string; profilePictureUrl?: string | null };

export default function AdminDepartmentsClient() {
  const router = useRouter();
  const pathname = usePathname();
  const { phase: authPhase, sessionUser: guardSession } = useAdminGuard();
  const [dataPhase, setDataPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [departments, setDepartments] = useState<DeptRow[]>([]);
  const [departmentName, setDepartmentName] = useState("");
  const [createParentId, setCreateParentId] = useState("");
  const [creatingDepartment, setCreatingDepartment] = useState(false);
  const [departmentError, setDepartmentError] = useState<string | null>(null);
  const [departmentSuccess, setDepartmentSuccess] = useState<string | null>(null);

  const [editDept, setEditDept] = useState<DeptRow | null>(null);
  const [mergeSource, setMergeSource] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeMsg, setMergeMsg] = useState<string | null>(null);
  const [mergeErr, setMergeErr] = useState<string | null>(null);

  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillUsers, setDrillUsers] = useState<AdminUserRow[]>([]);
  const [drillDocs, setDrillDocs] = useState<DocListRow[]>([]);

  const [cardMenuId, setCardMenuId] = useState<string | null>(null);
  const [panelUser, setPanelUser] = useState<AdminUserRow | null>(null);
  const [pillBusy, setPillBusy] = useState<string | null>(null);
  const [restrictionToast, setRestrictionToast] = useState<string | null>(null);

  const [panelDocId, setPanelDocId] = useState<string | null>(null);
  const [panelDocLoading, setPanelDocLoading] = useState(false);
  const [panelDocDetail, setPanelDocDetail] = useState<{
    document: DocDetail;
    canManage: boolean;
  } | null>(null);
  const [docForm, setDocForm] = useState({ title: "", description: "", visibility: "ALL", departmentId: "", tags: "" });
  const [docSaveBusy, setDocSaveBusy] = useState(false);
  const [docSaveMsg, setDocSaveMsg] = useState<string | null>(null);
  const [docPanelBusy, setDocPanelBusy] = useState(false);
  const [docPanelDownloadingId, setDocPanelDownloadingId] = useState<string | null>(null);
  const [docVersionUploadFile, setDocVersionUploadFile] = useState<File | null>(null);
  const [docPanelActionError, setDocPanelActionError] = useState<string | null>(null);
  const docVersionFileInputRef = useRef<HTMLInputElement | null>(null);

  const [passwordUserId, setPasswordUserId] = useState<string | null>(null);
  const [passwordValue, setPasswordValue] = useState("");
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createModalError, setCreateModalError] = useState<string | null>(null);
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

  const bumpUserProfilePicture = useCallback((userId: string, url: string | null) => {
    setDrillUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, profilePictureUrl: url } : u)));
    setPanelUser((p) => (p && p.id === userId ? { ...p, profilePictureUrl: url } : p));
    setSessionUser((s) => (s && s.id === userId ? { ...s, profilePictureUrl: url } : s));
    setDepartments((prev) =>
      prev.map((d) => ({
        ...d,
        memberPreview: d.memberPreview.map((m) => (m.id === userId ? { ...m, profilePictureUrl: url } : m)),
      })),
    );
  }, []);

  const reload = useCallback(async () => {
    const dr = await fetchWithAuth(`${API}/admin/departments`);
    if (!dr.ok) return false;
    const dJson = (await dr.json().catch(() => ({}))) as { departments?: DeptRow[] };
    if (!Array.isArray(dJson.departments)) return false;
    setDepartments(dJson.departments.map((x) => normalizeDept(x)));
    return true;
  }, []);

  const selectedDept = selectedDeptId ? departments.find((d) => d.id === selectedDeptId) ?? null : null;

  useEffect(() => {
    if (selectedDeptId && !departments.some((d) => d.id === selectedDeptId)) {
      setSelectedDeptId(null);
      setDrillUsers([]);
      setDrillDocs([]);
    }
  }, [departments, selectedDeptId]);

  useEffect(() => {
    if (authPhase !== "ready") {
      setDataPhase("idle");
      return;
    }
    let cancelled = false;
    setDataPhase("loading");
    void (async () => {
      try {
        const ok = await reload();
        if (!cancelled) setDataPhase(ok ? "ready" : "error");
      } catch {
        if (!cancelled) setDataPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authPhase, reload]);

  useEffect(() => {
    if (!restrictionToast) return;
    const id = window.setTimeout(() => setRestrictionToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [restrictionToast]);

  useEffect(() => {
    if (!panelDocId) {
      setDocVersionUploadFile(null);
      setDocPanelActionError(null);
      setDocPanelBusy(false);
      setDocPanelDownloadingId(null);
    }
  }, [panelDocId]);

  async function fetchDrillForDept(deptId: string) {
    setDrillLoading(true);
    try {
      const deptMeta = departments.find((d) => d.id === deptId);
      const generalLibraryUnion =
        deptMeta && deptMeta.name.trim().toLowerCase() === "general" ? "&unionGeneralLibrary=1" : "";
      const [ur, dr] = await Promise.all([
        fetchWithAuth(`${API}/admin/users?departmentId=${encodeURIComponent(deptId)}&pageSize=500&page=1`),
        fetchWithAuth(
          `${API}/documents?libraryScope=ALL&departmentId=${encodeURIComponent(deptId)}&pageSize=500&page=1${generalLibraryUnion}`,
        ),
      ]);
      if (ur.ok) {
        const uj = (await ur.json().catch(() => ({}))) as { users?: AdminUserRow[] };
        setDrillUsers(Array.isArray(uj.users) ? uj.users.map((u) => normalizeUser(u)) : []);
      } else {
        setDrillUsers([]);
      }
      if (dr.ok) {
        const dj = (await dr.json().catch(() => ({}))) as { documents?: DocListRow[] };
        setDrillDocs(Array.isArray(dj.documents) ? dj.documents : []);
      } else {
        setDrillDocs([]);
      }
    } catch {
      setDrillUsers([]);
      setDrillDocs([]);
    } finally {
      setDrillLoading(false);
    }
  }

  async function loadDrill(dept: DeptRow) {
    if (selectedDeptId === dept.id) {
      setSelectedDeptId(null);
      setDrillUsers([]);
      setDrillDocs([]);
      setPanelUser(null);
      setPanelDocId(null);
      setPanelDocDetail(null);
      return;
    }
    setSelectedDeptId(dept.id);
    setPanelUser(null);
    setPanelDocId(null);
    setPanelDocDetail(null);
    await fetchDrillForDept(dept.id);
  }

  async function openDocPanel(id: string) {
    setPanelUser(null);
    setPanelDocId(id);
    setPanelDocLoading(true);
    setPanelDocDetail(null);
    setDocSaveMsg(null);
    setDocPanelActionError(null);
    try {
      const res = await fetchWithAuth(`${API}/documents/${id}`);
      const data = (await res.json().catch(() => ({}))) as {
        document?: DocDetail;
        canManage?: boolean;
        error?: string;
      };
      if (!res.ok || !data.document) {
        setPanelDocDetail(null);
        return;
      }
      setPanelDocDetail({ document: data.document, canManage: !!data.canManage });
      setDocForm({
        title: data.document.title,
        description: data.document.description ?? "",
        visibility: data.document.visibility,
        departmentId: data.document.departmentId ?? "",
        tags: data.document.tags.join(", "),
      });
    } catch {
      setPanelDocDetail(null);
    } finally {
      setPanelDocLoading(false);
    }
  }

  async function docPanelDownload(versionId: string, fileName: string) {
    if (!panelDocId) return;
    setDocPanelDownloadingId(versionId);
    setDocPanelActionError(null);
    try {
      const res = await fetchWithAuth(`${API}/documents/${panelDocId}/versions/${versionId}/file`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setDocPanelActionError(body.error ?? "Download failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setDocPanelActionError("Could not download file.");
    } finally {
      setDocPanelDownloadingId(null);
    }
  }

  async function docPanelRetryVersion(versionId: string) {
    if (!panelDocId || !panelDocDetail?.canManage) return;
    setDocPanelBusy(true);
    setDocPanelActionError(null);
    try {
      const res = await fetchWithAuth(`${API}/documents/${panelDocId}/versions/${versionId}/reprocess`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setDocPanelActionError(body.error ?? "Retry failed");
        return;
      }
      await openDocPanel(panelDocId);
      if (selectedDeptId) void fetchDrillForDept(selectedDeptId);
    } catch {
      setDocPanelActionError("Could not reach the API.");
    } finally {
      setDocPanelBusy(false);
    }
  }

  async function docPanelUploadVersion(e: React.FormEvent) {
    e.preventDefault();
    if (!panelDocId || !docVersionUploadFile || !panelDocDetail?.canManage) return;
    setDocPanelBusy(true);
    setDocPanelActionError(null);
    try {
      const fd = new FormData();
      fd.append("file", docVersionUploadFile);
      const res = await fetchWithAuth(`${API}/documents/${panelDocId}/versions`, {
        method: "POST",
        body: fd,
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setDocPanelActionError(body.error ?? "Upload failed");
        return;
      }
      setDocVersionUploadFile(null);
      if (docVersionFileInputRef.current) docVersionFileInputRef.current.value = "";
      await openDocPanel(panelDocId);
      if (selectedDeptId) void fetchDrillForDept(selectedDeptId);
    } catch {
      setDocPanelActionError("Could not reach the API.");
    } finally {
      setDocPanelBusy(false);
    }
  }

  async function saveDocForm() {
    if (!panelDocId || !panelDocDetail?.canManage) return;
    setDocSaveBusy(true);
    setDocSaveMsg(null);
    try {
      const tags = docForm.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const body: Record<string, unknown> = {
        title: docForm.title.trim(),
        description: docForm.description.trim() || null,
        visibility: docForm.visibility,
        tags,
      };
      if (docForm.visibility === "DEPARTMENT") {
        body.departmentId = docForm.departmentId || null;
      }
      const res = await fetchWithAuth(`${API}/documents/${panelDocId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setDocSaveMsg(err.error ?? "Save failed.");
        return;
      }
      setDocSaveMsg("Saved.");
      void openDocPanel(panelDocId);
      if (selectedDeptId) void fetchDrillForDept(selectedDeptId);
    } catch {
      setDocSaveMsg("Could not reach the API.");
    } finally {
      setDocSaveBusy(false);
    }
  }

  async function setRestrictionForPanel(key: keyof UserRestrictionsDto, value: boolean) {
    if (!panelUser?.restrictions) return;
    if (panelUser.id === sessionUser?.id && key === "loginAllowed" && !value) {
      window.alert("You cannot disable login for your own account.");
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
        window.alert(data.error ?? "Update failed.");
        return;
      }
      if (data.user) {
        const nu = normalizeUser(data.user);
        setPanelUser(nu);
        setDrillUsers((rows) => rows.map((r) => (r.id === nu.id ? nu : r)));
      }
      setRestrictionToast(value ? "Permission enabled" : "Restriction applied");
    } catch {
      window.alert("Could not reach the API.");
    } finally {
      setPillBusy(null);
    }
  }

  async function resetRestrictionsForPanel() {
    if (!panelUser) return;
    setPillBusy("reset");
    setRestrictionToast(null);
    try {
      const res = await fetchWithAuth(`${API}/admin/users/${panelUser.id}/reset-restrictions`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; user?: AdminUserRow };
      if (!res.ok) {
        window.alert(data.error ?? "Reset failed.");
        return;
      }
      if (data.user) {
        const nu = normalizeUser(data.user);
        setPanelUser(nu);
        setDrillUsers((rows) => rows.map((r) => (r.id === nu.id ? nu : r)));
      }
      setRestrictionToast("All permissions reset to allowed");
    } catch {
      window.alert("Could not reach the API.");
    } finally {
      setPillBusy(null);
    }
  }

  async function unlockUser(id: string) {
    const res = await fetchWithAuth(`${API}/admin/users/${id}/unlock`, { method: "POST" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      window.alert(data.error ?? "Unlock failed.");
      return;
    }
    if (panelUser?.id === id) {
      const deptId = panelUser.department.id;
      const r = await fetchWithAuth(`${API}/admin/users?departmentId=${encodeURIComponent(deptId)}&pageSize=500&page=1`);
      const j = (await r.json().catch(() => ({}))) as { users?: AdminUserRow[] };
      const u = j.users?.find((x) => x.id === id);
      if (u) setPanelUser(normalizeUser(u));
    }
    if (selectedDeptId) void fetchDrillForDept(selectedDeptId);
  }

  async function lockUser(id: string) {
    const res = await fetchWithAuth(`${API}/admin/users/${id}/lock`, { method: "POST" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      window.alert(data.error ?? "Lock failed.");
      return;
    }
    if (selectedDeptId) void fetchDrillForDept(selectedDeptId);
  }

  async function revokeSessions(id: string) {
    if (!window.confirm("Revoke every session for this user? They must sign in again on all devices.")) return;
    const res = await fetchWithAuth(`${API}/admin/users/${id}/revoke-sessions`, { method: "POST" });
    if (res.status !== 204) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      window.alert(data.error ?? "Failed.");
    }
  }

  async function deleteUserArchive(u: AdminUserRow) {
    if (
      !window.confirm(
        `Archive ${u.email}? They will be hidden from the directory and signed out.`,
      )
    )
      return;
    const res = await fetchWithAuth(`${API}/admin/users/${u.id}`, { method: "DELETE" });
    if (res.status === 204) {
      setPanelUser(null);
      void reload();
      if (selectedDeptId) void fetchDrillForDept(selectedDeptId);
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    window.alert(data.error ?? "Archive failed.");
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
      if (selectedDeptId) void fetchDrillForDept(selectedDeptId);
    } catch {
      setModalError("Could not reach the API.");
    } finally {
      setModalBusy(false);
    }
  }

  async function onCreateDepartment(e: React.FormEvent) {
    e.preventDefault();
    const authToken = await getValidAccessToken();
    if (!authToken) {
      setCreateModalError("Not signed in. Please sign in again.");
      router.replace("/login");
      return;
    }
    setCreateModalError(null);
    const trimmedName = departmentName.trim();
    if (!trimmedName) {
      setCreateModalError("Department name is required.");
      return;
    }
    setCreatingDepartment(true);
    try {
      const body: { name: string; parentDepartmentId?: string | null } = { name: trimmedName };
      if (createParentId) body.parentDepartmentId = createParentId;
      const res = await fetchWithAuth(`${API}/admin/departments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; department?: DeptRow };
      if (!res.ok || !data.department) {
        setCreateModalError(data.error ?? "Could not create department.");
        return;
      }
      const row = normalizeDept({ ...data.department, memberPreview: [], memberCount: 0 });
      setDepartments((prev) => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)));
      setDepartmentName("");
      setCreateParentId("");
      setCreateOpen(false);
      setDepartmentSuccess(`Department "${row.name}" created.`);
    } catch {
      setCreateModalError("Could not reach the API.");
    } finally {
      setCreatingDepartment(false);
    }
  }

  async function saveEdit() {
    if (!editDept) return;
    setDepartmentError(null);
    const res = await fetchWithAuth(`${API}/admin/departments/${editDept.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editDept.name.trim(),
        parentDepartmentId: editDept.parentDepartmentId,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; department?: DeptRow };
    if (!res.ok || !data.department) {
      setDepartmentError(data.error ?? "Could not update department.");
      return;
    }
    const prev = departments.find((d) => d.id === editDept.id);
    const merged = normalizeDept({
      ...data.department,
      memberPreview: prev?.memberPreview ?? [],
      memberCount: prev?.memberCount ?? 0,
    });
    setEditDept(null);
    setDepartments((prev) => prev.map((d) => (d.id === merged.id ? merged : d)).sort((a, b) => a.name.localeCompare(b.name)));
    setDepartmentSuccess("Department updated.");
  }

  async function deleteDept(d: DeptRow) {
    if (!window.confirm(`Delete "${d.name}"? Only allowed when it has no users, documents, or child departments.`)) return;
    const res = await fetchWithAuth(`${API}/admin/departments/${d.id}`, { method: "DELETE" });
    if (res.status === 204) {
      setDepartments((prev) => prev.filter((x) => x.id !== d.id));
      if (selectedDeptId === d.id) {
        setSelectedDeptId(null);
        setDrillUsers([]);
        setDrillDocs([]);
      }
      setDepartmentSuccess(`Removed "${d.name}".`);
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    window.alert(data.error ?? "Delete failed.");
  }

  async function onMerge() {
    setMergeErr(null);
    setMergeMsg(null);
    if (!mergeSource || !mergeTarget || mergeSource === mergeTarget) {
      setMergeErr("Pick two different departments.");
      return;
    }
    if (!window.confirm("Merge source into target? Users and documents move to the target; the source is removed.")) return;
    setMergeBusy(true);
    try {
      const res = await fetchWithAuth(`${API}/admin/departments/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceDepartmentId: mergeSource, targetDepartmentId: mergeTarget }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; mergedInto?: { name: string } };
      if (!res.ok) {
        setMergeErr(data.error ?? "Merge failed.");
        return;
      }
      setMergeMsg(`Merged into ${data.mergedInto?.name ?? "target"}.`);
      setMergeSource("");
      setSelectedDeptId(null);
      setDrillUsers([]);
      setDrillDocs([]);
      await reload();
    } catch {
      setMergeErr("Could not reach the API.");
    } finally {
      setMergeBusy(false);
    }
  }

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const el = e.target as HTMLElement | null;
      if (!el?.closest("[data-dept-card-menu]")) setCardMenuId(null);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  useEffect(() => {
    if (!departmentSuccess) return;
    const id = window.setTimeout(() => setDepartmentSuccess(null), 6500);
    return () => window.clearTimeout(id);
  }, [departmentSuccess]);

  if (authPhase === "checking") {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }

  if (authPhase === "need-login") {
    return (
      <main style={{ maxWidth: 520 }}>
        <h1>Departments</h1>
        <p style={{ color: "#52525b" }}>You need to sign in to access this page.</p>
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
      <main style={{ maxWidth: 520 }}>
        <h1>Departments</h1>
        <p style={{ color: "var(--error)" }}>Only administrators can manage departments.</p>
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
      <main style={{ maxWidth: 520 }}>
        <h1>Departments</h1>
        <p style={{ color: "var(--error)" }}>Could not verify access.</p>
        <p style={{ marginTop: "1rem" }}>
          <Link href="/login">Sign in</Link>
          {" · "}
          <Link prefetch={false} href="/admin">Admin hub</Link>
        </p>
      </main>
    );
  }

  if (authPhase === "ready" && dataPhase === "error") {
    return (
      <main>
        <p style={{ color: "var(--error)" }}>Could not load departments.</p>
        <Link prefetch={false} href="/dashboard">Dashboard</Link>
      </main>
    );
  }

  if (authPhase === "ready" && dataPhase !== "ready") {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }

  if (!sessionUser) {
    return (
      <main className={hubStyles.shell}>
        <p style={{ padding: "1rem" }}>Loading…</p>
      </main>
    );
  }

  return (
    <main className={hubStyles.shell} data-dashboard-fullscreen="true">
      <AdminChromeHeader user={sessionUser} className={`${dash.navbar} ${hubStyles.navbarRow}`} />

      <div className={hubStyles.adminBody}>
        <aside className={hubStyles.adminSidebar} aria-label="Admin sections">
          {ADMIN_SIDEBAR_LINKS.map(({ href, label, icon }) => {
            const active = adminNavActive(href, pathname ?? "");
            return (
              <Link
                key={href}
                href={href}
                className={active ? `${hubStyles.sidebarLink} ${hubStyles.sidebarLinkActive}` : hubStyles.sidebarLink}
                aria-current={active ? "page" : undefined}
              >
                <AdminHubGlyph type={icon} className={hubStyles.sidebarIcon} />
                <span className={hubStyles.sidebarLabel}>{label}</span>
              </Link>
            );
          })}
        </aside>

        <div className={hubStyles.main}>
          <div className={hubStyles.pageHead}>
            <div>
              <h1 className={styles.pageTitle}>Departments</h1>
              <p className={styles.pageSubtitle}>
                Org hierarchy, member previews, and documents per department — aligned with the rest of admin.
              </p>
            </div>
            <button
              type="button"
              className={hubStyles.addButton}
              onClick={() => {
                setCreateModalError(null);
                setCreateOpen(true);
              }}
            >
              <IconPlus />
              Add department
            </button>
          </div>

          {departmentSuccess ? (
            <div className={styles.toastOk} role="status">
              {departmentSuccess}
            </div>
          ) : null}

          <div className={styles.stack}>
            <div className={hubStyles.tableCard}>
              <div className={hubStyles.cardToolbar}>
                <h2 className={hubStyles.cardToolbarTitle}>Merge departments</h2>
              </div>
              <div className={styles.cardBody}>
                <p className={styles.hintText}>
                  Moves all users and documents from the source into the target, then deletes the source. The source must
                  not have child departments.
                </p>
                <div className={styles.mergeRow}>
                  <select
                    className={styles.mergeSelect}
                    value={mergeSource}
                    onChange={(e) => setMergeSource(e.target.value)}
                    aria-label="Source department"
                  >
                    <option value="">Source…</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  <span className={styles.mergeArrow} aria-hidden>
                    →
                  </span>
                  <select
                    className={styles.mergeSelect}
                    value={mergeTarget}
                    onChange={(e) => setMergeTarget(e.target.value)}
                    aria-label="Target department"
                  >
                    <option value="">Target…</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" disabled={mergeBusy} onClick={() => void onMerge()} className={hubStyles.btnGhost}>
                    {mergeBusy ? "Merging…" : "Merge"}
                  </button>
                </div>
                {mergeErr ? <p className={styles.toastErr}>{mergeErr}</p> : null}
                {mergeMsg ? (
                  <p role="status" style={{ margin: "0.75rem 0 0", color: "#15803d", fontSize: "0.88rem" }}>
                    {mergeMsg}
                  </p>
                ) : null}
              </div>
            </div>

            <div className={hubStyles.tableCard}>
              <div className={hubStyles.cardToolbar}>
                <h2 className={hubStyles.cardToolbarTitle}>All departments</h2>
              </div>
              <div className={styles.cardBody}>
                <p className={styles.hintText}>
                  Click a card to open users and documents. Use ··· on a card for edit or delete. Click the same card again
                  to collapse.
                </p>
                {departments.length === 0 ? (
                  <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.9rem" }}>No departments yet. Add one to get started.</p>
                ) : (
                  <div className={styles.cardGrid}>
            {departments.map((d) => {
              const selected = selectedDeptId === d.id;
              const extra = Math.max(0, d.memberCount - d.memberPreview.length);
              return (
                <div key={d.id} className={`${styles.deptCard} ${selected ? styles.deptCardSelected : ""}`}>
                  <span className={styles.deptCardTab} aria-hidden />
                  <div className={styles.deptCardMenuWrap} data-dept-card-menu>
                    <button
                      type="button"
                      className={styles.deptCardMenuBtn}
                      aria-expanded={cardMenuId === d.id}
                      aria-label={`Menu for ${d.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setCardMenuId((id) => (id === d.id ? null : d.id));
                      }}
                    >
                      ···
                    </button>
                    {cardMenuId === d.id ? (
                      <div className={styles.deptCardMenu} role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCardMenuId(null);
                            setEditDept({ ...d });
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={styles.deptCardMenuDanger}
                          role="menuitem"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCardMenuId(null);
                            void deleteDept(d);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <button type="button" className={styles.deptCardBody} onClick={() => void loadDrill(d)}>
                    <p className={styles.deptLabel}>Department</p>
                    <div className={styles.avatarRow}>
                      <div className={styles.avatarStack}>
                        {d.memberPreview.length === 0 ? (
                          <span style={{ fontSize: "0.82rem", color: "#a1a1aa" }}>No members yet</span>
                        ) : (
                          d.memberPreview.map((m) => {
                            const src = profilePictureDisplayUrl(m.profilePictureUrl);
                            return src ? (
                              <ProfileAvatarImage
                                key={m.id}
                                className={styles.avatarMini}
                                src={src}
                                alt=""
                                width={34}
                                height={34}
                                sizes="34px"
                                title={m.name}
                              />
                            ) : (
                              <span
                                key={m.id}
                                className={`${styles.avatarMini} ${styles.avatarFallbackMini}`}
                                title={m.name}
                              >
                                {userInitials(m.name)}
                              </span>
                            );
                          })
                        )}
                      </div>
                      {extra > 0 ? <span className={styles.avatarOverflow}>+{extra}</span> : null}
                    </div>
                    <p className={styles.deptName}>{d.name}</p>
                    {d.parentDepartmentId ? (
                      <p style={{ margin: "0.35rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
                        Under {parentLabel(departments, d.parentDepartmentId)}
                      </p>
                    ) : null}
                  </button>
                </div>
              );
            })}
                  </div>
                )}
              </div>
            </div>

            {selectedDept ? (
              <div className={hubStyles.tableCard}>
                <div className={hubStyles.cardToolbar}>
                  <div>
                    <h2 className={hubStyles.cardToolbarTitle}>{selectedDept.name}</h2>
                    <p style={{ margin: "0.2rem 0 0", fontSize: "0.82rem", color: "var(--muted)", fontWeight: 400 }}>
                      {drillUsers.length} user{drillUsers.length === 1 ? "" : "s"} · {drillDocs.length} document
                      {drillDocs.length === 1 ? "" : "s"}
                      {drillLoading ? " · Loading…" : ""}
                    </p>
                  </div>
                  <div className={styles.drillActions}>
                    <button type="button" className={hubStyles.btnGhost} onClick={() => setEditDept({ ...selectedDept })}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className={`${hubStyles.btnGhost} ${styles.btnDangerGhost}`}
                      onClick={() => void deleteDept(selectedDept)}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      className={hubStyles.btnGhost}
                      onClick={() => {
                        setSelectedDeptId(null);
                        setDrillUsers([]);
                        setDrillDocs([]);
                      }}
                    >
                      Close
                    </button>
                  </div>
                </div>
                <div className={styles.drillSectionInner}>
                  <div className={styles.drillGrid}>
            <div className={styles.drillPanel}>
              <div className={styles.drillPanelHead}>
                <span>Users</span>
                <Link prefetch={false} href="/admin/users" className={styles.drillLink}>
                  Users admin
                </Link>
              </div>
              <div className={styles.listScroll}>
                {drillUsers.length === 0 && !drillLoading ? (
                  <p style={{ padding: "0.75rem 0.85rem", margin: 0, color: "#a1a1aa", fontSize: "0.88rem" }}>
                    No users in this department.
                  </p>
                ) : (
                  drillUsers.map((u) => {
                    const photoSrc = profilePictureDisplayUrl(u.profilePictureUrl);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        className={`${styles.listRow} ${panelUser?.id === u.id ? styles.listRowSelected : ""}`}
                        onClick={() => {
                          setPanelDocId(null);
                          setPanelDocDetail(null);
                          setPanelUser(normalizeUser(u));
                        }}
                      >
                        <div className={`${styles.rowThumb} ${styles.rowThumbUser}`}>
                          {photoSrc ? (
                            <ProfileAvatarImage src={photoSrc} alt="" width={36} height={36} sizes="36px" />
                          ) : (
                            <span className={styles.avatarFallbackMini} style={{ width: "100%", height: "100%" }}>
                              {userInitials(u.name)}
                            </span>
                          )}
                        </div>
                        <span className={styles.rowName}>{u.name}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            <div className={styles.drillPanel}>
              <div className={styles.drillPanelHead}>
                <span>Documents</span>
                <Link prefetch={false} href="/admin/documents" className={styles.drillLink}>
                  Document tools
                </Link>
              </div>
              <div className={styles.listScroll}>
                {drillDocs.length === 0 && !drillLoading ? (
                  <p style={{ padding: "0.75rem 0.85rem", margin: 0, color: "#a1a1aa", fontSize: "0.88rem" }}>
                    No documents in this department.
                  </p>
                ) : (
                  drillDocs.map((doc) => {
                    const lv = doc.latestVersion;
                    const fileName = lv?.fileName ?? doc.title;
                    return (
                      <button
                        key={doc.id}
                        type="button"
                        className={`${styles.listRow} ${panelDocId === doc.id ? styles.listRowSelected : ""}`}
                        onClick={() => void openDocPanel(doc.id)}
                      >
                        <div className={styles.rowThumbFile} aria-hidden>
                          <FileTypeIcon fileName={fileName} variant="row" />
                        </div>
                        <span className={styles.rowName}>{doc.title}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {createOpen ? (
        <div
          className={hubStyles.modalOverlay}
          role="dialog"
          aria-modal
          aria-labelledby="create-dept-title"
          onClick={() => {
            setCreateOpen(false);
            setCreateModalError(null);
          }}
        >
          <div className={hubStyles.modalPanel} onClick={(e) => e.stopPropagation()}>
            <h2 id="create-dept-title">Add department</h2>
            <p className={hubStyles.hint}>Creates a new department. Optionally place it under an existing parent.</p>
            <form
              className={hubStyles.formGrid}
              onSubmit={(e) => {
                void onCreateDepartment(e);
              }}
            >
              <label>
                <span>Name</span>
                <input
                  value={departmentName}
                  onChange={(e) => setDepartmentName(e.target.value)}
                  maxLength={200}
                  required
                  autoComplete="off"
                />
              </label>
              <label>
                <span>Parent (optional)</span>
                <select value={createParentId} onChange={(e) => setCreateParentId(e.target.value)}>
                  <option value="">None (top level)</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              {createModalError ? (
                <p role="alert" style={{ color: "var(--error)", margin: 0 }}>
                  {createModalError}
                </p>
              ) : null}
              <div className={hubStyles.modalActions}>
                <button type="submit" disabled={creatingDepartment} className={hubStyles.btnPrimary}>
                  {creatingDepartment ? "Creating…" : "Create department"}
                </button>
                <button
                  type="button"
                  className={hubStyles.btnGhost}
                  onClick={() => {
                    setCreateOpen(false);
                    setCreateModalError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {panelUser ? (
        <>
          <div className={hubStyles.detailBackdrop} aria-hidden onClick={() => setPanelUser(null)} />
          <div className={hubStyles.detailPanel} role="dialog" aria-modal aria-labelledby="dept-user-drawer-title">
            <div className={hubStyles.detailPanelInner}>
              <header className={hubStyles.profileTopBar}>
                <button
                  type="button"
                  className={hubStyles.profileBackBtn}
                  aria-label="Close"
                  onClick={() => setPanelUser(null)}
                >
                  ←
                </button>
                <h2 id="dept-user-drawer-title" className={hubStyles.profileTopTitle}>
                  User
                </h2>
                <span className={hubStyles.profileTopSpacer} aria-hidden />
              </header>
              <div className={hubStyles.profileHero}>
                <div className={hubStyles.profileAvatarRing}>
                  {profilePictureDisplayUrl(panelUser.profilePictureUrl) ? (
                    <ProfileAvatarImage
                      className={hubStyles.profileAvatarImg}
                      src={profilePictureDisplayUrl(panelUser.profilePictureUrl)!}
                      alt=""
                      width={88}
                      height={88}
                      sizes="88px"
                    />
                  ) : (
                    <span className={hubStyles.profileAvatarFallback} aria-hidden>
                      {userInitials(panelUser.name)}
                    </span>
                  )}
                </div>
                <h3 className={hubStyles.profileName}>{panelUser.name}</h3>
                <p className={hubStyles.profileEmail}>{panelUser.email}</p>
                <p className={hubStyles.profileJoined}>Joined {fmtDateTime(panelUser.createdAt)}</p>
                <p className={hubStyles.profileJoined} style={{ marginTop: "0.15rem" }}>
                  Last sign-in {fmtDateTime(panelUser.lastLoginAt)}
                </p>
                {!panelUser.deletedAt ? (
                  <div style={{ marginTop: "0.85rem", width: "100%", maxWidth: 320 }}>
                    <ProfilePhotoUploader
                      mode="admin"
                      targetUserId={panelUser.id}
                      displayName={panelUser.name}
                      pictureUrl={panelUser.profilePictureUrl}
                      compact
                      onPictureUpdated={(url) => bumpUserProfilePicture(panelUser.id, url)}
                    />
                  </div>
                ) : null}
                <Link prefetch={false} href="/admin/users" className={hubStyles.profileEditCta} style={{ textDecoration: "none", textAlign: "center" }}>
                  Open in Users directory
                </Link>
              </div>
              <div className={hubStyles.profileFieldsCard}>
                <div className={hubStyles.profileField}>
                  <span className={hubStyles.profileFieldLabel}>Department</span>
                  <div className={hubStyles.profileFieldBox}>{panelUser.department.name}</div>
                </div>
                <div className={hubStyles.profileField}>
                  <span className={hubStyles.profileFieldLabel}>Role</span>
                  <div className={hubStyles.profileFieldBox}>{panelUser.role}</div>
                </div>
                <div className={hubStyles.profileField}>
                  <span className={hubStyles.profileFieldLabel}>Account</span>
                  <div className={hubStyles.profileFieldBox}>{accountStatusLabel(panelUser)}</div>
                </div>
                <div className={hubStyles.profileField}>
                  <span className={hubStyles.profileFieldLabel}>Must change password</span>
                  <div className={hubStyles.profileFieldBox}>{panelUser.mustChangePassword ? "Yes" : "No"}</div>
                </div>
                <div className={hubStyles.profileField}>
                  <span className={hubStyles.profileFieldLabel}>Sign-in lock</span>
                  <div className={hubStyles.profileFieldBox}>
                    {panelUser.loginLockedUntil || panelUser.failedLoginAttempts > 0
                      ? `${panelUser.failedLoginAttempts > 0 ? `${panelUser.failedLoginAttempts} failed attempts` : "Locked"}${panelUser.loginLockedUntil ? ` · until ${fmtDateTime(panelUser.loginLockedUntil)}` : ""}`
                      : "Not locked"}
                  </div>
                </div>
              </div>
              <div className={hubStyles.restrictionSection}>
                <h4 className={hubStyles.restrictionSectionTitle}>Access controls</h4>
                <p style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", lineHeight: 1.45, color: "#71717a" }}>
                  Same controls as the Users page. Changes apply immediately.
                </p>
                <div className={hubStyles.restrictionPills} role="group">
                  {RESTRICTION_PILLS.map(({ key, label, tooltip }) => {
                    const r = panelUser.restrictions ?? DEFAULT_RESTRICTIONS;
                    const allowed = r[key];
                    const busy = pillBusy === key || pillBusy === "reset";
                    const blockSelf = panelUser.id === sessionUser?.id && key === "loginAllowed" && allowed;
                    const archived = !!panelUser.deletedAt;
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`${hubStyles.restrictionPill} ${
                          allowed
                            ? hubStyles.restrictionPillAllowed
                            : key === "loginAllowed"
                              ? hubStyles.restrictionPillRestrictedWarn
                              : hubStyles.restrictionPillRestricted
                        }`}
                        title={
                          archived
                            ? "Restore this user in Users to change permissions."
                            : blockSelf
                              ? "You cannot remove your own login access here."
                              : tooltip
                        }
                        disabled={busy || blockSelf || archived}
                        onClick={() => void setRestrictionForPanel(key, !allowed)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className={hubStyles.restrictionResetBtn}
                  disabled={pillBusy !== null || !!panelUser.deletedAt}
                  onClick={() => void resetRestrictionsForPanel()}
                >
                  Reset permissions
                </button>
                {restrictionToast ? (
                  <div className={hubStyles.restrictionToast} role="status">
                    {restrictionToast}
                  </div>
                ) : (
                  <div className={hubStyles.restrictionToast} aria-hidden />
                )}
              </div>
              <ul className={hubStyles.profileMenu} role="list">
                {panelUser.id !== sessionUser?.id ? (
                  <li>
                    <button type="button" className={hubStyles.profileMenuItem} onClick={() => void lockUser(panelUser.id)}>
                      <span className={hubStyles.profileMenuLabel}>Lock sign-in (7 days)</span>
                    </button>
                  </li>
                ) : null}
                <li>
                  <button type="button" className={hubStyles.profileMenuItem} onClick={() => void unlockUser(panelUser.id)}>
                    <span className={hubStyles.profileMenuLabel}>Unlock sign-in</span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className={hubStyles.profileMenuItem}
                    onClick={() => {
                      setModalError(null);
                      setPasswordValue("");
                      setPasswordUserId(panelUser.id);
                    }}
                  >
                    <span className={hubStyles.profileMenuLabel}>Set password</span>
                  </button>
                </li>
                <li>
                  <button type="button" className={hubStyles.profileMenuItem} onClick={() => void revokeSessions(panelUser.id)}>
                    <span className={hubStyles.profileMenuLabel}>Revoke all sessions</span>
                  </button>
                </li>
                {panelUser.id !== sessionUser?.id ? (
                  <li>
                    <button
                      type="button"
                      className={`${hubStyles.profileMenuItem} ${hubStyles.profileMenuItemDanger}`}
                      onClick={() => void deleteUserArchive(panelUser)}
                    >
                      <span className={hubStyles.profileMenuLabel}>Archive user</span>
                    </button>
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        </>
      ) : null}

      {panelDocId ? (
        <>
          <div className={styles.detailBackdrop} aria-hidden onClick={() => setPanelDocId(null)} />
          <div className={styles.detailPanel} role="dialog" aria-modal aria-labelledby="dept-doc-drawer-title">
            <div className={styles.detailPanelInner}>
              <header className={hubStyles.profileTopBar}>
                <button
                  type="button"
                  className={hubStyles.profileBackBtn}
                  aria-label="Close"
                  onClick={() => setPanelDocId(null)}
                >
                  ←
                </button>
                <h2 id="dept-doc-drawer-title" className={hubStyles.profileTopTitle}>
                  Document details
                </h2>
                <span className={hubStyles.profileTopSpacer} aria-hidden />
              </header>
              {panelDocLoading ? (
                <p style={{ padding: "1rem" }}>Loading…</p>
              ) : !panelDocDetail ? (
                <p style={{ padding: "1rem", color: "var(--error)" }}>Could not load document.</p>
              ) : (
                <>
                  {panelDocDetail.document.versions[0] ? (
                    <div className={styles.docDrawerHero}>
                      <FileTypeIcon fileName={panelDocDetail.document.versions[0].fileName} variant="row" />
                      <div className={styles.docDrawerHeroMain}>
                        <h3 className={styles.docDrawerTitle}>{panelDocDetail.document.title}</h3>
                        <p className={hubStyles.profileEmail} style={{ margin: 0 }}>
                          Latest: {panelDocDetail.document.versions[0].fileName}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.docDrawerHero}>
                      <div className={styles.docDrawerHeroMain}>
                        <h3 className={styles.docDrawerTitle}>{panelDocDetail.document.title}</h3>
                        <p className={hubStyles.profileEmail} style={{ margin: 0 }}>
                          No file versions yet.
                        </p>
                      </div>
                    </div>
                  )}
                  <div className={styles.docDrawerLinks}>
                    <Link
                      href={`/documents/${panelDocId}`}
                      className={styles.docDrawerLink}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open full page
                    </Link>
                    <Link prefetch={false} href="/documents" className={styles.docDrawerLink}>
                      Document library
                    </Link>
                  </div>
                  <div className={styles.docMetaRow}>
                    <span
                      className={
                        panelDocDetail.document.isArchived
                          ? `${styles.docMetaPill} ${styles.docMetaPillWarn}`
                          : `${styles.docMetaPill} ${styles.docMetaPillAccent}`
                      }
                    >
                      {panelDocDetail.document.visibility}
                    </span>
                    {panelDocDetail.document.isArchived ? (
                      <span className={`${styles.docMetaPill} ${styles.docMetaPillWarn}`}>Archived</span>
                    ) : null}
                    <span className={styles.docMetaPill}>
                      {panelDocDetail.document.departmentId
                        ? departments.find((d) => d.id === panelDocDetail.document.departmentId)?.name ??
                          "Department"
                        : "Org-wide"}
                    </span>
                    <span className={styles.docMetaPill}>
                      Updated {fmtDateTime(panelDocDetail.document.updatedAt)}
                    </span>
                  </div>
                  {panelDocDetail.document.createdBy ? (
                    <p className={hubStyles.profileJoined} style={{ margin: "0 1rem 0.65rem" }}>
                      Uploaded by {panelDocDetail.document.createdBy.name} ·{" "}
                      {fmtDateTime(panelDocDetail.document.createdAt)}
                    </p>
                  ) : null}
                  {docPanelActionError ? (
                    <div className={styles.docPanelAlert} role="alert">
                      {docPanelActionError}
                    </div>
                  ) : null}
                  {panelDocDetail.canManage ? (
                    <div className={styles.docFormSection}>
                      <label>
                        Title
                        <input
                          className={styles.input}
                          value={docForm.title}
                          onChange={(e) => setDocForm((f) => ({ ...f, title: e.target.value }))}
                        />
                      </label>
                      <label>
                        Description
                        <textarea
                          className={styles.input}
                          rows={3}
                          value={docForm.description}
                          onChange={(e) => setDocForm((f) => ({ ...f, description: e.target.value }))}
                        />
                      </label>
                      <label>
                        Visibility
                        <select
                          className={styles.input}
                          value={docForm.visibility}
                          onChange={(e) => setDocForm((f) => ({ ...f, visibility: e.target.value }))}
                        >
                          <option value="ALL">ALL</option>
                          <option value="DEPARTMENT">DEPARTMENT</option>
                          <option value="PRIVATE">PRIVATE</option>
                        </select>
                      </label>
                      {docForm.visibility === "DEPARTMENT" ? (
                        <label>
                          Department
                          <select
                            className={styles.input}
                            value={docForm.departmentId}
                            onChange={(e) => setDocForm((f) => ({ ...f, departmentId: e.target.value }))}
                          >
                            <option value="">Select…</option>
                            {departments.map((dep) => (
                              <option key={dep.id} value={dep.id}>
                                {dep.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <label>
                        Tags (comma-separated)
                        <input
                          className={styles.input}
                          value={docForm.tags}
                          onChange={(e) => setDocForm((f) => ({ ...f, tags: e.target.value }))}
                        />
                      </label>
                      {docSaveMsg ? (
                        <p role="status" style={{ margin: 0, fontSize: "0.85rem" }}>
                          {docSaveMsg}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        className={hubStyles.btnPrimary}
                        disabled={docSaveBusy || docPanelBusy}
                        onClick={() => void saveDocForm()}
                      >
                        {docSaveBusy ? "Saving…" : "Save changes"}
                      </button>
                    </div>
                  ) : (
                    <div className={styles.docFormSection}>
                      <div className={hubStyles.profileField}>
                        <span className={hubStyles.profileFieldLabel}>Description</span>
                        <div className={hubStyles.profileFieldBox}>
                          {panelDocDetail.document.description?.trim() ? panelDocDetail.document.description : "—"}
                        </div>
                      </div>
                      <div className={hubStyles.profileField}>
                        <span className={hubStyles.profileFieldLabel}>Tags</span>
                        <div className={hubStyles.profileFieldBox}>
                          {panelDocDetail.document.tags.length ? (
                            <span style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                              {panelDocDetail.document.tags.map((t) => (
                                <span key={t} className={styles.docTagChip}>
                                  {t}
                                </span>
                              ))}
                            </span>
                          ) : (
                            "—"
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  <h3 className={styles.docSectionTitle}>Versions</h3>
                  <ul className={styles.versionsList}>
                    {panelDocDetail.document.versions.length === 0 ? (
                      <li className={styles.versionCard}>
                        <span className={hubStyles.profileEmail}>No versions yet.</span>
                      </li>
                    ) : (
                      panelDocDetail.document.versions.map((v) => (
                        <li key={v.id} className={styles.versionCard}>
                          <div className={styles.versionCardMain}>
                            <FileTypeIcon fileName={v.fileName} variant="row" />
                            <div className={styles.versionCardText}>
                              <div className={styles.versionFileName}>
                                v{v.versionNumber} · {v.fileName}
                              </div>
                              <div className={styles.versionMetaLine}>
                                <span>{formatFileSize(v.sizeBytes)}</span>
                                <span>·</span>
                                <time dateTime={v.createdAt}>{fmtDateTime(v.createdAt)}</time>
                                <span
                                  className={`${styles.statusPill} ${docVersionStatusPillClass(v.processingStatus)}`}
                                >
                                  {v.processingStatus}
                                </span>
                              </div>
                              {panelDocDetail.canManage &&
                              v.processingStatus === "FAILED" &&
                              v.processingError ? (
                                <div className={styles.versionErr}>{v.processingError}</div>
                              ) : null}
                            </div>
                          </div>
                          <div className={styles.versionActions}>
                            <button
                              type="button"
                              className={styles.btnGhost}
                              disabled={docPanelDownloadingId === v.id}
                              onClick={() => void docPanelDownload(v.id, v.fileName)}
                            >
                              {docPanelDownloadingId === v.id ? "Downloading…" : "Download"}
                            </button>
                            {panelDocDetail.canManage && v.processingStatus === "FAILED" ? (
                              <button
                                type="button"
                                className={styles.btnGhost}
                                disabled={docPanelBusy}
                                onClick={() => void docPanelRetryVersion(v.id)}
                              >
                                Retry processing
                              </button>
                            ) : null}
                          </div>
                        </li>
                      ))
                    )}
                  </ul>
                  {panelDocDetail.canManage ? (
                    <div className={styles.docUploadSection}>
                      <h4 className={styles.docUploadTitle}>Upload new version</h4>
                      <form onSubmit={(e) => void docPanelUploadVersion(e)} className={styles.docUploadRow}>
                        <input
                          ref={docVersionFileInputRef}
                          type="file"
                          className={styles.fileInputHidden}
                          aria-hidden
                          tabIndex={-1}
                          onChange={(e) => setDocVersionUploadFile(e.target.files?.[0] ?? null)}
                        />
                        <button
                          type="button"
                          className={styles.btnGhost}
                          disabled={docPanelBusy}
                          onClick={() => docVersionFileInputRef.current?.click()}
                        >
                          Choose file
                        </button>
                        <span className={hubStyles.profileEmail} style={{ flex: "1 1 120px", minWidth: 0 }}>
                          {docVersionUploadFile ? docVersionUploadFile.name : "No file selected"}
                        </span>
                        <button
                          type="submit"
                          className={hubStyles.btnPrimary}
                          disabled={docPanelBusy || !docVersionUploadFile}
                        >
                          {docPanelBusy ? "Uploading…" : "Upload"}
                        </button>
                      </form>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </>
      ) : null}

      {editDept ? (
        <div
          className={hubStyles.modalOverlay}
          role="dialog"
          aria-modal
          onClick={() => {
            setEditDept(null);
            setDepartmentError(null);
          }}
        >
          <div className={hubStyles.modalPanel} onClick={(e) => e.stopPropagation()}>
            <h2>Edit department</h2>
            <div className={hubStyles.formGrid}>
              <label>
                <span>Name</span>
                <input
                  value={editDept.name}
                  onChange={(e) => setEditDept({ ...editDept, name: e.target.value })}
                />
              </label>
              <label>
                <span>Parent</span>
                <select
                  value={editDept.parentDepartmentId ?? ""}
                  onChange={(e) =>
                    setEditDept({
                      ...editDept,
                      parentDepartmentId: e.target.value || null,
                    })
                  }
                >
                  <option value="">None (top level)</option>
                  {departments
                    .filter((x) => x.id !== editDept.id)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            {departmentError ? (
              <p role="alert" style={{ color: "var(--error)" }}>
                {departmentError}
              </p>
            ) : null}
            <div className={hubStyles.modalActions}>
              <button type="button" onClick={() => void saveEdit()} className={hubStyles.btnPrimary}>
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditDept(null);
                  setDepartmentError(null);
                }}
                className={hubStyles.btnGhost}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {passwordUserId ? (
        <div
          className={hubStyles.modalOverlay}
          role="dialog"
          aria-modal
          onClick={() => {
            setPasswordUserId(null);
            setPasswordValue("");
            setModalError(null);
          }}
        >
          <div className={hubStyles.modalPanel} style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <h2>Set password</h2>
            <div className={hubStyles.formGrid}>
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
            <div className={hubStyles.modalActions}>
              <button type="button" disabled={modalBusy} onClick={() => void submitPassword()} className={hubStyles.btnPrimary}>
                Update
              </button>
              <button
                type="button"
                onClick={() => {
                  setPasswordUserId(null);
                  setPasswordValue("");
                  setModalError(null);
                }}
                className={hubStyles.btnGhost}
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
