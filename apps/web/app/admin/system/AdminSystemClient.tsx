"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import { usePathname } from "next/navigation";
import { fetchWithAuth } from "../../../lib/authClient";
import dash from "../../components/shellNav.module.css";
import { AdminChromeHeader } from "../AdminChromeHeader";
import { AdminHubGlyph, type AdminHubGlyphType } from "../AdminHubIcons";
import u from "../users/adminUsers.module.css";
import styles from "./adminSystem.module.css";
import { useAdminGuard } from "../useAdminGuard";
import { API_BASE as API } from "@/lib/apiBase";

type KpiPeriod = "daily" | "weekly" | "monthly" | "yearly";

type KpiModule = "users" | "documents" | "departments" | "system" | "ai";

type KpiRow = {
  id: string;
  module: KpiModule;
  label: string;
  value: string;
  basis: string;
  /** Null when fromZeroBaseline (first activity vs none in prior window). */
  changePercent: number | null;
  fromZeroBaseline?: boolean;
  trend: "up" | "down" | "flat";
  invertTrend?: boolean;
};

type KpiModuleSection = {
  id: string;
  title: string;
  kpis: KpiRow[];
};

type KpisResponse = {
  period: KpiPeriod;
  periodLabel: string;
  modules: KpiModuleSection[];
  kpis: KpiRow[];
};

type TimeseriesResponse = {
  kpiId: string;
  title: string;
  seriesLabel: string;
  labels: string[];
  values: number[];
};

const PERIOD_OPTIONS: { value: KpiPeriod; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Year" },
];

const ADMIN_SIDEBAR_LINKS: { href: string; label: string; icon: AdminHubGlyphType }[] = [
  { href: "/admin", label: "Hub", icon: "hub" },
  { href: "/admin/users", label: "Users", icon: "users" },
  { href: "/admin/departments", label: "Departments", icon: "departments" },
  { href: "/admin/documents", label: "Documents", icon: "documents" },
  { href: "/admin/activity", label: "Activity", icon: "activity" },
  { href: "/admin/document-audit", label: "Doc audit", icon: "audit" },
  { href: "/admin/system", label: "System", icon: "system" },
];

const MODULE_ICON_CLASS: Record<KpiModule, string> = {
  users: styles.iconModUsers,
  documents: styles.iconModDocuments,
  departments: styles.iconModDepartments,
  system: styles.iconModSystem,
  ai: styles.iconModAi,
};

