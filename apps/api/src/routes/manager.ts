import { Router } from "express";
import { authenticateToken, requireManagerDashboardAccess } from "../middleware/auth.js";
import { isPlatformAdmin, isGlobalManagerRole } from "../lib/platformRoles.js";
import { prisma } from "../lib/prisma.js";

export const managerRouter = Router();

managerRouter.use(authenticateToken, requireManagerDashboardAccess);

function departmentIdsForManagerPicker(user: NonNullable<Express.Request["authUser"]>): Promise<string[]> {
  if (isPlatformAdmin(user.role)) {
    return prisma.department.findMany({ select: { id: true } }).then((rows) => rows.map((r) => r.id));
  }
  const set = new Set(user.manageableDepartmentIds ?? []);
  if (isGlobalManagerRole(user.role) && user.departmentId) {
    set.add(user.departmentId);
  }
  return Promise.resolve([...set]);
}

function canManageDepartmentInUi(user: NonNullable<Express.Request["authUser"]>, deptId: string): boolean {
  if (isPlatformAdmin(user.role)) return true;
  if ((user.manageableDepartmentIds ?? []).includes(deptId)) return true;
  if (isGlobalManagerRole(user.role) && deptId === user.departmentId) return true;
  return false;
}

/** All departments the manager can manage, with members. */
managerRouter.get("/departments", async (req, res) => {
  const user = req.authUser;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const idList = await departmentIdsForManagerPicker(user);
  if (idList.length === 0) {
    res.json({ departments: [] });
    return;
  }

  const departments = await prisma.department.findMany({
    where: { id: { in: idList } },
    select: { id: true, name: true, parentDepartmentId: true },
    orderBy: { name: "asc" },
  });

  res.json({ departments });
});

/** Single department profile + members. Checks access. */
managerRouter.get("/department", async (req, res) => {
  const user = req.authUser;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const deptId = (typeof req.query.departmentId === "string" && req.query.departmentId) || user.departmentId;
  if (!deptId) {
    res.status(400).json({ error: "Your account is not assigned to a department." });
    return;
  }

  if (!canManageDepartmentInUi(user, deptId)) {
    res.status(403).json({ error: "You do not have management access to that department." });
    return;
  }

  const department = await prisma.department.findUnique({
    where: { id: deptId },
    select: { id: true, name: true, parentDepartmentId: true },
  });
  if (!department) {
    res.status(404).json({ error: "Department not found" });
    return;
  }

  const members = await prisma.user.findMany({
    where: { departmentId: deptId, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      position: true,
      employeeBadgeNumber: true,
      isActive: true,
      lastLoginAt: true,
      profilePictureUrl: true,
      role: { select: { name: true } },
    },
    orderBy: [{ name: "asc" }],
  });

  res.json({
    department,
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      position: m.position,
      employeeBadgeNumber: m.employeeBadgeNumber,
      isActive: m.isActive,
      lastLoginAt: m.lastLoginAt?.toISOString() ?? null,
      profilePictureUrl: m.profilePictureUrl,
      role: m.role.name,
    })),
  });
});
