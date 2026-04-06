/** Returned in JSON on 401/403 from auth middleware so clients can refresh or re-login deliberately. */
export const AuthErrorCode = {
  MISSING_BEARER: "MISSING_BEARER",
  /** JWT missing, malformed, expired, or bad signature. */
  INVALID_ACCESS_TOKEN: "INVALID_ACCESS_TOKEN",
  /** User missing, inactive, deleted, or authVersion does not match the token. */
  INVALID_SESSION: "INVALID_SESSION",
  /** Token authVersion is behind the user row (sessions were rotated). */
  AUTH_VERSION_MISMATCH: "AUTH_VERSION_MISMATCH",
  /** Token role / email / primary department no longer matches the database (refresh for a new access token). */
  ACCESS_TOKEN_OUTDATED: "ACCESS_TOKEN_OUTDATED",
} as const;

export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode];
