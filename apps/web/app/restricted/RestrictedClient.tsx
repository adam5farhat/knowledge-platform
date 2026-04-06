"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { fetchWithAuth } from "@/lib/authClient";
import {
  DEFAULT_USER_RESTRICTIONS,
  homePathForUser,
  RoleNameApi,
  userCanOpenManagerDashboard,
  type MeUserDto,
} from "@/lib/restrictions";
import styles from "./page.module.css";
import { API_BASE as API } from "@/lib/apiBase";

const COPY: Record<
  string,
  { title: string; message: string; hint?: string }
> = {
  accessDocuments: {
    title: "Access restricted",
    message: "You do not have permission to access the document library.",
    hint: "Your administrator can enable “Access documents” for your account.",
  },
  manageDocuments: {
    title: "Access restricted",
    message: "You do not have permission to manage documents.",
    hint: "Uploading, editing, or deleting documents requires the “Manage documents” permission.",
  },
  useAiQueries: {
    title: "Access restricted",
    message: "You do not have permission to use AI-powered search.",
    hint: "Semantic search can be enabled by your administrator.",
  },
  accessDashboard: {
    title: "Access restricted",
    message: "You do not have permission to open the main dashboard.",
  },
  default: {
    title: "Access restricted",
    message: "You do not have permission to access this feature.",
    hint: "If you need access, contact your administrator.",
  },
};

export default function RestrictedClient() {
  const searchParams = useSearchParams();
  const feature = searchParams.get("feature") ?? "default";
  const copy = COPY[feature] ?? COPY.default;
  const [me, setMe] = useState<MeUserDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchWithAuth(`${API}/auth/me`);
      if (!res.ok || cancelled) return;
      try {
        const body = (await res.json()) as { user: MeUserDto };
        if (!cancelled) setMe(body.user);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dashboardHref = useMemo(() => (me ? homePathForUser(me) : "/dashboard"), [me]);

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.iconWrap} aria-hidden>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1V8a5 5 0 0 0-5-5z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="14" r="1.25" fill="currentColor" />
          </svg>
        </div>
        <h1 className={styles.title}>{copy.title}</h1>
        <p className={styles.message}>{copy.message}</p>
        {copy.hint ? <p className={styles.hint}>{copy.hint}</p> : null}
        <Link prefetch={false} href={dashboardHref} className={styles.primary}>
          {(me?.restrictions ?? DEFAULT_USER_RESTRICTIONS).accessDashboardAllowed === false && me?.role === RoleNameApi.ADMIN
            ? "Go to admin hub"
            : (me?.restrictions ?? DEFAULT_USER_RESTRICTIONS).accessDashboardAllowed === false && me && userCanOpenManagerDashboard(me)
              ? "Go to department overview"
              : "Go back to dashboard"}
        </Link>
        <Link prefetch={false} href="/profile" className={styles.secondary}>
          View profile
        </Link>
      </div>
    </main>
  );
}
