"use client";

import HomeEntryClient from "./HomeEntryClient";

/**
 * Direct import avoids a dev-only webpack bug where `dynamic(..., { ssr: false })` chunks
 * can desync with HMR/RSC flight (`__webpack_modules__[moduleId] is not a function`).
 * HomeEntryClient’s first paint matches SSR (static “Loading…” until `useEffect` runs).
 */
export default function HomePageGate() {
  return <HomeEntryClient />;
}
