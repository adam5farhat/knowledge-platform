"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "../../../lib/authClient";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type RoleOption = { id: string; name: string; description: string | null };
type DeptOption = { id: string; name: string };

type Phase = "checking" | "need-login" | "forbidden" | "load-error" | "ready";

export default function AdminUsersClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [departments, setDepartments] = useState<DeptOption[]>([]);

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
          if (dJson.departments.length > 0) {
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

  async function onSubmit(e: React.FormEvent) {
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
    } catch {
      setSubmitError("Could not reach the API");
    } finally {
      setLoading(false);
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
      <main style={{ maxWidth: 480 }}>
        <h1>Add user</h1>
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
        <h1>Add user</h1>
        <p style={{ color: "var(--error)" }}>Only administrators can create accounts.</p>
        <p>
          <Link href="/dashboard">Dashboard</Link>
          {" · "}
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 420 }}>
      <h1>Add user</h1>
      <p style={{ color: "#52525b", fontSize: "0.9rem" }}>
        Create an account for a colleague. They will sign in with the email and password you
        set here.
      </p>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
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
              <option value="">No departments — run seed or add departments (API)</option>
            ) : (
              departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))
            )}
          </select>
          <span style={{ color: "#52525b", fontSize: "0.85rem" }}>
            Need a new one? <Link href="/admin/departments">Add department</Link>
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

      <p style={{ marginTop: "1.25rem" }}>
        <Link href="/dashboard">Dashboard</Link>
        {" · "}
        <Link href="/admin/departments">Departments</Link>
        {" · "}
        <Link href="/">Home</Link>
      </p>
    </main>
  );
}