function adminNavActive(href: string, pathname: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function formatKpiValue(raw: string): string {
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return raw;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
}

function formatTrendPercent(k: KpiRow): string {
  if (k.fromZeroBaseline) return "New";
  if (k.changePercent === null) return "—";
  if (k.trend === "flat" && k.changePercent === 0) return "0%";
  return `${k.changePercent >= 0 ? "+" : ""}${k.changePercent}%`;
}

function formatAxisTick(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k % 1 === 0 ? k : k.toFixed(1)}K`;
  }
  return String(Math.round(n));
}

function KpiLineChart({
  labels,
  values,
  accent,
}: {
  labels: string[];
  values: number[];
  accent: "blue" | "red";
}) {
  const w = 560;
  const h = 220;
  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 40;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const maxV = Math.max(...values, 1);
  const n = values.length;
  const stroke = accent === "red" ? "#dc2626" : "#2563eb";

  const points = values.map((v, i) => {
    const x = n <= 1 ? padL + innerW / 2 : padL + (i / (n - 1)) * innerW;
    const y = padT + innerH - (v / maxV) * innerH;
    return { x, y, v };
  });

  const lineD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const gridSteps = 4;
  const gridYs = Array.from({ length: gridSteps + 1 }, (_, k) => padT + innerH * (1 - k / gridSteps));

  return (
    <svg className={styles.chartSvg} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="12 month trend chart">
      {gridYs.map((gy, i) => (
        <line key={gy} className={styles.chartGrid} x1={padL} y1={gy} x2={padL + innerW} y2={gy} />
      ))}
      {gridYs.map((gy, i) => (
        <text key={`y-${i}`} className={styles.chartAxisText} x={4} y={gy + 4} textAnchor="start">
          {formatAxisTick((maxV * i) / gridSteps)}
        </text>
      ))}
      <path d={lineD} className={styles.chartLine} stroke={stroke} />
      {points.map((p, i) => (
        <circle key={labels[i] ?? i} cx={p.x} cy={p.y} r={4} className={styles.chartDot} fill={stroke} />
      ))}
      {labels.map((lab, i) => {
        const x = n <= 1 ? padL + innerW / 2 : padL + (i / (n - 1)) * innerW;
        return (
          <text
            key={lab}
            className={styles.chartAxisText}
            x={x}
            y={h - 8}
            textAnchor="middle"
            transform={`rotate(-35 ${x} ${h - 8})`}
          >
            {lab.replace(/ \d{4}$/, "")}
          </text>
        );
      })}
    </svg>
  );
}

function KpiAnalyticsModal({
  k,
  onClose,
  apiBase,
}: {
  k: KpiRow | null;
  onClose: () => void;
  apiBase: string;
}) {
  const titleId = useId();
  const [view, setView] = useState<"chart" | "table">("chart");
  const [data, setData] = useState<TimeseriesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!k) return;
    setView("chart");
    setData(null);
    setErr(null);
    setLoading(true);
    let cancelled = false;
    void (async () => {
      const res = await fetchWithAuth(`${apiBase}/admin/stats/kpis/${encodeURIComponent(k.id)}/timeseries`);
      if (cancelled) return;
      if (!res.ok) {
        setErr("Could not load trend data.");
        setLoading(false);
        return;
      }
      const json = (await res.json()) as TimeseriesResponse;
      setData(json);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [k, apiBase]);

  useEffect(() => {
    if (!k) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [k, onClose]);

  if (!k) return null;

  const accent = k.invertTrend ? "red" : "blue";
  const modal = (
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.modalPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div>
            <h2 className={styles.modalTitle} id={titleId}>
              Analytics
            </h2>
            <p className={styles.modalSubtitle}>
              {data?.title ?? k.label}
              {data?.seriesLabel ? ` · ${data.seriesLabel}` : ""}
            </p>
          </div>
          <div className={styles.modalHeaderActions}>
            <div className={styles.viewToggle} role="group" aria-label="View mode">
              <button
                type="button"
                className={view === "chart" ? `${styles.viewToggleBtn} ${styles.viewToggleBtnActive}` : styles.viewToggleBtn}
                onClick={() => setView("chart")}
              >
                Chart
              </button>
              <button
                type="button"
                className={view === "table" ? `${styles.viewToggleBtn} ${styles.viewToggleBtnActive}` : styles.viewToggleBtn}
                onClick={() => setView("table")}
              >
                Table
              </button>
            </div>
            <button type="button" className={styles.modalClose} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className={styles.modalBody}>
          {loading ? <p className={styles.modalLoading}>Loading…</p> : null}
          {err ? (
            <p className={styles.modalError} role="alert">
              {err}
            </p>
          ) : null}
          {!loading && !err && data ? (
            view === "chart" ? (
              <div className={styles.chartWrap}>
                <KpiLineChart labels={data.labels} values={data.values} accent={accent} />
              </div>
            ) : (
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.labels.map((lab, i) => (
                    <tr key={lab}>
                      <td>{lab}</td>
                      <td>{formatKpiValue(String(data.values[i] ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : null}
        </div>
      </div>
    </div>
  );

  return modal;
}

const svgProps = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  "aria-hidden": true as const,
};

function KpiGlyph({ id }: { id: string }) {
  const stroke = "currentColor";
  const w = 1.75;
  switch (id) {
    case "users_total":
      return (
        <svg {...svgProps}>
          <path
            stroke={stroke}
            strokeWidth={w}
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
          />
          <circle cx="9" cy="7" r="4" stroke={stroke} strokeWidth={w} />
          <path
            stroke={stroke}
            strokeWidth={w}
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M22 21v-2a4 4 0 0 0-3-3.87m-4-10.13a4 4 0 0 1 0 7.75"
          />
        </svg>
      );
    case "users_active":
      return (
        <svg {...svgProps}>
          <path
            stroke={stroke}
            strokeWidth={w}
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"
          />
          <circle cx="12" cy="7" r="4" stroke={stroke} strokeWidth={w} />
          <path
            stroke={stroke}
            strokeWidth={w}
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12l2 2 4-4"
          />
        </svg>
      );
    case "documents_total":
      return (
        <svg {...svgProps}>
          <path
            stroke={stroke}
            strokeWidth={w}
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z"
          />
          <path stroke={stroke} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" d="M14 2v6h6" />
          <path stroke={stroke} strokeWidth={w} strokeLinecap="round" d="M10 13h4M10 17h4" />
        </svg>
      );
    case "documents_archived":
      return (
        <svg {...svgProps}>
          <path
            stroke={stroke}
            strokeWidth={w}
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 8v13H3V8"
          />
          <path
            stroke={stroke}
            strokeWidth={w}
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M1 3h22v5H1z"
          />
          <path stroke={stroke} strokeWidth={w} strokeLinecap="round" d="M10 12h4" />
        </svg>
      );
    case "departments":
      return (
        <svg {...svgProps}>
          <path
            stroke={stroke}
            strokeWidth={w}
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"
          />
          <path stroke={stroke} strokeWidth={w} strokeLinecap="round" d="M6 12h4M14 12h4M6 8h4M14 8h4" />
          <path stroke={stroke} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" d="M6 22h12" />
        </svg>
      );
    case "versions_failed":
      return (
        <svg {...svgProps}>
          <path
            stroke={stroke}
            strokeWidth={w}
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v4m0 4h.01M5.07 19h13.86a2 2 0 0 0 1.73-3l-6.93-12a2 2 0 0 0-3.46 0l-6.93 12a2 2 0 0 0 1.73 3Z"
          />
        </svg>
      );
    case "logins":
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="8" r="4" stroke={stroke} strokeWidth={w} />
          <path
            stroke={stroke}
            strokeWidth={w}
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 20a8 8 0 0 1 16 0"
          />
          <path
            stroke={stroke}
            strokeWidth={w}
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 13l3 3-3 3"
          />
          <path stroke={stroke} strokeWidth={w} strokeLinecap="round" d="M18 16H9" />
        </svg>
      );
    case "document_activity":
      return (
        <svg {...svgProps}>
          <path
            stroke={stroke}
            strokeWidth={w}
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 3v18h18"
          />
          <path stroke={stroke} strokeWidth={w} strokeLinecap="round" d="M7 16l3-4 3 3 4-6 3 4" />
        </svg>
      );
    case "ai_chunks":
      return (
        <svg {...svgProps}>
          <path
            stroke={stroke}
            strokeWidth={w}
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3a7 7 0 1 0 10 10"
          />
          <path
            stroke={stroke}
            strokeWidth={w}
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 11v4M10 13h4"
          />
          <path
            stroke={stroke}
            strokeWidth={w}
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4.5 15.5A7 7 0 0 1 9 5.1"
          />
          <circle cx="18" cy="6" r="2" stroke={stroke} strokeWidth={w} />
        </svg>
      );
    default:
      return (
        <svg {...svgProps}>
          <path
            stroke={stroke}
            strokeWidth={w}
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M22 12h-4l-3 9L9 3l-3 9H2"
          />
        </svg>
      );
  }
}

function KpiCard({ k, onSelect }: { k: KpiRow; onSelect: (row: KpiRow) => void }) {
  const invert = k.invertTrend === true;
  const upClass = invert ? styles.trendBad : styles.trendGood;
  const downClass = invert ? styles.trendGood : styles.trendBad;
  const flatClass = styles.trendFlat;
  const trendClass = k.trend === "up" ? upClass : k.trend === "down" ? downClass : flatClass;
  const pct = formatTrendPercent(k);
  const iconClass = MODULE_ICON_CLASS[k.module] ?? styles.iconModUsers;

  return (
    <button
      type="button"
      className={`${styles.kpiCard} ${styles.kpiCardInteractive}`}
      onClick={() => onSelect(k)}
      aria-label={`Open analytics for ${k.label}, 12 month trend`}
    >
      <div className={`${styles.kpiIconWrap} ${iconClass}`}>
        <KpiGlyph id={k.id} />
      </div>
      <p className={styles.kpiLabel}>{k.label}</p>
      <div className={styles.kpiTrendRow}>
        <span className={`${styles.trendArrow} ${trendClass}`} aria-hidden>
          {k.trend === "up" ? "↑" : k.trend === "down" ? "↓" : "→"}
        </span>
        <span className={`${styles.trendPct} ${trendClass}`}>{pct}</span>
        <span className={styles.kpiBasis}>{k.basis}</span>
      </div>
      <p className={styles.kpiValue}>{formatKpiValue(k.value)}</p>
    </button>
  );
}

export default function AdminSystemClient() {
  const pathname = usePathname();
  const { phase, sessionUser } = useAdminGuard();
  const [period, setPeriod] = useState<KpiPeriod>("weekly");
  const [kpis, setKpis] = useState<KpisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedKpi, setSelectedKpi] = useState<KpiRow | null>(null);

  const loadKpis = useCallback(async (p: KpiPeriod) => {
    setError(null);
    try {
      const res = await fetchWithAuth(`${API}/admin/stats/kpis?period=${encodeURIComponent(p)}`);
      if (!res.ok) {
        setError("Could not load KPIs.");
        return;
      }
      const data = (await res.json()) as KpisResponse;
      setKpis(data);
    } catch {
      setError("Could not reach the server.");
    }
  }, []);

  useEffect(() => {
    if (phase !== "ready") return;
    void loadKpis(period);
  }, [phase, period, loadKpis]);

  if (phase === "checking") {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }

  if (phase === "need-login") {
    return (
      <main style={{ maxWidth: 520 }}>
        <h1>System</h1>
        <p style={{ color: "#52525b" }}>Sign in to continue.</p>
        <Link href="/login">Sign in</Link>
      </main>
    );
  }

  if (phase === "forbidden") {
    return (
      <main style={{ maxWidth: 520 }}>
        <h1>System</h1>
        <p style={{ color: "var(--error)" }}>Administrators only.</p>
        <Link prefetch={false} href="/dashboard">Dashboard</Link>
      </main>
    );
  }

  if (phase === "load-error") {
    return (
      <main className={dash.page} data-dashboard-fullscreen="true">
        {sessionUser ? <AdminChromeHeader user={sessionUser} /> : null}
        <div className={styles.fallbackWrap}>
          <p style={{ color: "var(--error)" }}>Could not verify access.</p>
          <Link prefetch={false} href="/admin">Admin hub</Link>
        </div>
      </main>
    );
  }

  if (!sessionUser) {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main className={u.shell} data-dashboard-fullscreen="true">
      <AdminChromeHeader user={sessionUser} className={`${dash.navbar} ${u.navbarRow}`} />
      <div className={u.adminBody}>
        <aside className={u.adminSidebar} aria-label="Admin sections">
          {ADMIN_SIDEBAR_LINKS.map(({ href, label, icon }) => {
            const active = adminNavActive(href, pathname ?? "");
            return (
              <Link
                key={href}
                href={href}
                className={active ? `${u.sidebarLink} ${u.sidebarLinkActive}` : u.sidebarLink}
                aria-current={active ? "page" : undefined}
              >
                <AdminHubGlyph type={icon} className={u.sidebarIcon} />
                <span className={u.sidebarLabel}>{label}</span>
              </Link>
            );
          })}
        </aside>

        <div className={u.main}>
          <div className={u.pageHead}>
            <div>
              <h1 className={u.pageTitle}>System overview</h1>
              <p className={u.pageSubtitle}>Platform KPIs by area, with period-over-period change.</p>
            </div>
          </div>

          <div className={styles.kpiToolbar}>
            <div className={styles.periodGroup} role="group" aria-label="Comparison period">
              {PERIOD_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={period === value ? `${styles.periodBtn} ${styles.periodBtnActive}` : styles.periodBtn}
                  onClick={() => setPeriod(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className={styles.refreshBtn} onClick={() => void loadKpis(period)}>
              Refresh
            </button>
          </div>

          {kpis ? (
            <p className={styles.periodHint}>
              Comparing <strong>{kpis.periodLabel}</strong>
            </p>
          ) : null}

      {error ? (
            <p role="alert" className={styles.errorText}>
          {error}
        </p>
      ) : null}

          {kpis ? (
            <div className={styles.moduleStack}>
              {kpis.modules.map((section) => (
                <section key={section.id} className={styles.moduleSection} aria-labelledby={`kpi-mod-${section.id}`}>
                  <h2 className={styles.moduleTitle} id={`kpi-mod-${section.id}`}>
                    {section.title}
                  </h2>
                  <div className={styles.kpiGrid}>
                    {section.kpis.map((k) => (
                      <KpiCard key={k.id} k={k} onSelect={setSelectedKpi} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : !error ? (
            <p className={styles.emptyText}>Loading metrics…</p>
          ) : null}

          <KpiAnalyticsModal k={selectedKpi} onClose={() => setSelectedKpi(null)} apiBase={API} />
        </div>
      </div>
    </main>
  );
}
