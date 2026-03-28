"use client";

import dynamic from "next/dynamic";
import styles from "./page.module.css";

const LoginClient = dynamic(() => import("./LoginClient"), {
  ssr: false,
  loading: () => (
    <main className={styles.shell} data-auth-fullscreen="true" suppressHydrationWarning>
      <section
        className={styles.frame}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh" }}
      >
        <p style={{ margin: 0, color: "#52525b" }}>Loading...</p>
      </section>
    </main>
  ),
});

export default function LoginGate() {
  return <LoginClient />;
}
