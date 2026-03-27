import { Suspense } from "react";
import ResetClient from "./ResetClient";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<main><p>Loading…</p></main>}>
      <ResetClient />
    </Suspense>
  );
}
