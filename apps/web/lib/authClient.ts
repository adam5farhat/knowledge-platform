import { API_BASE as API } from "./apiBase";

/** Abort auth-related fetches when the API is unreachable so the UI does not sit on "Loading…" forever. */
const AUTH_NETWORK_TIMEOUT_MS = 20_000;

/**
 * Fired after a successful `POST /auth/refresh` when the response includes `user`.
 * Lets guards and profile refetch so `manageableDepartmentIds` / role match the server without a full reload.
 */
export const KP_AUTH_SESSION_REFRESHED = "kp-auth-session-refreshed";

type RefreshResponse = {
  token?: string;
  code?: string;
  user?: unknown;
};

/**
 * In-memory access token — never persisted to disk so XSS cannot exfiltrate
 * a long-lived credential. On page reload the token is lost and silently
 * re-obtained via the HttpOnly refresh-token cookie.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function clearStoredSession(): void {
  accessToken = null;
}

/**
 * Single in-flight refresh: the API rotates refresh tokens, so two parallel POST /auth/refresh
 * calls invalidate each other — the second fails and we were clearing the session (felt like a random logout).
 */
let refreshInFlight: Promise<string | null> | null = null;

/** Clear after the current task so every caller that awaited the same refresh finishes before a new refresh can start. */
function scheduleClearRefreshInFlight(): void {
  setTimeout(() => {
    refreshInFlight = null;
  }, 0);
}

function isAbortError(e: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" && e instanceof DOMException && e.name === "AbortError") ||
    (e !== null &&
      typeof e === "object" &&
      "name" in e &&
      (e as { name: string }).name === "AbortError")
  );
}

/** When `init.signal` is omitted, aborts after `ms` so a dead host does not hang the tab. */
async function fetchWithOptionalDeadline(
  input: RequestInfo | URL,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const merged: RequestInit = { credentials: "include", ...init };
  if (merged.signal) {
    return fetch(input, merged);
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(input, { ...merged, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Unauthenticated calls (e.g. login) with the same deadline so the UI cannot hang if the API is down. */
export async function fetchPublicApi(input: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetchWithOptionalDeadline(input, init, AUTH_NETWORK_TIMEOUT_MS);
  } catch {
    return new Response(null, { status: 503, statusText: "Network error" });
  }
}

export async function refreshAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;

  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async (): Promise<string | null> => {
    try {
      let res: Response;
      try {
        res = await fetchWithOptionalDeadline(
          `${API}/auth/refresh`,
          { method: "POST" },
          AUTH_NETWORK_TIMEOUT_MS,
        );
      } catch (e) {
        if (isAbortError(e)) {
          clearStoredSession();
        }
        return null;
      }
      const data = (await res.json().catch(() => ({}))) as RefreshResponse;
      if (!res.ok || !data.token) {
        if (res.status === 403 && data.code === "ACCOUNT_RESTRICTED") {
          clearStoredSession();
          return null;
        }
        clearStoredSession();
        return null;
      }
      accessToken = data.token;
      if (data.user != null && typeof window !== "undefined") {
        try {
          window.dispatchEvent(
            new CustomEvent(KP_AUTH_SESSION_REFRESHED, { detail: { user: data.user } }),
          );
        } catch {
          /* ignore */
        }
      }
      return data.token;
    } catch {
      return null;
    } finally {
      scheduleClearRefreshInFlight();
    }
  })();

  return refreshInFlight;
}

export async function getValidAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (accessToken) return accessToken;
  return refreshAccessToken();
}

/** Best-effort server logout + clear in-memory token. Call from any component's sign-out handler. */
export async function signOut(): Promise<void> {
  try {
    await fetchWithOptionalDeadline(`${API}/auth/logout`, { method: "POST" }, AUTH_NETWORK_TIMEOUT_MS);
  } catch {
    /* best-effort */
  }
  clearStoredSession();
}

export async function fetchWithAuth(input: string, init: RequestInit = {}): Promise<Response> {
  let token = await getValidAccessToken();
  const headers = new Headers(init.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let first: Response;
  try {
    first = await fetchWithOptionalDeadline(input, { ...init, headers }, AUTH_NETWORK_TIMEOUT_MS);
  } catch {
    return new Response(null, { status: 503, statusText: "Network error" });
  }
  if (first.status !== 401) return first;

  token = await refreshAccessToken();
  if (!token) return first;
  const retryHeaders = new Headers(init.headers ?? {});
  retryHeaders.set("Authorization", `Bearer ${token}`);
  try {
    return await fetchWithOptionalDeadline(input, { ...init, headers: retryHeaders }, AUTH_NETWORK_TIMEOUT_MS);
  } catch {
    return new Response(null, { status: 503, statusText: "Network error" });
  }
}
