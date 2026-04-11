"use client";

import Link from "next/link";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="kp-error-shell">
      <h1>Something went wrong</h1>
      <p className="kp-text-muted">{error.message || "Unexpected error"}</p>
      <p className="kp-stack-top">
        <button type="button" onClick={() => reset()} className="kp-error-btn">
          Try again
        </button>
        <Link prefetch={false} href="/dashboard">Home</Link>
      </p>
    </main>
  );
}
