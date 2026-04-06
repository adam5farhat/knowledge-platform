"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  clearStoredSession,
  fetchWithAuth,
  getValidAccessToken,
  KP_AUTH_SESSION_REFRESHED,
} from "@/lib/authClient";
import { RoleNameApi, userCanOpenManagerDashboard, type MeUserDto } from "@/lib/restrictions";
import type { AdminChromeSessionUser } from "../admin/AdminChromeHeader";

export type ManagerGuardPhase = "checking" | "need-login" | "forbidden" | "load-error" | "ready";

export type ManagerSessionRestrictions = {
  manageDocumentsAllowed: boolean;
  accessDocumentsAllowed: boolean;
  useAiQueriesAllowed: boolean;
  accessDashboardAllowed: boolean;
};

type Result = {
  phase: ManagerGuardPhase;
  sessionUser: AdminChromeSessionUser | null;
  restrictions: ManagerSessionRestrictions | null;
};

export function useManagerGuard(): Result {
  const router = useRouter();
  const [phase, setPhase] = useState<ManagerGuardPhase>("checking");
  const [sessionUser, setSessionUser] = useState<AdminChromeSessionUser | null>(null);
  const [restrictions, setRestrictions] = useState<ManagerSessionRestrictions | null>(null);
  const [sessionRecheck, setSessionRecheck] = useState(0);

  useEffect(() => {
    function onSessionRefreshed() {
      setSessionRecheck((n) => n + 1);
    }
    window.addEventListener(KP_AUTH_SESSION_REFRESHED, onSessionRefreshed);
    return () => window.removeEventListener(KP_AUTH_SESSION_REFRESHED, onSessionRefreshed);
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
        const meRes = await fetchWithAuth(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/auth/me`);
        if (meRes.status === 401) {
          clearStoredSession();
          if (!cancelled) {
            setPhase("need-login");
            router.replace("/login");
          }
          return;
        }
        const me = (await meRes.json().catch(() => ({}))) as { user?: MeUserDto };
        if (!meRes.ok || !me.user || !userCanOpenManagerDashboard(me.user)) {
          if (!cancelled) setPhase("forbidden");
          return;
        }
        if (!cancelled) {
          setSessionUser({
            id: me.user?.id,
            name: me.user?.name ?? "",
            email: me.user?.email ?? "",
            role: me.user?.role ?? RoleNameApi.MANAGER,
            profilePictureUrl: me.user?.profilePictureUrl ?? null,
          });
          const r = me.user?.restrictions;
          setRestrictions({
            manageDocumentsAllowed: r?.manageDocumentsAllowed ?? true,
            accessDocumentsAllowed: r?.accessDocumentsAllowed ?? true,
            useAiQueriesAllowed: r?.useAiQueriesAllowed ?? true,
            accessDashboardAllowed: r?.accessDashboardAllowed ?? true,
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
  }, [router, sessionRecheck]);

  return { phase, sessionUser, restrictions };
}
