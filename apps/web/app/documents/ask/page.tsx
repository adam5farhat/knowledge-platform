import { Suspense } from "react";
import AskClient from "./AskClient";

export default function AskPage() {
  return (
    <Suspense fallback={<main><p>Loading…</p></main>}>
      <AskClient />
    </Suspense>
  );
}
