import type { Response } from "express";

/** Client-routable feature keys for 403 FEATURE_RESTRICTED responses. */
export type RestrictionFeatureKey =
  | "accessDocuments"
  | "manageDocuments"
  | "useAiQueries"
  | "accessDashboard";

export type UserRestrictions = {
  loginAllowed: boolean;
  accessDocumentsAllowed: boolean;
  manageDocumentsAllowed: boolean;
  accessDashboardAllowed: boolean;
  useAiQueriesAllowed: boolean;
};

export function restrictionPayloadFromUser(row: {
  loginAllowed: boolean;
  accessDocumentsAllowed: boolean;
  manageDocumentsAllowed: boolean;
  accessDashboardAllowed: boolean;
  useAiQueriesAllowed: boolean;
}): UserRestrictions {
  return {
    loginAllowed: row.loginAllowed,
    accessDocumentsAllowed: row.accessDocumentsAllowed,
    manageDocumentsAllowed: row.manageDocumentsAllowed,
    accessDashboardAllowed: row.accessDashboardAllowed,
    useAiQueriesAllowed: row.useAiQueriesAllowed,
  };
}

export function jsonFeatureRestricted(res: Response, feature: RestrictionFeatureKey, message?: string): void {
  res.status(403).json({
    error: message ?? "You do not have permission to use this feature.",
    code: "FEATURE_RESTRICTED",
    feature,
  });
}
