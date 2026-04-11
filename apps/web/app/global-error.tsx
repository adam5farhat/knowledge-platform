"use client";

import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="kp-error-shell">
        <h1>Something went wrong</h1>
        <p className="kp-text-muted">{error.message || "Unexpected error"}</p>
        <p className="kp-stack-top">
          <button type="button" onClick={() => reset()} className="kp-error-btn">
            Try again
          </button>
          <a href="/dashboard">Home</a>
        </p>
      </body>
    </html>
  );
}
