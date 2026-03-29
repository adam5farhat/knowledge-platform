import styles from "./RouteLoadingShell.module.css";

export function RouteLoadingShell({ label = "Loading…" }: { label?: string }) {
  return (
    <main className={styles.wrap} role="status" aria-live="polite">
      <div className={styles.skeleton} aria-hidden>
        <div className={`${styles.bar} ${styles.barLong}`} />
        <div className={`${styles.bar} ${styles.barLong}`} />
        <div className={`${styles.bar} ${styles.barShort}`} />
      </div>
      <p className={styles.label}>{label}</p>
    </main>
  );
}
