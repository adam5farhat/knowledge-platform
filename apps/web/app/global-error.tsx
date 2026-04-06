"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: "2rem", maxWidth: 480 }}>
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
          <a href="/dashboard">Home</a>
        </p>
      </body>
    </html>
  );
}
