import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * In dev, browsers sometimes cache the root HTML document and keep old `/_next/static/*?v=…`
 * references after `.next` is cleared or the dev server restarts — leading to 404 on CSS/JS.
 * Only apply to navigations that ask for HTML; skip RSC, assets, and production.
 */
export function middleware(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.next();
  }

  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("text/html")) {
    return NextResponse.next();
  }

  const res = NextResponse.next();
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.headers.set("Pragma", "no-cache");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
