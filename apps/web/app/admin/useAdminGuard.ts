"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearStoredSession, fetchWithAuth, getValidAccessToken } from "@/lib/authClient";
import type { AdminChromeSessionUser } from "./AdminChromeHeader";

export type AdminGuardPhase = "checking" | "need-login" | "forbidden" | "load-error" | "ready";

type Result = {
  phase: AdminGuardPhase;
  sessionUser: AdminChromeSessionUser | null;
};

export function useAdminGuard(): Result {
  const router = useRouter();
  const [phase, setPhase] = useState<AdminGuardPhase>("checking");
  const [sessionUser, setSessionUser] = useState<AdminChromeSessionUser | null>(null);

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
        const meRes = await fetchWithAuth(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/auth/me`);
        if (meRes.status === 401) {
          clearStoredSession();
          if (!cancelled) {
            setPhase("need-login");
            router.replace("/login");
          }
          return;
        }
        const me = (await meRes.json().catch(() => ({}))) as {
          user?: { id?: string; name?: string; email?: string; role?: string; profilePictureUrl?: string | null };
        };
        if (!meRes.ok || me.user?.role !== "ADMIN") {
          if (!cancelled) setPhase("forbidden");
          return;
        }
        if (!cancelled) {
          setSessionUser({
            id: me.user?.id,
            name: me.user?.name ?? "",
            email: me.user?.email ?? "",
            role: me.user?.role ?? "ADMIN",
            profilePictureUrl: me.user?.profilePictureUrl ?? null,
          });
          setPhase("ready");
        }
      } catch {
        if (!cancelled) setPhase("load-error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return { phase, sessionUser };
}
