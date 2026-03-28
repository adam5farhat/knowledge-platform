"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "../../../lib/authClient";
import AdminNav from "../AdminNav";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type DeptRow = { id: string; name: string; parentDepartmentId: string | null };
type Phase = "checking" | "need-login" | "forbidden" | "load-error" | "ready";

function parentLabel(depts: DeptRow[], parentId: string | null): string {
  if (!parentId) return "—";
  return depts.find((d) => d.id === parentId)?.name ?? parentId.slice(0, 8) + "…";
}

export default function AdminDepartmentsClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [departments, setDepartments] = useState<DeptRow[]>([]);
  const [departmentName, setDepartmentName] = useState("");
  const [createParentId, setCreateParentId] = useState("");
  const [creatingDepartment, setCreatingDepartment] = useState(false);
  const [departmentError, setDepartmentError] = useState<string | null>(null);
  const [departmentSuccess, setDepartmentSuccess] = useState<string | null>(null);

  const [editDept, setEditDept] = useState<DeptRow | null>(null);
  const [editModalError, setEditModalError] = useState<string | null>(null);
  const [mergeSource, setMergeSource] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeMsg, setMergeMsg] = useState<string | null>(null);
  const [mergeErr, setMergeErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const dr = await fetchWithAuth(`${API}/admin/departments`);
    if (!dr.ok) return false;
    const dJson = (await dr.json().catch(() => ({}))) as { departments?: DeptRow[] };
    if (!Array.isArray(dJson.departments)) return false;
    setDepartments(dJson.departments);
    return true;
  }, []);

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

        const me = (await meRes.json().catch(() => ({}))) as { user?: { role?: string } };
        if (!meRes.ok || me.user?.role !== "ADMIN") {
          if (!cancelled) setPhase("forbidden");
          return;
        }

        const ok = await reload();
        if (!cancelled) {
          setPhase(ok ? "ready" : "load-error");
        }
      } catch {
        if (!cancelled) setPhase("load-error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, reload]);

  async function onCreateDepartment(e: React.FormEvent) {
    e.preventDefault();
    const authToken = await getValidAccessToken();
    if (!authToken) {
      setDepartmentError("Not signed in. Please sign in again.");
      setPhase("need-login");
      router.replace("/login");
      return;
    }
    setDepartmentError(null);
    setDepartmentSuccess(null);

    const trimmedName = departmentName.trim();
    if (!trimmedName) {
      setDepartmentError("Department name is required.");
      return;
    }

    setCreatingDepartment(true);
    try {
      const body: { name: string; parentDepartmentId?: string | null } = { name: trimmedName };
      if (createParentId) body.parentDepartmentId = createParentId;

      const res = await fetchWithAuth(`${API}/admin/departments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        department?: DeptRow;
      };

      if (!res.ok || !data.department) {
        setDepartmentError(data.error ?? "Could not create department.");
        return;
      }

      setDepartments((prev) => [...prev, data.department!].sort((a, b) => a.name.localeCompare(b.name)));
      setDepartmentName("");
      setDepartmentSuccess(`Department "${data.department.name}" created.`);
    } catch {
      setDepartmentError("Could not reach the API.");
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
    setEditDept(null);
    setDepartments((prev) =>
      prev.map((d) => (d.id === data.department!.id ? data.department! : d)).sort((a, b) => a.name.localeCompare(b.name)),
    );
    setDepartmentSuccess("Department updated.");
  }

  async function deleteDept(d: DeptRow) {
    if (!window.confirm(`Delete "${d.name}"? Only allowed when it has no users, documents, or child departments.`)) return;
    const res = await fetchWithAuth(`${API}/admin/departments/${d.id}`, { method: "DELETE" });
    if (res.status === 204) {
      setDepartments((prev) => prev.filter((x) => x.id !== d.id));
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
      await reload();
    } catch {
      setMergeErr("Could not reach the API.");
    } finally {
      setMergeBusy(false);
    }
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
      <main style={{ maxWidth: 520 }}>
        <h1>Departments</h1>
        <p style={{ color: "#52525b" }}>You need to sign in to access this page.</p>
        <p style={{ marginTop: "1rem" }}>
          <Link href="/login">Sign in</Link>
          {" · "}
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }

  if (phase === "forbidden") {
    return (
      <main style={{ maxWidth: 520 }}>
        <h1>Departments</h1>
        <p style={{ color: "var(--error)" }}>Only administrators can manage departments.</p>
        <p>
          <Link href="/dashboard">Dashboard</Link>
          {" · "}
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }

  if (phase === "load-error") {
    return (
      <main>
        <p style={{ color: "var(--error)" }}>Could not load departments.</p>
        <Link href="/dashboard">Dashboard</Link>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 720 }}>
      <h1 style={{ marginBottom: "0.35rem" }}>Departments</h1>
      <p style={{ color: "#52525b", marginTop: 0 }}>Hierarchy, renames, safe deletes, and merging.</p>
      <AdminNav />

      <form onSubmit={onCreateDepartment} style={{ display: "grid", gap: "0.75rem", marginTop: "1rem", maxWidth: 480 }}>
        <h2 style={{ fontSize: "1.05rem", margin: 0 }}>Create department</h2>
        <label style={{ display: "grid", gap: 4 }}>
          <span>Name</span>
          <input
            value={departmentName}
            onChange={(e) => setDepartmentName(e.target.value)}
            maxLength={200}
            required
            style={{ padding: "0.5rem 0.6rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
          />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span>Parent (optional)</span>
          <select
            value={createParentId}
            onChange={(e) => setCreateParentId(e.target.value)}
            style={{ padding: "0.5rem 0.6rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
          >
            <option value="">None (top level)</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        {departmentError ? (
          <p role="alert" style={{ color: "var(--error)", margin: 0 }}>
            {departmentError}
          </p>
        ) : null}
        {departmentSuccess ? (
          <p role="status" style={{ color: "#15803d", margin: 0 }}>
            {departmentSuccess}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={creatingDepartment}
          style={{
            padding: "0.6rem 1rem",
            borderRadius: 6,
            border: "none",
            background: "#18181b",
            color: "#fafafa",
            cursor: creatingDepartment ? "wait" : "pointer",
            justifySelf: "start",
          }}
        >
          {creatingDepartment ? "Creating…" : "Create department"}
        </button>
      </form>

      <section style={{ marginTop: "1.75rem" }}>
        <h2 style={{ fontSize: "1.05rem" }}>Merge departments</h2>
        <p style={{ color: "#52525b", fontSize: "0.9rem", marginTop: 0 }}>
          Moves all users and documents from the source into the target, then deletes the source. The source must not have
          child departments.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <select
            value={mergeSource}
            onChange={(e) => setMergeSource(e.target.value)}
            style={{ padding: "0.45rem 0.55rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
            aria-label="Source department"
          >
            <option value="">Source…</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <span style={{ color: "#71717a" }}>→</span>
          <select
            value={mergeTarget}
            onChange={(e) => setMergeTarget(e.target.value)}
            style={{ padding: "0.45rem 0.55rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
            aria-label="Target department"
          >
            <option value="">Target…</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={mergeBusy}
            onClick={() => void onMerge()}
            style={{
              padding: "0.45rem 0.85rem",
              borderRadius: 6,
              border: "1px solid #d4d4d8",
              background: "#fff",
              cursor: mergeBusy ? "wait" : "pointer",
            }}
          >
            {mergeBusy ? "Merging…" : "Merge"}
          </button>
        </div>
        {mergeErr ? (
          <p role="alert" style={{ color: "var(--error)" }}>
            {mergeErr}
          </p>
        ) : null}
        {mergeMsg ? (
          <p role="status" style={{ color: "#15803d" }}>
            {mergeMsg}
          </p>
        ) : null}
      </section>

      <section style={{ marginTop: "1.75rem" }}>
        <h2 style={{ fontSize: "1.05rem" }}>All departments</h2>
        {departments.length === 0 ? (
          <p style={{ color: "#71717a" }}>No departments yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #e4e4e7" }}>
                  <th style={{ padding: "0.45rem 0.3rem" }}>Name</th>
                  <th style={{ padding: "0.45rem 0.3rem" }}>Parent</th>
                  <th style={{ padding: "0.45rem 0.3rem" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {departments.map((d) => (
                  <tr key={d.id} style={{ borderBottom: "1px solid #f4f4f5" }}>
                    <td style={{ padding: "0.4rem 0.3rem" }}>{d.name}</td>
                    <td style={{ padding: "0.4rem 0.3rem", color: "#52525b" }}>{parentLabel(departments, d.parentDepartmentId)}</td>
                    <td style={{ padding: "0.4rem 0.3rem", whiteSpace: "nowrap" }}>
                      <button type="button" style={{ marginRight: 8, fontSize: "0.82rem" }} onClick={() => setEditDept({ ...d })}>
                        Edit
                      </button>
                      <button type="button" style={{ fontSize: "0.82rem", color: "#b91c1c" }} onClick={() => void deleteDept(d)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editDept ? (
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
          <div style={{ background: "#fff", borderRadius: 10, padding: "1.25rem", maxWidth: 400, width: "100%" }}>
            <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Edit department</h2>
            <label style={{ display: "grid", gap: 4, marginBottom: "0.65rem" }}>
              <span>Name</span>
              <input
                value={editDept.name}
                onChange={(e) => setEditDept({ ...editDept, name: e.target.value })}
                style={{ padding: "0.45rem 0.55rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span>Parent</span>
              <select
                value={editDept.parentDepartmentId ?? ""}
                onChange={(e) =>
                  setEditDept({
                    ...editDept,
                    parentDepartmentId: e.target.value || null,
                  })
                }
                style={{ padding: "0.45rem 0.55rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
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
            {departmentError ? (
              <p role="alert" style={{ color: "var(--error)" }}>
                {departmentError}
              </p>
            ) : null}
            <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                onClick={() => void saveEdit()}
                style={{
                  padding: "0.5rem 0.9rem",
                  borderRadius: 6,
                  border: "none",
                  background: "#18181b",
                  color: "#fafafa",
                  cursor: "pointer",
                }}
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditDept(null);
                  setDepartmentError(null);
                }}
                style={{ padding: "0.5rem 0.9rem", borderRadius: 6, border: "1px solid #d4d4d8", background: "#fff" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <p style={{ marginTop: "1.5rem" }}>
        <Link href="/admin/users">Users</Link>
        {" · "}
        <Link href="/dashboard">Dashboard</Link>
        {" · "}
        <Link href="/">Home</Link>
      </p>
    </main>
  );
}
