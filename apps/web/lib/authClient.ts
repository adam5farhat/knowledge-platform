const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type RefreshResponse = {
  token?: string;
  refreshToken?: string;
  code?: string;
};

function hasBrowserStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function clearStoredSession() {
  if (!hasBrowserStorage()) return;
  try {
    localStorage.removeItem("kp_access_token");
    localStorage.removeItem("kp_refresh_token");
  } catch {
    /* private mode / blocked storage */
  }
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

export async function refreshAccessToken(): Promise<string | null> {
  if (!hasBrowserStorage()) return null;

  if (refreshInFlight) {
    return refreshInFlight;
  }

  const refreshToken = localStorage.getItem("kp_refresh_token");
  if (!refreshToken) return null;

  refreshInFlight = (async (): Promise<string | null> => {
    try {
      const rt = localStorage.getItem("kp_refresh_token");
      if (!rt) return null;

      const res = await fetch(`${API}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: rt }),
      });
      const data = (await res.json().catch(() => ({}))) as RefreshResponse;
      if (!res.ok || !data.token) {
        if (res.status === 403 && data.code === "ACCOUNT_RESTRICTED") {
          clearStoredSession();
          return null;
        }
        clearStoredSession();
        return null;
      }
      localStorage.setItem("kp_access_token", data.token);
      if (data.refreshToken) {
        localStorage.setItem("kp_refresh_token", data.refreshToken);
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
  if (!hasBrowserStorage()) return null;
  try {
    const current = localStorage.getItem("kp_access_token");
    if (current) return current;
  } catch {
    return null;
  }
  return refreshAccessToken();
}

export async function fetchWithAuth(input: string, init: RequestInit = {}): Promise<Response> {
  let token: string | null = null;
  if (hasBrowserStorage()) {
    token = await getValidAccessToken();
  }
  const headers = new Headers(init.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const first = await fetch(input, { ...init, headers });
  if (first.status !== 401) return first;

  token = hasBrowserStorage() ? await refreshAccessToken() : null;
  if (!token) return first;
  const retryHeaders = new Headers(init.headers ?? {});
  retryHeaders.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers: retryHeaders });
}
