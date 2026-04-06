import type { NextFunction, Request, Response } from "express";
import { isEmployeeRole } from "../lib/platformRoles.js";
import { jsonFeatureRestricted } from "../lib/userRestrictions.js";

export function requireDocLibraryAccess(req: Request, res: Response, next: NextFunction): void {
  const u = req.authUser;
  if (!u) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!u.accessDocumentsAllowed) {
    jsonFeatureRestricted(
      res,
      "accessDocuments",
      "You do not have permission to access the document library.",
    );
    return;
  }
  next();
}

/** Role (manager/admin) plus per-user manage flag. */
export function requireManageDocumentsCapability(req: Request, res: Response, next: NextFunction): void {
  const u = req.authUser;
  if (!u) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (isEmployeeRole(u.role)) {
    jsonFeatureRestricted(res, "manageDocuments", "You do not have permission to manage documents.");
    return;
  }
  if (!u.manageDocumentsAllowed) {
    jsonFeatureRestricted(res, "manageDocuments", "You do not have permission to manage documents.");
    return;
  }
  next();
}

export function requireUseAiQueries(req: Request, res: Response, next: NextFunction): void {
  const u = req.authUser;
  if (!u) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!u.useAiQueriesAllowed) {
    jsonFeatureRestricted(res, "useAiQueries", "You do not have permission to use AI search.");
    return;
  }
  next();
}
