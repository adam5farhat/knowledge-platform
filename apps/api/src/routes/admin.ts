import { Prisma, RoleName } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../lib/password.js";
import { mapUserResponse } from "../lib/mapUser.js";
import { authenticateToken, requireRole } from "../middleware/auth.js";

export const adminRouter = Router();

const createUserBody = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1).max(200),
  role: z.nativeEnum(RoleName),
  departmentId: z.string().uuid(),
  employeeBadgeNumber: z.string().max(100).optional().nullable(),
  phoneNumber: z.string().max(50).optional().nullable(),
  position: z.string().max(200).optional().nullable(),
});
const createDepartmentBody = z.object({
  name: z.string().min(1).max(200),
  parentDepartmentId: z.string().uuid().optional().nullable(),
});

adminRouter.get("/departments", authenticateToken, requireRole(RoleName.ADMIN), async (_req, res) => {
  const departments = await prisma.department.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  res.json({ departments });
});

adminRouter.get("/roles", authenticateToken, requireRole(RoleName.ADMIN), async (_req, res) => {
  const roles = await prisma.role.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, description: true },
  });
  res.json({ roles });
});

adminRouter.post("/departments", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const parsed = createDepartmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Department name is required" });
    return;
  }

  if (parsed.data.parentDepartmentId) {
    const parent = await prisma.department.findUnique({
      where: { id: parsed.data.parentDepartmentId },
      select: { id: true },
    });
    if (!parent) {
      res.status(400).json({ error: "Parent department not found" });
      return;
    }
  }

  const existing = await prisma.department.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) {
    res.status(409).json({ error: "A department with that name already exists" });
    return;
  }

  const department = await prisma.department.create({
    data: {
      name,
      ...(parsed.data.parentDepartmentId ? { parentDepartmentId: parsed.data.parentDepartmentId } : {}),
    },
    select: { id: true, name: true },
  });

  res.status(201).json({ department });
});

adminRouter.post("/users", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const parsed = createUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const { email, password, name, role, departmentId, employeeBadgeNumber, phoneNumber, position } =
    parsed.data;
  const normalizedBadge = employeeBadgeNumber?.trim();
  if (role === RoleName.EMPLOYEE && !normalizedBadge) {
    res.status(400).json({ error: "Employee badge number is required for EMPLOYEE accounts" });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: "Email already in use" });
    return;
  }

  const department = await prisma.department.findUnique({
    where: { id: departmentId },
  });
  if (!department) {
    res.status(400).json({ error: "Department not found" });
    return;
  }

  const roleRecord = await prisma.role.findUnique({ where: { name: role } });
  if (!roleRecord) {
    res.status(400).json({ error: "Invalid role" });
    return;
  }

  const passwordHash = await hashPassword(password);

  try {
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        roleId: roleRecord.id,
        departmentId: department.id,
        employeeBadgeNumber: normalizedBadge || undefined,
        phoneNumber: phoneNumber ?? undefined,
        position: position ?? undefined,
      },
      include: {
        role: true,
        department: true,
      },
    });

    res.status(201).json({ user: mapUserResponse(user) });
  } catch (e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const meta = e.meta as { target?: string[] } | undefined;
      const target = meta?.target?.join(" ") ?? "";
      if (target.includes("employeeBadgeNumber")) {
        res.status(409).json({ error: "That employee badge number is already in use" });
        return;
      }
      res.status(409).json({ error: "Email already in use" });
      return;
    }
    throw e;
  }
});
