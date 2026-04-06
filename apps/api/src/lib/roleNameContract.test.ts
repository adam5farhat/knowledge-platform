import { describe, it, expect } from "vitest";
import { RoleName } from "@prisma/client";

/**
 * If this fails after a Prisma `RoleName` change, update `RoleNameApi` in
 * `apps/web/lib/restrictions.ts` (and any seed/admin UI) to match.
 */
const WEB_ROLE_NAME_API_VALUES = ["ADMIN", "MANAGER", "EMPLOYEE"] as const;

describe("RoleName vs web RoleNameApi", () => {
  it("Prisma enum string values match apps/web/lib/restrictions.ts RoleNameApi", () => {
    const fromPrisma = Object.values(RoleName).filter((v): v is RoleName => typeof v === "string");
    expect([...fromPrisma].sort()).toEqual([...WEB_ROLE_NAME_API_VALUES].sort());
  });
});
