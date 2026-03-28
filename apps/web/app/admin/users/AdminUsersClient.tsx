"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "../../../lib/authClient";
import AdminNav from "../AdminNav";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

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

export default function AdminUsersClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [departments, setDepartments] = useState<DeptOption[]>([]);

  const [listPage, setListPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);
  const [listPageSize] = useState(25);
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

        let me: { user?: { role: string } };
        try {
          me = (await meRes.json()) as { user?: { role: string } };
        } catch {
          if (!cancelled) setPhase("load-error");
          return;
        }

        if (!meRes.ok || me.user?.role !== "ADMIN") {
          if (!cancelled) setPhase("forbidden");
          return;
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
          <Link href="/">Home</Link>
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
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1100 }}>
      <h1 style={{ marginBottom: "0.35rem" }}>Users</h1>
      <p style={{ color: "#52525b", marginTop: 0 }}>Directory, account status, and creating new users.</p>
      <AdminNav />

      <section style={{ marginTop: "1.25rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Directory</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem", alignItems: "center" }}>
          <input
            value={userQ}
            onChange={(e) => {
              setUserQ(e.target.value);
              setListPage(1);
            }}
            placeholder="Search name, email, badge…"
            style={{ padding: "0.45rem 0.55rem", borderRadius: 6, border: "1px solid #d4d4d8", minWidth: 200 }}
          />
          <select
            value={filterDepartmentId}
            onChange={(e) => {
              setFilterDepartmentId(e.target.value);
              setListPage(1);
            }}
            style={{ padding: "0.45rem 0.55rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select
            value={filterRole}
            onChange={(e) => {
              setFilterRole(e.target.value);
              setListPage(1);
            }}
            style={{ padding: "0.45rem 0.55rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
          >
            <option value="">All roles</option>
            {roles.map((r) => (
              <option key={r.id} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
          <select
            value={filterActive}
            onChange={(e) => {
              setFilterActive(e.target.value);
              setListPage(1);
            }}
            style={{ padding: "0.45rem 0.55rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
          >
            <option value="">Active + inactive</option>
            <option value="true">Active only</option>
            <option value="false">Inactive only</option>
          </select>
          <button
            type="button"
            onClick={() => void loadDirectory()}
            style={{ padding: "0.45rem 0.75rem", borderRadius: 6, border: "1px solid #d4d4d8", background: "#fff" }}
          >
            Refresh
          </button>
        </div>
        {directoryError ? (
          <p role="alert" style={{ color: "var(--error)" }}>
            {directoryError}
          </p>
        ) : null}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #e4e4e7" }}>
                <th style={{ padding: "0.45rem 0.3rem" }}>Name</th>
                <th style={{ padding: "0.45rem 0.3rem" }}>Email</th>
                <th style={{ padding: "0.45rem 0.3rem" }}>Role</th>
                <th style={{ padding: "0.45rem 0.3rem" }}>Department</th>
                <th style={{ padding: "0.45rem 0.3rem" }}>Status</th>
                <th style={{ padding: "0.45rem 0.3rem" }}>Lock</th>
                <th style={{ padding: "0.45rem 0.3rem" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {directoryLoading ? (
                <tr>
                  <td colSpan={7} style={{ padding: "0.75rem", color: "#71717a" }}>
                    Loading…
                  </td>
                </tr>
              ) : null}
              {!directoryLoading &&
                directoryUsers.map((u) => (
                  <tr key={u.id} style={{ borderBottom: "1px solid #f4f4f5" }}>
                    <td style={{ padding: "0.4rem 0.3rem" }}>{u.name}</td>
                    <td style={{ padding: "0.4rem 0.3rem" }}>{u.email}</td>
                    <td style={{ padding: "0.4rem 0.3rem" }}>{u.role}</td>
                    <td style={{ padding: "0.4rem 0.3rem" }}>{u.department.name}</td>
                    <td style={{ padding: "0.4rem 0.3rem" }}>{u.isActive ? "Active" : "Inactive"}</td>
                    <td style={{ padding: "0.4rem 0.3rem" }}>
                      {u.loginLockedUntil || u.failedLoginAttempts > 0 ? (
                        <span style={{ color: "#b45309" }} title={u.loginLockedUntil ?? undefined}>
                          {u.failedLoginAttempts > 0 ? `${u.failedLoginAttempts} fails` : "Locked"}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ padding: "0.4rem 0.3rem", whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        style={{ marginRight: 6, fontSize: "0.8rem" }}
                        onClick={() => {
                          setModalError(null);
                          setEditUser({ ...u });
                        }}
                      >
                        Edit
                      </button>
                      <button type="button" style={{ marginRight: 6, fontSize: "0.8rem" }} onClick={() => void unlockUser(u.id)}>
                        Unlock
                      </button>
                      <button
                        type="button"
                        style={{ marginRight: 6, fontSize: "0.8rem" }}
                        onClick={() => {
                          setModalError(null);
                          setPasswordValue("");
                          setPasswordUserId(u.id);
                        }}
                      >
                        Set password
                      </button>
                      <button type="button" style={{ fontSize: "0.8rem", color: "#b91c1c" }} onClick={() => void deleteUser(u)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={listPage <= 1}
            onClick={() => setListPage((p) => Math.max(1, p - 1))}
            style={{ padding: "0.35rem 0.65rem", borderRadius: 6, border: "1px solid #d4d4d8", background: "#fff" }}
          >
            Previous
          </button>
          <span style={{ color: "#52525b" }}>
            Page {listPage} of {totalListPages} ({listTotal} users)
          </span>
          <button
            type="button"
            disabled={listPage >= totalListPages}
            onClick={() => setListPage((p) => p + 1)}
            style={{ padding: "0.35rem 0.65rem", borderRadius: 6, border: "1px solid #d4d4d8", background: "#fff" }}
          >
            Next
          </button>
        </div>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Create user</h2>
        <p style={{ color: "#52525b", fontSize: "0.9rem" }}>
          New colleagues sign in with the email and password you set here.
        </p>

        <form onSubmit={onSubmitCreate} style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem", maxWidth: 420 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span>Full name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
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
              autoComplete="off"
              style={{ padding: "0.5rem 0.6rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span>Temporary password (min 8 characters)</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              style={{ padding: "0.5rem 0.6rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span>Role</span>
            <select
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              style={{ padding: "0.5rem 0.6rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
            >
              {roles.map((r) => (
                <option key={r.id} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span>Department</span>
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              required
              style={{ padding: "0.5rem 0.6rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
            >
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
            <span style={{ color: "#52525b", fontSize: "0.85rem" }}>
              Need a new one? <Link href="/admin/departments">Departments</Link>
            </span>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span>Employee badge {roleName === "EMPLOYEE" ? "(required for EMPLOYEE)" : "(optional)"}</span>
            <input
              value={employeeBadgeNumber}
              onChange={(e) => setEmployeeBadgeNumber(e.target.value)}
              required={roleName === "EMPLOYEE"}
              style={{ padding: "0.5rem 0.6rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span>Job title (optional)</span>
            <input
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              style={{ padding: "0.5rem 0.6rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
            />
          </label>

          {submitError ? (
            <p role="alert" style={{ color: "var(--error)", margin: 0 }}>
              {submitError}
            </p>
          ) : null}
          {success ? (
            <p role="status" style={{ color: "#15803d", margin: 0 }}>
              {success}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading || departments.length === 0}
            style={{
              padding: "0.6rem 1rem",
              borderRadius: 6,
              border: "none",
              background: "#18181b",
              color: "#fafafa",
              cursor: loading ? "wait" : "pointer",
            }}
          >
            {loading ? "Creating…" : "Create user"}
          </button>
        </form>
      </section>

      {editUser ? (
        <div
          role="dialog"
          aria-modal
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
            zIndex: 50,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 10,
              padding: "1.25rem",
              maxWidth: 440,
              width: "100%",
              maxHeight: "90vh",
              overflow: "auto",
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Edit user</h2>
            <div style={{ display: "grid", gap: "0.65rem" }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span>Email</span>
                <input
                  value={editUser.email}
                  onChange={(e) => setEditUser({ ...editUser, email: e.target.value })}
                  style={{ padding: "0.45rem 0.55rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span>Name</span>
                <input
                  value={editUser.name}
                  onChange={(e) => setEditUser({ ...editUser, name: e.target.value })}
                  style={{ padding: "0.45rem 0.55rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span>Role</span>
                <select
                  value={editUser.role}
                  onChange={(e) => setEditUser({ ...editUser, role: e.target.value })}
                  style={{ padding: "0.45rem 0.55rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.name}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span>Department</span>
                <select
                  value={editUser.department.id}
                  onChange={(e) => {
                    const id = e.target.value;
                    const d = departments.find((x) => x.id === id);
                    if (d) setEditUser({ ...editUser, department: { id: d.id, name: d.name } });
                  }}
                  style={{ padding: "0.45rem 0.55rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span>Employee badge</span>
                <input
                  value={editUser.employeeBadgeNumber ?? ""}
                  onChange={(e) => setEditUser({ ...editUser, employeeBadgeNumber: e.target.value || null })}
                  style={{ padding: "0.45rem 0.55rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span>Phone</span>
                <input
                  value={editUser.phoneNumber ?? ""}
                  onChange={(e) => setEditUser({ ...editUser, phoneNumber: e.target.value || null })}
                  style={{ padding: "0.45rem 0.55rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span>Position</span>
                <input
                  value={editUser.position ?? ""}
                  onChange={(e) => setEditUser({ ...editUser, position: e.target.value || null })}
                  style={{ padding: "0.45rem 0.55rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
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
            <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={modalBusy}
                onClick={() => void saveEdit()}
                style={{
                  padding: "0.5rem 0.9rem",
                  borderRadius: 6,
                  border: "none",
                  background: "#18181b",
                  color: "#fafafa",
                  cursor: modalBusy ? "wait" : "pointer",
                }}
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditUser(null)}
                style={{ padding: "0.5rem 0.9rem", borderRadius: 6, border: "1px solid #d4d4d8", background: "#fff" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {passwordUserId ? (
        <div
          role="dialog"
          aria-modal
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
            zIndex: 50,
          }}
        >
          <div style={{ background: "#fff", borderRadius: 10, padding: "1.25rem", maxWidth: 360, width: "100%" }}>
            <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Set password</h2>
            <label style={{ display: "grid", gap: 4 }}>
              <span>New password (min 8 characters)</span>
              <input
                type="password"
                value={passwordValue}
                onChange={(e) => setPasswordValue(e.target.value)}
                minLength={8}
                autoComplete="new-password"
                style={{ padding: "0.45rem 0.55rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
              />
            </label>
            {modalError ? (
              <p role="alert" style={{ color: "var(--error)" }}>
                {modalError}
              </p>
            ) : null}
            <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                disabled={modalBusy}
                onClick={() => void submitPassword()}
                style={{
                  padding: "0.5rem 0.9rem",
                  borderRadius: 6,
                  border: "none",
                  background: "#18181b",
                  color: "#fafafa",
                  cursor: modalBusy ? "wait" : "pointer",
                }}
              >
                Update password
              </button>
              <button
                type="button"
                onClick={() => {
                  setPasswordUserId(null);
                  setPasswordValue("");
                  setModalError(null);
                }}
                style={{ padding: "0.5rem 0.9rem", borderRadius: 6, border: "1px solid #d4d4d8", background: "#fff" }}
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
