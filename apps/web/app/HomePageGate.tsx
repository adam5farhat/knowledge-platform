"use client";

import dynamic from "next/dynamic";

const loadingShell = (
  <main
    suppressHydrationWarning
    style={{
      minHeight: "60vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#52525b",
    }}
  >
    <p style={{ margin: 0 }}>Loading…</p>
  </main>
);

/** `ssr: false` avoids hydrating auth logic against static HTML (fixes React #418 with extensions / timing). */
const HomeEntryClient = dynamic(() => import("./HomeEntryClient"), {
  ssr: false,
  loading: () => loadingShell,
});

export default function HomePageGate() {
  return <HomeEntryClient />;
}
