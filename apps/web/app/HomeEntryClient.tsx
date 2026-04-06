"use client";

import { useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "../lib/authClient";
import { homePathForUser, type MeResponse } from "../lib/restrictions";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Root `/`: send anonymous users to login, signed-in users to the dashboard. */
export default function HomeEntryClient() {
  const router = useRouter();

  useLayoutEffect(() => {
    let cancelled = false;

    try {
      const hasAccess = localStorage.getItem("kp_access_token");
      const hasRefresh = localStorage.getItem("kp_refresh_token");
      if (!hasAccess && !hasRefresh) {
        router.replace("/login");
        return;
      }
    } catch {
      router.replace("/login");
      return;
    }

    void (async () => {
      const token = await getValidAccessToken();
      if (!token) {
        if (!cancelled) router.replace("/login");
        return;
      }
      const res = await fetchWithAuth(`${API}/auth/me`);
      if (res.status === 401) {
        clearStoredSession();
        if (!cancelled) router.replace("/login");
        return;
      }
      if (!res.ok) {
        if (!cancelled) router.replace("/login");
        return;
      }
      let body: MeResponse;
      try {
        body = (await res.json()) as MeResponse;
      } catch {
        if (!cancelled) router.replace("/login");
        return;
      }
      if (!cancelled) router.replace(homePathForUser(body.user));
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main
      suppressHydrationWarning
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#52525b",
      }}
    >
      <p style={{ margin: 0 }}>Loading…</p>
    </main>
  );
}
