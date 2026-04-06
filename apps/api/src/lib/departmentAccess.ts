import { DepartmentAccessLevel } from "@prisma/client";
import { prisma } from "./prisma.js";

export type ResolvedDepartmentAccess = {
  departmentId: string;
  accessLevel: DepartmentAccessLevel;
  inherited: boolean;
};

let _treeCache: { tree: Map<string, string | null>; expiresAt: number } | null = null;
const TREE_TTL_MS = 30_000;

/**
 * Load the full department tree (lightweight: id + parentId only).
 * Cached for 30 s to avoid redundant full-table scans on every authenticated request.
 */
async function loadDepartmentTree(): Promise<Map<string, string | null>> {
  if (_treeCache && Date.now() < _treeCache.expiresAt) return _treeCache.tree;
  const depts = await prisma.department.findMany({
    select: { id: true, parentDepartmentId: true },
  });
  const tree = new Map<string, string | null>();
  for (const d of depts) {
    tree.set(d.id, d.parentDepartmentId);
  }
  _treeCache = { tree, expiresAt: Date.now() + TREE_TTL_MS };
  return tree;
}

/**
 * Given a department tree, find all descendant department IDs of `parentId`.
 */
function getDescendants(tree: Map<string, string | null>, parentId: string): string[] {
  const descendants: string[] = [];
  const visited = new Set<string>([parentId]);
  const queue = [parentId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const [id, parent] of tree) {
      if (parent === current && !visited.has(id)) {
        visited.add(id);
        descendants.push(id);
        queue.push(id);
      }
    }
  }
  return descendants;
}

/**
 * Resolve all departments a user can access, including inherited access
 * from parent departments down to their children.
 *
 * Rules:
 * - Direct assignments from UserDepartmentAccess
 * - If user has MANAGER access to a parent dept, they get MANAGER to all children
 * - If user has MEMBER access to a parent dept, they get VIEWER to all children
 * - If user has VIEWER access to a parent dept, they get VIEWER to all children
 * - Direct assignments always take precedence over inherited ones
 */
export async function resolveUserDepartmentAccess(
  userId: string,
): Promise<ResolvedDepartmentAccess[]> {
  const [directAccess, tree] = await Promise.all([
    prisma.userDepartmentAccess.findMany({
      where: { userId },
      select: { departmentId: true, accessLevel: true },
    }),
    loadDepartmentTree(),
  ]);

  const result = new Map<string, ResolvedDepartmentAccess>();

  for (const da of directAccess) {
    result.set(da.departmentId, {
      departmentId: da.departmentId,
      accessLevel: da.accessLevel,
      inherited: false,
    });
  }

  for (const da of directAccess) {
    const descendants = getDescendants(tree, da.departmentId);
    const inheritedLevel: DepartmentAccessLevel =
      da.accessLevel === DepartmentAccessLevel.MANAGER
        ? DepartmentAccessLevel.MANAGER
        : DepartmentAccessLevel.VIEWER;

    for (const childId of descendants) {
      const existing = result.get(childId);
      if (!existing) {
        result.set(childId, {
          departmentId: childId,
          accessLevel: inheritedLevel,
          inherited: true,
        });
      } else if (existing.inherited) {
        const priority = accessPriority(inheritedLevel);
        if (priority > accessPriority(existing.accessLevel)) {
          existing.accessLevel = inheritedLevel;
        }
      }
    }
  }

  return Array.from(result.values());
}

function accessPriority(level: DepartmentAccessLevel): number {
  switch (level) {
    case DepartmentAccessLevel.MANAGER:
      return 3;
    case DepartmentAccessLevel.MEMBER:
      return 2;
    case DepartmentAccessLevel.VIEWER:
      return 1;
  }
}

/**
 * Get all department IDs a user can read documents from.
 * Includes MEMBER, MANAGER, and VIEWER access.
 */
export async function getReadableDepartmentIds(userId: string): Promise<string[]> {
  const access = await resolveUserDepartmentAccess(userId);
  return access.map((a) => a.departmentId);
}

/**
 * Get all department IDs a user can manage (MANAGER access).
 */
export async function getManageableDepartmentIds(userId: string): Promise<string[]> {
  const access = await resolveUserDepartmentAccess(userId);
  return access
    .filter((a) => a.accessLevel === DepartmentAccessLevel.MANAGER)
    .map((a) => a.departmentId);
}

/**
 * Check if a user has at least viewer access to a specific department.
 */
export async function canAccessDepartment(
  userId: string,
  departmentId: string,
): Promise<boolean> {
  const access = await resolveUserDepartmentAccess(userId);
  return access.some((a) => a.departmentId === departmentId);
}

/**
 * Check if a user can manage a specific department.
 */
export async function canManageDepartment(
  userId: string,
  departmentId: string,
): Promise<boolean> {
  const access = await resolveUserDepartmentAccess(userId);
  return access.some(
    (a) => a.departmentId === departmentId && a.accessLevel === DepartmentAccessLevel.MANAGER,
  );
}
