import { RoleName } from "@prisma/client";
import { Router } from "express";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

export const managerRouter = Router();

managerRouter.use(authenticateToken, requireRole(RoleName.MANAGER));

/** Department profile + members (read-only). Scoped to the manager's department. */
managerRouter.get("/department", async (req, res) => {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!user.departmentId) {
    res.status(400).json({ error: "Your account is not assigned to a department." });
    return;
  }

  const department = await prisma.department.findUnique({
    where: { id: user.departmentId },
    select: { id: true, name: true, parentDepartmentId: true },
  });
  if (!department) {
    res.status(404).json({ error: "Department not found" });
    return;
  }

  const members = await prisma.user.findMany({
    where: { departmentId: user.departmentId, deletedAt: null },
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
