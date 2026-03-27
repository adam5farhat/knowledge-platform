import { Suspense } from "react";
import SearchClient from "./SearchClient";

export default function SemanticSearchPage() {
  return (
    <Suspense fallback={<main><p>Loading…</p></main>}>
      <SearchClient />
    </Suspense>
  );
}
