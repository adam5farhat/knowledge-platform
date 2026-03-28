import { Suspense } from "react";
import DocumentsClient from "./DocumentsClient";

export default function DocumentsPage() {
  return (
    <Suspense fallback={<main style={{ padding: "1.5rem" }}>Loading…</main>}>
      <DocumentsClient />
    </Suspense>
  );
}
