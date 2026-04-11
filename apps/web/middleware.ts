import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PUBLIC_ROUTES = new Set([
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/about",
  "/contact",
]);

const REFRESH_COOKIE = "kp_rt";

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.has(pathname);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Auth guard: redirect to /login when the refresh cookie is absent on protected routes.
  // The cookie is HttpOnly so JS cannot read it, but Edge middleware can.
  if (!isPublicRoute(pathname)) {
    const hasRefreshCookie = request.cookies.has(REFRESH_COOKIE);
    if (!hasRefreshCookie) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      return NextResponse.redirect(loginUrl);
    }
  }

  // Dev-only: prevent stale HTML cache after .next clear / dev server restart.
  if (process.env.NODE_ENV === "development") {
    const accept = request.headers.get("accept") ?? "";
    if (accept.includes("text/html")) {
      const res = NextResponse.next();
      res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
      res.headers.set("Pragma", "no-cache");
      return res;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|logo.svg).*)"],
};
