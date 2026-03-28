"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "../lib/authClient";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Root `/`: send anonymous users to login, signed-in users to the document library. */
export default function HomeEntryClient() {
  const router = useRouter();

  useEffect(() => {
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
      if (!cancelled) router.replace("/documents");
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
