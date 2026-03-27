"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type HealthState =
  | { status: "loading" }
  | { status: "ok"; data: Record<string, unknown> }
  | { status: "error" };

export default function HealthStatus() {
  const [state, setState] = useState<HealthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API}/health`, { cache: "no-store" });
        const text = await res.text();
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(text) as Record<string, unknown>;
        } catch {
          if (!cancelled) setState({ status: "error" });
          return;
        }
        if (!cancelled) {
          setState(res.ok ? { status: "ok", data } : { status: "error" });
        }
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return <p style={{ color: "#71717a" }}>Checking API...</p>;
  }

  if (state.status === "ok") {
    return (
      <pre style={{ background: "#f4f4f5", padding: "1rem", borderRadius: 8 }}>
        {JSON.stringify(state.data, null, 2)}
      </pre>
    );
  }

  return (
    <p style={{ color: "var(--error)" }}>
      Could not reach the API at {API}. Start Docker (<code>npm run docker:up</code>), run migrations, then{" "}
      <code>npm run dev:api</code>.
    </p>
  );
}
