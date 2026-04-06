"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { fetchWithAuth } from "@/lib/authClient";
import { API_BASE as API } from "@/lib/apiBase";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface NotificationActor {
  id: string;
  email: string;
  name: string;
}

export interface NotificationPayload {
  id: string;
  type: string;
  title: string;
  body: string | null;
  documentId: string | null;
  departmentId: string | null;
  attachmentKey: string | null;
  attachmentName: string | null;
  attachmentMimeType: string | null;
  attachmentSize: number | null;
  createdAt: string;
  actor: NotificationActor | null;
}

export interface UserNotificationItem {
  id: string;
  read: boolean;
  readAt: string | null;
  createdAt: string;
  notification: NotificationPayload;
}

interface NotificationsResponse {
  items: UserNotificationItem[];
  total: number;
  unreadCount: number;
  page: number;
  limit: number;
}

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

interface NotificationContextValue {
  items: UserNotificationItem[];
  unreadCount: number;
  total: number;
  loading: boolean;
  panelOpen: boolean;
  setPanelOpen: (v: boolean) => void;
  markAsRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  loadMore: () => Promise<void>;
  hasMore: boolean;
  refresh: () => Promise<void>;
  userRole: string;
  manageableDepartmentIds: string[];
}

const Ctx = createContext<NotificationContextValue | null>(null);

export function useNotifications() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNotifications must be inside NotificationProvider");
  return v;
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

const POLL_INTERVAL_MS = 10_000;
const PAGE_SIZE = 20;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<UserNotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [panelOpen, _setPanelOpen] = useState(false);
  const [userRole, setUserRole] = useState("");
  const [manageableDepartmentIds, setManageableDepartmentIds] = useState<string[]>([]);
  const mountedRef = useRef(true);

  const fetchPage = useCallback(async (p: number, replace: boolean) => {
    try {
      const res = await fetchWithAuth(`${API}/notifications?page=${p}&limit=${PAGE_SIZE}`);
      if (!res.ok) return;
      const data = (await res.json()) as NotificationsResponse;
      if (!mountedRef.current) return;
      if (replace) {
        setItems(data.items);
      } else {
        setItems((prev) => {
          const ids = new Set(prev.map((i) => i.id));
          return [...prev, ...data.items.filter((i) => !ids.has(i.id))];
        });
      }
      setUnreadCount(data.unreadCount);
      setTotal(data.total);
      setPage(p);
    } catch {
      /* network error — ignore silently */
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await fetchPage(1, true);
    setLoading(false);
  }, [fetchPage]);

  const setPanelOpen = useCallback(
    (v: boolean) => {
      _setPanelOpen(v);
      if (v) void refresh();
    },
    [refresh],
  );

  const pollUnread = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${API}/notifications/unread-count`);
      if (!res.ok) return;
      const data = (await res.json()) as { unreadCount: number };
      if (mountedRef.current) setUnreadCount(data.unreadCount);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchUserMeta = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${API}/auth/me`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        user?: { role?: string; manageableDepartmentIds?: string[] };
      };
      if (!mountedRef.current) return;
      setUserRole(data.user?.role ?? "");
      setManageableDepartmentIds(data.user?.manageableDepartmentIds ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    void fetchUserMeta();

    void pollUnread();
    const id = setInterval(pollUnread, POLL_INTERVAL_MS);

    function onVisible() {
      if (document.visibilityState === "visible") void pollUnread();
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mountedRef.current = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, pollUnread, fetchUserMeta]);

  const markAsRead = useCallback(async (id: string) => {
    const res = await fetchWithAuth(`${API}/notifications/${id}/read`, { method: "PATCH" });
    if (!res.ok) return;
    setItems((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, read: true, readAt: new Date().toISOString() } : i,
      ),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
  }, []);

  const markAllRead = useCallback(async () => {
    const res = await fetchWithAuth(`${API}/notifications/read-all`, { method: "PATCH" });
    if (!res.ok) return;
    setItems((prev) =>
      prev.map((i) => (i.read ? i : { ...i, read: true, readAt: new Date().toISOString() })),
    );
    setUnreadCount(0);
  }, []);

  const deleteNotification = useCallback(async (id: string) => {
    const res = await fetchWithAuth(`${API}/notifications/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setItems((prev) => {
      const item = prev.find((i) => i.id === id);
      if (item && !item.read) setUnreadCount((c) => Math.max(0, c - 1));
      return prev.filter((i) => i.id !== id);
    });
    setTotal((t) => Math.max(0, t - 1));
  }, []);

  const hasMore = items.length < total;

  const loadMore = useCallback(async () => {
    if (!hasMore || loading) return;
    setLoading(true);
    await fetchPage(page + 1, false);
    setLoading(false);
  }, [hasMore, loading, fetchPage, page]);

  return (
    <Ctx.Provider
      value={{
        items,
        unreadCount,
        total,
        loading,
        panelOpen,
        setPanelOpen,
        markAsRead,
        markAllRead,
        deleteNotification,
        loadMore,
        hasMore,
        refresh,
        userRole,
        manageableDepartmentIds,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
