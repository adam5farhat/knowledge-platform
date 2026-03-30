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
    <main style={{ fontFamily: "system-ui, sans-serif", margin: "2rem", maxWidth: 480 }}>
      <h1>Something went wrong</h1>
      <p style={{ color: "#52525b" }}>{error.message || "Unexpected error"}</p>
      <p style={{ marginTop: "1rem" }}>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            padding: "0.5rem 0.75rem",
            marginRight: "0.75rem",
            borderRadius: 6,
            border: "1px solid #d4d4d8",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
        <Link prefetch={false} href="/documents">Home</Link>
      </p>
    </main>
  );
}
