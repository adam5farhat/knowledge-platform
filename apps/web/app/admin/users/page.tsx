import { Suspense } from "react";
import AdminUsersClient from "./AdminUsersClient";

export const dynamic = "force-dynamic";

export default function AdminUsersPage() {
  return (
    <Suspense
      fallback={
        <main style={{ padding: "1rem" }}>
          <p>Loading…</p>
        </main>
      }
    >
      <AdminUsersClient />
    </Suspense>
  );
}
