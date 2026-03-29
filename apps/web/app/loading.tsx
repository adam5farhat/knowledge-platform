import { RouteLoadingShell } from "@/components/RouteLoadingShell";

/** Default loading UI for the root segment while navigations or RSC streams resolve. */
export default function Loading() {
  return <RouteLoadingShell label="Loading…" />;
}
