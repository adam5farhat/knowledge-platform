export function RouteLoadingShell({ label = "Loading…" }: { label?: string }) {
  return (
    <main className="kp-route-loading" role="status" aria-live="polite">
      <div className="kp-route-loading__skeleton" aria-hidden>
        <div className="kp-route-loading__bar kp-route-loading__bar--long" />
        <div className="kp-route-loading__bar kp-route-loading__bar--long" />
        <div className="kp-route-loading__bar kp-route-loading__bar--short" />
      </div>
      <p className="kp-route-loading__label">{label}</p>
    </main>
  );
}
