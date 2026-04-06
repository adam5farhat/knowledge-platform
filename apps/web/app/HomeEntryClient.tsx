"use client";

import { useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "../lib/authClient";
import { homePathForUser, type MeResponse } from "../lib/restrictions";
import { API_BASE as API } from "@/lib/apiBase";

/** Root `/`: send anonymous users to login, signed-in users to the dashboard. */
export default function HomeEntryClient() {
  const router = useRouter();

  useLayoutEffect(() => {
    let cancelled = false;

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
