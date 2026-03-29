import { Suspense } from "react";
import RestrictedClient from "./RestrictedClient";

export default function RestrictedPage() {
  return (
    <Suspense
      fallback={
        <main
          style={{
            minHeight: "60vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#64748b",
          }}
        >
          Loading…
        </main>
      }
    >
      <RestrictedClient />
    </Suspense>
  );
}
