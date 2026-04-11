import type { ReactNode } from "react";
import styles from "./AuthCard.module.css";

type AuthCardProps = {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
};

export default function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <main className={styles.wrap}>
      <section className={styles.card}>
        <a className={`logoLink ${styles.logoRow}`} href="/dashboard">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logoMark" src="/logo.svg" alt="Knowledge Platform" />
        </a>
        <h1 className={styles.title}>{title}</h1>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        <div className={styles.body}>{children}</div>
        {footer ? <p className={styles.footer}>{footer}</p> : null}
      </section>
    </main>
  );
}
