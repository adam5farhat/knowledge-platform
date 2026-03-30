"use client";

import AdminUsersClient from "./AdminUsersClient";

/**
 * Direct import avoids a dev-only webpack bug where `dynamic(..., { ssr: false })` chunks
 * can desync with HMR/RSC flight (`__webpack_modules__[moduleId] is not a function`).
 * Same pattern as `app/HomePageGate.tsx`.
 */
export default function AdminUsersGate() {
  return <AdminUsersClient />;
}
