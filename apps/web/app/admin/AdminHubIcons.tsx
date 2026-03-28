import type { ReactElement } from "react";

/** Icons used on the admin hub cards and admin sidebar (same strokes / style). */
export type HubCardIconType = "users" | "departments" | "documents" | "activity" | "audit" | "system";

export type AdminHubGlyphType = HubCardIconType | "hub";

type Props = {
  type: AdminHubGlyphType;
  className?: string;
};

/**
 * Outline icons matching the admin hub (`AdminHubClient` cards): stroke 1.2, 24×24 viewBox.
 */
export function AdminHubGlyph({ type, className }: Props): ReactElement {
  const common = { className, viewBox: "0 0 24 24" as const, fill: "none" as const, "aria-hidden": true as const };

  switch (type) {
    case "hub":
      /* 2×2 grid — landing / hub */
      return (
        <svg {...common}>
          <rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <rect x="13" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <rect x="4" y="13" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <rect x="13" y="13" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case "users":
      /* ID / profile card — user directory */
      return (
        <svg {...common}>
          <rect x="5" y="4.5" width="14" height="15" rx="2" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="12" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.2" />
          <path
            d="M8.2 15.8c.8-1.5 2.2-2.3 3.8-2.3s3 .8 3.8 2.3"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <path d="M7 18.5h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case "departments":
      /* Org hierarchy: parent node + two children */
      return (
        <svg {...common}>
          <rect x="9" y="3.5" width="6" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
          <path d="M12 7.5v3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M6 14.5h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M6 11v3.5M18 11v3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <rect x="3.5" y="14.5" width="5" height="5" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
          <rect x="15.5" y="14.5" width="5" height="5" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case "documents":
      /* Stacked files — export / library */
      return (
        <svg {...common}>
          <path
            d="M6.5 8.5 6.5 19c0 .8.7 1.5 1.5 1.5h9"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M8 6.5h6l3 3v9.5H9.5A1.5 1.5 0 0 1 8 17.5V6.5z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <path d="M14 6.5v3.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M10.5 12.5h5M10.5 15h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case "activity":
      /* Closed padlock — sign-in & account security events */
      return (
        <svg {...common}>
          <rect x="6.5" y="10.5" width="11" height="9.5" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <path
            d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <circle cx="12" cy="15" r="1.4" stroke="currentColor" strokeWidth="1.2" />
          <path d="M12 16.4v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case "audit":
      /* Document under magnifier — document audit */
      return (
        <svg {...common}>
          <path
            d="M5.5 5.5h6l2.5 2.5v9.5h-7A1.5 1.5 0 0 1 5.5 16V5.5z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <path d="M11.5 5.5v2.5h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M8 11h4.5M8 13.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="16.5" cy="15.5" r="3.2" stroke="currentColor" strokeWidth="1.2" />
          <path d="M18.8 17.8 21 20" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case "system":
      /* Gauge — health / stats */
      return (
        <svg {...common}>
          <path
            d="M4.5 14.5a7.5 7.5 0 1 1 15 0"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <path d="M12 14.5 15.5 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="14.5" r="1.3" fill="currentColor" />
          <path d="M7 19.5h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
  }
}
