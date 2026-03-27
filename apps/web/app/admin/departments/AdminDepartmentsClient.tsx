"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "../../../lib/authClient";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type DeptOption = { id: string; name: string };
type Phase = "checking" | "need-login" | "forbidden" | "load-error" | "ready";

export default function AdminDepartmentsClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [departmentName, setDepartmentName] = useState("");
  const [creatingDepartment, setCreatingDepartment] = useState(false);
  const [departmentError, setDepartmentError] = useState<string | null>(null);
  const [departmentSuccess, setDepartmentSuccess] = useState<string | null>(null);

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

        const dr = await fetchWithAuth(`${API}/admin/departments`);
        if (!dr.ok) {
          if (!cancelled) setPhase("load-error");
          return;
        }

        const dJson = (await dr.json().catch(() => ({}))) as { departments?: DeptOption[] };
        if (!Array.isArray(dJson.departments)) {
          if (!cancelled) setPhase("load-error");
          return;
        }

        if (!cancelled) {
          setDepartments(dJson.departments);
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
      const res = await fetchWithAuth(`${API}/admin/departments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: trimmedName }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        department?: DeptOption;
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
    <main style={{ maxWidth: 520 }}>
      <h1>Departments</h1>
      <p style={{ color: "#52525b", fontSize: "0.9rem" }}>
        Create and view departments used when assigning users.
      </p>

      <form onSubmit={onCreateDepartment} style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span>Department name</span>
          <input
            value={departmentName}
            onChange={(e) => setDepartmentName(e.target.value)}
            maxLength={200}
            required
            style={{ padding: "0.5rem 0.6rem", borderRadius: 6, border: "1px solid #d4d4d8" }}
          />
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
          }}
        >
          {creatingDepartment ? "Creating…" : "Create department"}
        </button>
      </form>

      <section style={{ marginTop: "1.25rem" }}>
        <h2 style={{ fontSize: "1.05rem" }}>Existing departments</h2>
        {departments.length === 0 ? (
          <p style={{ color: "#71717a" }}>No departments yet.</p>
        ) : (
          <ul style={{ marginTop: "0.5rem", paddingLeft: "1.25rem" }}>
            {departments.map((d) => (
              <li key={d.id}>{d.name}</li>
            ))}
          </ul>
        )}
      </section>

      <p style={{ marginTop: "1.25rem" }}>
        <Link href="/admin/users">Add user</Link>
        {" · "}
        <Link href="/dashboard">Dashboard</Link>
        {" · "}
        <Link href="/">Home</Link>
      </p>
    </main>
  );
}
