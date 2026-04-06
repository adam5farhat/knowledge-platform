import { AuthEventType, DepartmentAccessLevel, DocumentAuditAction, Prisma, RoleName } from "@prisma/client";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../lib/password.js";
import { mapUserResponse } from "../lib/mapUser.js";
import { syncRefreshSessionsAuthVersion } from "../lib/refreshSessionSync.js";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { isAllowedProfilePictureUrlForUser } from "../lib/avatar.js";
import { AppError } from "../lib/AppError.js";
import { bulkIdsSchema } from "../lib/schemas.js";
import { clearUserAvatar, commitAvatarUpload } from "../lib/avatarOps.js";
import { normalizeStoredIpForDisplay } from "../lib/clientIp.js";

export const adminRouter = Router();

const ADMIN_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const adminAvatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    cb(null, ok);
  },
});

function normalizeProfilePictureInput(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

import { PASSWORD_MIN, PASSWORD_RE, PASSWORD_RULE } from "../lib/passwordPolicy.js";

const createUserBody = z.object({
  email: z.string().email(),
  password: z.string().min(PASSWORD_MIN, PASSWORD_RULE).regex(PASSWORD_RE, PASSWORD_RULE),
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

const patchDepartmentBody = z.object({
  name: z.string().min(1).max(200).optional(),
  parentDepartmentId: z.string().uuid().optional().nullable(),
});

const patchUserBody = z
  .object({
    email: z.string().email().optional(),
    name: z.string().min(1).max(200).optional(),
    role: z.nativeEnum(RoleName).optional(),
    departmentId: z.string().uuid().optional(),
    employeeBadgeNumber: z.string().max(100).optional().nullable(),
    phoneNumber: z.string().max(50).optional().nullable(),
    position: z.string().max(200).optional().nullable(),
    isActive: z.boolean().optional(),
    loginAllowed: z.boolean().optional(),
    accessDocumentsAllowed: z.boolean().optional(),
    manageDocumentsAllowed: z.boolean().optional(),
    accessDashboardAllowed: z.boolean().optional(),
    useAiQueriesAllowed: z.boolean().optional(),
    mustChangePassword: z.boolean().optional(),
    profilePictureUrl: z.string().max(2000).optional().nullable(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "No fields to update" });

const bulkRestrictionsBody = z
  .object({
    ids: bulkIdsSchema,
    loginAllowed: z.boolean().optional(),
    accessDocumentsAllowed: z.boolean().optional(),
    manageDocumentsAllowed: z.boolean().optional(),
    accessDashboardAllowed: z.boolean().optional(),
    useAiQueriesAllowed: z.boolean().optional(),
  })
  .refine(
    (o) =>
      o.loginAllowed !== undefined ||
      o.accessDocumentsAllowed !== undefined ||
      o.manageDocumentsAllowed !== undefined ||
      o.accessDashboardAllowed !== undefined ||
      o.useAiQueriesAllowed !== undefined,
    { message: "No restriction fields to update" },
  );

const importUsersBody = z.object({
  users: z.array(createUserBody).min(1).max(50),
});

const setPasswordBody = z.object({
  password: z.string().min(PASSWORD_MIN, PASSWORD_RULE).regex(PASSWORD_RE, PASSWORD_RULE),
});

const mergeDepartmentsBody = z.object({
  sourceDepartmentId: z.string().uuid(),
  targetDepartmentId: z.string().uuid(),
});

function mapUserAdmin(user: {
  id: string;
  email: string;
  name: string;
  employeeBadgeNumber: string | null;
  phoneNumber: string | null;
  position: string | null;
  profilePictureUrl: string | null;
  isActive: boolean;
  loginAllowed: boolean;
  accessDocumentsAllowed: boolean;
  manageDocumentsAllowed: boolean;
  accessDashboardAllowed: boolean;
  useAiQueriesAllowed: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  deletedAt: Date | null;
  failedLoginAttempts: number;
  loginLockedUntil: Date | null;
  createdAt: Date;
  role: { name: RoleName };
  department: { id: string; name: string };
}) {
  return {
    ...mapUserResponse(user),
    failedLoginAttempts: user.failedLoginAttempts,
    loginLockedUntil: user.loginLockedUntil?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    deletedAt: user.deletedAt?.toISOString() ?? null,
  };
}

function parseBoolQuery(raw: unknown): boolean | undefined {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

async function countActiveAdmins(): Promise<number> {
  return prisma.user.count({
    where: { isActive: true, deletedAt: null, role: { name: RoleName.ADMIN } },
  });
}

async function assertCanChangeAdminRoleOrActive(params: {
  targetUserId: string;
  actingUserId: string;
  nextRole?: RoleName;
  nextIsActive?: boolean;
  currentRole: RoleName;
}) {
  const { targetUserId, actingUserId, nextRole, nextIsActive, currentRole } = params;
  if (currentRole !== RoleName.ADMIN) return;

  const removingAdmin =
    (nextRole !== undefined && nextRole !== RoleName.ADMIN) ||
    (nextIsActive !== undefined && nextIsActive === false);

  if (!removingAdmin) return;

  const admins = await countActiveAdmins();
  if (admins <= 1) {
    throw new Error("Cannot remove or deactivate the last active administrator.");
  }
}

async function departmentChainContains(
  startParentId: string | null,
  forbiddenId: string,
  maxHops = 64,
): Promise<boolean> {
  let current: string | null = startParentId;
  let hops = 0;
  while (current && hops < maxHops) {
    if (current === forbiddenId) return true;
    const p = await prisma.department.findUnique({
      where: { id: current },
      select: { parentDepartmentId: true },
    });
    current = p?.parentDepartmentId ?? null;
    hops += 1;
  }
  return false;
}

adminRouter.get("/departments", authenticateToken, requireRole(RoleName.ADMIN), async (_req, res) => {
  const departments = await prisma.department.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, parentDepartmentId: true },
  });

  const members = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, profilePictureUrl: true, departmentId: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });

  const previewByDept = new Map<string, { id: string; name: string; profilePictureUrl: string | null }[]>();
  const countByDept = new Map<string, number>();
  for (const m of members) {
    countByDept.set(m.departmentId, (countByDept.get(m.departmentId) ?? 0) + 1);
    const list = previewByDept.get(m.departmentId) ?? [];
    if (list.length < 4) {
      list.push({
        id: m.id,
        name: m.name,
        profilePictureUrl: m.profilePictureUrl,
      });
      previewByDept.set(m.departmentId, list);
    }
  }

  res.json({
    departments: departments.map((d) => ({
      ...d,
      memberPreview: previewByDept.get(d.id) ?? [],
      memberCount: countByDept.get(d.id) ?? 0,
    })),
  });
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
    throw AppError.badRequest("Validation failed", undefined, parsed.error.flatten());
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
    select: { id: true, name: true, parentDepartmentId: true },
  });

  res.status(201).json({ department });
});

adminRouter.patch("/departments/:departmentId", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const parsed = patchDepartmentBody.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest("Validation failed", undefined, parsed.error.flatten());
  }

  const id = req.params.departmentId;
  const dept = await prisma.department.findUnique({ where: { id } });
  if (!dept) {
    res.status(404).json({ error: "Department not found" });
    return;
  }

  const data: Prisma.DepartmentUncheckedUpdateInput = {};

  if (parsed.data.name !== undefined) {
    const name = parsed.data.name.trim();
    if (!name) {
      res.status(400).json({ error: "Department name is required" });
      return;
    }
    const dup = await prisma.department.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, NOT: { id } },
      select: { id: true },
    });
    if (dup) {
      res.status(409).json({ error: "A department with that name already exists" });
      return;
    }
    data.name = name;
  }

  if (parsed.data.parentDepartmentId !== undefined) {
    const pid = parsed.data.parentDepartmentId;
    if (pid === id) {
      res.status(400).json({ error: "Department cannot be its own parent" });
      return;
    }
    if (pid) {
      const parent = await prisma.department.findUnique({ where: { id: pid }, select: { id: true } });
      if (!parent) {
        res.status(400).json({ error: "Parent department not found" });
        return;
      }
      const cycle = await departmentChainContains(pid, id);
      if (cycle) {
        res.status(400).json({ error: "That parent would create a cycle in the hierarchy" });
        return;
      }
    }
    data.parentDepartmentId = pid;
  }

  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: "No changes" });
    return;
  }

  const updated = await prisma.department.update({
    where: { id },
    data,
    select: { id: true, name: true, parentDepartmentId: true },
  });
  res.json({ department: updated });
});

adminRouter.delete("/departments/:departmentId", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const id = req.params.departmentId;
  const dept = await prisma.department.findUnique({ where: { id } });
  if (!dept) {
    res.status(404).json({ error: "Department not found" });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const [userCount, docCount, childCount] = await Promise.all([
        tx.user.count({ where: { departmentId: id } }),
        tx.document.count({ where: { departmentId: id } }),
        tx.department.count({ where: { parentDepartmentId: id } }),
      ]);

      if (userCount > 0 || docCount > 0 || childCount > 0) {
        throw Object.assign(new Error("Department is still in use"), {
          status: 409,
          body: { error: "Department is still in use", userCount, documentCount: docCount, childDepartmentCount: childCount },
        });
      }

      await tx.department.delete({ where: { id } });
    });
  } catch (err: unknown) {
    const e = err as { status?: number; body?: unknown };
    if (e.status === 409) { res.status(409).json(e.body); return; }
    throw err;
  }
  res.status(204).send();
});

adminRouter.post("/departments/merge", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const parsed = mergeDepartmentsBody.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest("Validation failed", undefined, parsed.error.flatten());
  }
  const { sourceDepartmentId, targetDepartmentId } = parsed.data;
  if (sourceDepartmentId === targetDepartmentId) {
    res.status(400).json({ error: "Source and target must differ" });
    return;
  }

  const [src, tgt] = await Promise.all([
    prisma.department.findUnique({ where: { id: sourceDepartmentId } }),
    prisma.department.findUnique({ where: { id: targetDepartmentId } }),
  ]);
  if (!src || !tgt) {
    res.status(404).json({ error: "Department not found" });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const childCount = await tx.department.count({ where: { parentDepartmentId: sourceDepartmentId } });
      if (childCount > 0) {
        throw Object.assign(new Error("Has children"), { status: 409 });
      }
      await tx.user.updateMany({
        where: { departmentId: sourceDepartmentId },
        data: { departmentId: targetDepartmentId },
      });
      await tx.document.updateMany({
        where: { departmentId: sourceDepartmentId },
        data: { departmentId: targetDepartmentId },
      });
      await tx.department.delete({ where: { id: sourceDepartmentId } });
    });
  } catch (err: unknown) {
    if ((err as { status?: number }).status === 409) {
      res.status(409).json({ error: "Reassign or delete child departments before merging this one" });
      return;
    }
    throw err;
  }

  res.json({ ok: true, mergedInto: { id: tgt.id, name: tgt.name } });
});

adminRouter.get("/users", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? "25"), 10) || 25));
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const departmentId = typeof req.query.departmentId === "string" ? req.query.departmentId.trim() : "";
  /** Users whose primary department is this id OR have a UserDepartmentAccess row (department drill view). */
  const inDepartment = typeof req.query.inDepartment === "string" ? req.query.inDepartment.trim() : "";
  const roleRaw = typeof req.query.role === "string" ? req.query.role.trim().toUpperCase() : "";
  const activeRaw = typeof req.query.isActive === "string" ? req.query.isActive.trim() : "";
  const includeDeleted = req.query.includeDeleted === "1" || req.query.includeDeleted === "true";

  const where: Prisma.UserWhereInput = {};
  if (!includeDeleted) {
    where.deletedAt = null;
  }
  if (q.length > 0) {
    where.OR = [
      { email: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { employeeBadgeNumber: { contains: q, mode: "insensitive" } },
    ];
  }
  if (inDepartment.length > 0) {
    const inDeptClause: Prisma.UserWhereInput = {
      OR: [
        { departmentId: inDepartment },
        { departmentAccess: { some: { departmentId: inDepartment } } },
      ],
    };
    if (where.OR) {
      where.AND = [{ OR: where.OR }, inDeptClause];
      delete where.OR;
    } else {
      where.OR = inDeptClause.OR;
    }
  } else if (departmentId.length > 0) {
    where.departmentId = departmentId;
  }
  if (roleRaw && Object.values(RoleName).includes(roleRaw as RoleName)) {
    where.role = { name: roleRaw as RoleName };
  }
  if (activeRaw === "true") where.isActive = true;
  if (activeRaw === "false") where.isActive = false;

  const la = parseBoolQuery(req.query.loginAllowed);
  if (la !== undefined) where.loginAllowed = la;
  const ada = parseBoolQuery(req.query.accessDocumentsAllowed);
  if (ada !== undefined) where.accessDocumentsAllowed = ada;
  const mda = parseBoolQuery(req.query.manageDocumentsAllowed);
  if (mda !== undefined) where.manageDocumentsAllowed = mda;
  const dba = parseBoolQuery(req.query.accessDashboardAllowed);
  if (dba !== undefined) where.accessDashboardAllowed = dba;
  const uai = parseBoolQuery(req.query.useAiQueriesAllowed);
  if (uai !== undefined) where.useAiQueriesAllowed = uai;
  const mcp = parseBoolQuery(req.query.mustChangePassword);
  if (mcp !== undefined) where.mustChangePassword = mcp;

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ name: "asc" }, { email: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        role: true,
        department: true,
        departmentAccess: {
          include: { department: { select: { id: true, name: true } } },
          orderBy: { department: { name: "asc" } },
        },
      },
    }),
  ]);

  res.json({
    users: rows.map((u) => ({
      ...mapUserAdmin(u),
      departmentAccess: u.departmentAccess.map((da) => ({
        departmentId: da.departmentId,
        departmentName: da.department.name,
        accessLevel: da.accessLevel,
      })),
    })),
    total,
    page,
    pageSize,
  });
});

adminRouter.post("/users", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const parsed = createUserBody.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest("Validation failed", undefined, parsed.error.flatten());
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
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
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
        include: { role: true, department: true },
      });
      const accessLevel = role === RoleName.MANAGER
        ? DepartmentAccessLevel.MANAGER
        : DepartmentAccessLevel.MEMBER;
      await tx.userDepartmentAccess.create({
        data: { userId: u.id, departmentId: department.id, accessLevel },
      });
      return u;
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

adminRouter.patch("/users/:userId", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const parsed = patchUserBody.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest("Validation failed", undefined, parsed.error.flatten());
  }

  const actingUserId = req.authUser!.id;
  const targetIdRaw = req.params.userId;
  if (typeof targetIdRaw !== "string" || !targetIdRaw) {
    res.status(400).json({ error: "Missing user id" });
    return;
  }
  const targetId = targetIdRaw;

  const existing = await prisma.user.findUnique({
    where: { id: targetId },
    include: { role: true },
  });
  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  try {
    await assertCanChangeAdminRoleOrActive({
      targetUserId: targetId,
      actingUserId,
      nextRole: parsed.data.role,
      nextIsActive: parsed.data.isActive,
      currentRole: existing.role.name,
    });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Invalid change" });
    return;
  }

  if (parsed.data.isActive === false && targetId === actingUserId) {
    res.status(400).json({ error: "You cannot deactivate your own account" });
    return;
  }

  if (targetId === actingUserId && parsed.data.loginAllowed === false) {
    res.status(400).json({ error: "You cannot disable login access for your own account" });
    return;
  }

  if (parsed.data.profilePictureUrl !== undefined) {
    const pic = normalizeProfilePictureInput(parsed.data.profilePictureUrl);
    if (typeof pic === "string" && !isAllowedProfilePictureUrlForUser(pic, targetId)) {
      res.status(400).json({ error: "Profile picture URL is not allowed for this user" });
      return;
    }
  }

  const normalizedBadge = parsed.data.employeeBadgeNumber?.trim();
  const nextRoleName = parsed.data.role ?? existing.role.name;
  if (nextRoleName === RoleName.EMPLOYEE) {
    const badge = normalizedBadge ?? existing.employeeBadgeNumber?.trim();
    if (!badge) {
      res.status(400).json({ error: "Employee badge number is required for EMPLOYEE accounts" });
      return;
    }
  }

  if (parsed.data.email && parsed.data.email !== existing.email) {
    const dup = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (dup) {
      res.status(409).json({ error: "Email already in use" });
      return;
    }
  }

  let departmentId = existing.departmentId;
  if (parsed.data.departmentId !== undefined) {
    const d = await prisma.department.findUnique({ where: { id: parsed.data.departmentId } });
    if (!d) {
      res.status(400).json({ error: "Department not found" });
      return;
    }
    departmentId = d.id;
  }

  let roleId = existing.roleId;
  if (parsed.data.role !== undefined) {
    const r = await prisma.role.findUnique({ where: { name: parsed.data.role } });
    if (!r) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }
    roleId = r.id;
  }

  const restrictionFieldsChanged =
    parsed.data.loginAllowed !== undefined ||
    parsed.data.accessDocumentsAllowed !== undefined ||
    parsed.data.manageDocumentsAllowed !== undefined ||
    parsed.data.accessDashboardAllowed !== undefined ||
    parsed.data.useAiQueriesAllowed !== undefined;

  const bumpAuth =
    parsed.data.email !== undefined ||
    parsed.data.role !== undefined ||
    parsed.data.departmentId !== undefined ||
    parsed.data.isActive !== undefined ||
    restrictionFieldsChanged;

  const data: Prisma.UserUpdateInput = {};
  if (parsed.data.email !== undefined) data.email = parsed.data.email;
  if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
  if (parsed.data.phoneNumber !== undefined) data.phoneNumber = parsed.data.phoneNumber;
  if (parsed.data.position !== undefined) data.position = parsed.data.position;
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
  if (parsed.data.loginAllowed !== undefined) data.loginAllowed = parsed.data.loginAllowed;
  if (parsed.data.accessDocumentsAllowed !== undefined) {
    data.accessDocumentsAllowed = parsed.data.accessDocumentsAllowed;
  }
  if (parsed.data.manageDocumentsAllowed !== undefined) {
    data.manageDocumentsAllowed = parsed.data.manageDocumentsAllowed;
  }
  if (parsed.data.accessDashboardAllowed !== undefined) {
    data.accessDashboardAllowed = parsed.data.accessDashboardAllowed;
  }
  if (parsed.data.useAiQueriesAllowed !== undefined) {
    data.useAiQueriesAllowed = parsed.data.useAiQueriesAllowed;
  }
  if (parsed.data.mustChangePassword !== undefined) {
    data.mustChangePassword = parsed.data.mustChangePassword;
  }
  if (parsed.data.employeeBadgeNumber !== undefined) {
    data.employeeBadgeNumber = normalizedBadge || null;
  }
  if (parsed.data.departmentId !== undefined) {
    data.department = { connect: { id: departmentId } };
  }
  if (parsed.data.role !== undefined) {
    data.role = { connect: { id: roleId } };
  }
  if (parsed.data.profilePictureUrl !== undefined) {
    data.profilePictureUrl = normalizeProfilePictureInput(parsed.data.profilePictureUrl) ?? null;
  }
  if (bumpAuth) {
    data.authVersion = { increment: 1 };
  }

  const isRemovingAdmin =
    existing.role.name === RoleName.ADMIN &&
    ((parsed.data.role !== undefined && parsed.data.role !== RoleName.ADMIN) ||
     (parsed.data.isActive !== undefined && parsed.data.isActive === false));

  try {
    const user = await prisma.$transaction(async (tx) => {
      if (isRemovingAdmin) {
        const admins = await tx.user.count({
          where: { isActive: true, deletedAt: null, role: { name: RoleName.ADMIN } },
        });
        if (admins <= 1) {
          throw Object.assign(new Error("Cannot remove or deactivate the last active administrator."), { status: 400 });
        }
      }
      return tx.user.update({
        where: { id: targetId },
        data,
        include: { role: true, department: true },
      });
    }, { isolationLevel: "Serializable" });
    if (bumpAuth) {
      await syncRefreshSessionsAuthVersion(targetId, user.authVersion);
    }
    res.json({ user: mapUserAdmin(user) });
  } catch (e: unknown) {
    if ((e as { status?: number }).status === 400) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      res.status(409).json({ error: "Email or badge already in use" });
      return;
    }
    throw e;
  }
});

adminRouter.post(
  "/users/:userId/avatar",
  authenticateToken,
  requireRole(RoleName.ADMIN),
  (req, res, next) => {
    adminAvatarUpload.single("file")(req, res, (err: unknown) => {
      if (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        res.status(400).json({ error: msg });
        return;
      }
      next();
    });
  },
  async (req, res) => {
    const targetId = req.params.userId;
    if (!targetId) {
      res.status(400).json({ error: "Missing user id" });
      return;
    }
    const file = req.file;
    if (!file?.buffer) {
      res.status(400).json({ error: "Missing file (multipart field name: file)" });
      return;
    }
    const existing = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, deletedAt: true } });
    if (!existing || existing.deletedAt) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    try {
      await commitAvatarUpload(req, targetId, file.buffer);
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: targetId },
        include: { role: true, department: true },
      });
      res.json({ user: mapUserAdmin(user) });
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === "INVALID_IMAGE") {
        res.status(400).json({ error: "Please upload a JPEG, PNG, or WebP image (max 2 MB)." });
        return;
      }
      throw e;
    }
  },
);

adminRouter.delete("/users/:userId/avatar", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const targetId = req.params.userId;
  if (!targetId) {
    res.status(400).json({ error: "Missing user id" });
    return;
  }
  const existing = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, deletedAt: true } });
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  try {
    await clearUserAvatar(targetId);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: targetId },
      include: { role: true, department: true },
    });
    res.json({ user: mapUserAdmin(user) });
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "NOT_FOUND") {
      res.status(404).json({ error: "User not found" });
      return;
    }
    throw e;
  }
});

adminRouter.post("/users/bulk-restrictions", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const parsed = bulkRestrictionsBody.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest("Validation failed", undefined, parsed.error.flatten());
  }

  const actingUserId = req.authUser!.id;
  const { ids, ...patch } = parsed.data;
  const uniqueIds = [...new Set(ids)];

  const data: Prisma.UserUpdateInput = {};
  if (patch.loginAllowed !== undefined) data.loginAllowed = patch.loginAllowed;
  if (patch.accessDocumentsAllowed !== undefined) data.accessDocumentsAllowed = patch.accessDocumentsAllowed;
  if (patch.manageDocumentsAllowed !== undefined) data.manageDocumentsAllowed = patch.manageDocumentsAllowed;
  if (patch.accessDashboardAllowed !== undefined) data.accessDashboardAllowed = patch.accessDashboardAllowed;
  if (patch.useAiQueriesAllowed !== undefined) data.useAiQueriesAllowed = patch.useAiQueriesAllowed;

  let updatedCount = 0;
  try {
    await prisma.$transaction(async (tx) => {
      for (const id of uniqueIds) {
        if (id === actingUserId && patch.loginAllowed === false) {
          continue;
        }
        const u = await tx.user.update({
          where: { id },
          data: {
            ...data,
            authVersion: { increment: 1 },
          },
        });
        await tx.refreshSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { authVersion: u.authVersion },
        });
        updatedCount += 1;
      }
    });
  } catch (e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      res.status(404).json({ error: "One or more users were not found" });
      return;
    }
    throw e;
  }

  res.json({ ok: true, updatedCount });
});

adminRouter.post("/users/import", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const parsed = importUsersBody.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest("Validation failed", undefined, parsed.error.flatten());
  }

  const errors: { email: string; error: string }[] = [];
  const created: ReturnType<typeof mapUserResponse>[] = [];

  for (const row of parsed.data.users) {
    const normalizedBadge = row.employeeBadgeNumber?.trim();
    if (row.role === RoleName.EMPLOYEE && !normalizedBadge) {
      errors.push({ email: row.email, error: "Employee badge number is required for EMPLOYEE" });
      continue;
    }
    const department = await prisma.department.findUnique({ where: { id: row.departmentId } });
    if (!department) {
      errors.push({ email: row.email, error: "Department not found" });
      continue;
    }
    const roleRecord = await prisma.role.findUnique({ where: { name: row.role } });
    if (!roleRecord) {
      errors.push({ email: row.email, error: "Invalid role" });
      continue;
    }
    const dup = await prisma.user.findUnique({ where: { email: row.email } });
    if (dup) {
      errors.push({ email: row.email, error: "Email already in use" });
      continue;
    }
    try {
      const passwordHash = await hashPassword(row.password);
      const user = await prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            email: row.email,
            name: row.name,
            passwordHash,
            roleId: roleRecord.id,
            departmentId: department.id,
            employeeBadgeNumber: normalizedBadge || undefined,
            phoneNumber: row.phoneNumber ?? undefined,
            position: row.position ?? undefined,
          },
          include: { role: true, department: true },
        });
        const accessLevel = row.role === RoleName.MANAGER
          ? DepartmentAccessLevel.MANAGER
          : DepartmentAccessLevel.MEMBER;
        await tx.userDepartmentAccess.create({
          data: { userId: u.id, departmentId: department.id, accessLevel },
        });
        return u;
      });
      created.push(mapUserResponse(user));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Create failed";
      errors.push({ email: row.email, error: msg });
    }
  }

  res.status(201).json({ created: created.length, users: created, errors });
});

adminRouter.post(
  "/users/:userId/reset-restrictions",
  authenticateToken,
  requireRole(RoleName.ADMIN),
  async (req, res) => {
    const targetId = req.params.userId;
    const existing = await prisma.user.findUnique({
      where: { id: targetId },
      include: { role: true, department: true },
    });
    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const user = await prisma.user.update({
      where: { id: targetId },
      data: {
        loginAllowed: true,
        accessDocumentsAllowed: true,
        manageDocumentsAllowed: true,
        accessDashboardAllowed: true,
        useAiQueriesAllowed: true,
        authVersion: { increment: 1 },
      },
      include: { role: true, department: true },
    });
    await syncRefreshSessionsAuthVersion(targetId, user.authVersion);

    res.json({ user: mapUserAdmin(user) });
  },
);

adminRouter.post("/users/:userId/revoke-sessions", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const targetId = req.params.userId;
  const u = await prisma.user.findUnique({ where: { id: targetId } });
  if (!u) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.refreshSession.updateMany({
      where: { userId: targetId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.user.update({
      where: { id: targetId },
      data: { authVersion: { increment: 1 } },
    });
  });

  res.status(204).send();
});

adminRouter.post("/users/:userId/set-password", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const parsed = setPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest("Validation failed", undefined, parsed.error.flatten());
  }

  const targetId = req.params.userId;
  const u = await prisma.user.findUnique({ where: { id: targetId } });
  if (!u) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const updated = await prisma.user.update({
    where: { id: targetId },
    data: {
      passwordHash,
      authVersion: { increment: 1 },
      mustChangePassword: true,
    },
  });
  await syncRefreshSessionsAuthVersion(targetId, updated.authVersion);

  res.status(204).send();
});

/** Admin-initiated sign-in lock (same gate as failed-login lock in auth). */
const ADMIN_MANUAL_LOCK_MS = 7 * 24 * 60 * 60 * 1000;

adminRouter.post("/users/:userId/lock", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const actingUserId = req.authUser!.id;
  const targetId = req.params.userId;

  if (targetId === actingUserId) {
    res.status(400).json({ error: "You cannot lock your own account" });
    return;
  }

  const u = await prisma.user.findUnique({ where: { id: targetId } });
  if (!u) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await prisma.user.update({
    where: { id: targetId },
    data: {
      failedLoginAttempts: 0,
      loginLockedUntil: new Date(Date.now() + ADMIN_MANUAL_LOCK_MS),
    },
  });

  res.status(204).send();
});

adminRouter.post("/users/:userId/unlock", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const targetId = req.params.userId;
  const u = await prisma.user.findUnique({ where: { id: targetId } });
  if (!u) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await prisma.user.update({
    where: { id: targetId },
    data: {
      failedLoginAttempts: 0,
      loginLockedUntil: null,
    },
  });

  res.status(204).send();
});

adminRouter.post("/users/:userId/restore", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const targetId = req.params.userId;
  const u = await prisma.user.findUnique({ where: { id: targetId }, include: { role: true, department: true } });
  if (!u) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (!u.deletedAt) {
    res.status(400).json({ error: "User is not archived" });
    return;
  }

  const user = await prisma.user.update({
    where: { id: targetId },
    data: { deletedAt: null, isActive: true },
    include: { role: true, department: true },
  });
  res.json({ user: mapUserAdmin(user) });
});

adminRouter.delete("/users/:userId", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const actingUserId = req.authUser!.id;
  const targetId = req.params.userId;
  const hard = req.query.hard === "true" || req.query.hard === "1";

  if (targetId === actingUserId) {
    res.status(400).json({ error: "You cannot delete your own account" });
    return;
  }

  const u = await prisma.user.findUnique({
    where: { id: targetId },
    include: { role: true },
  });
  if (!u) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (!hard && u.deletedAt) {
    res.status(204).send();
    return;
  }

  const [docCount, verCount] = await Promise.all([
    prisma.document.count({ where: { createdById: targetId } }),
    prisma.documentVersion.count({ where: { createdById: targetId } }),
  ]);

  if (docCount > 0 || verCount > 0) {
    res.status(409).json({
      error: "User has created documents or versions; reassign or delete that content first",
      documentsCreated: docCount,
      versionsCreated: verCount,
    });
    return;
  }

  try {
    if (hard) {
      await prisma.$transaction(async (tx) => {
        if (u.role.name === RoleName.ADMIN && u.isActive && !u.deletedAt) {
          const admins = await tx.user.count({
            where: { isActive: true, deletedAt: null, role: { name: RoleName.ADMIN } },
          });
          if (admins <= 1) {
            throw Object.assign(new Error("Cannot delete the last active administrator"), { status: 400 });
          }
        }
        await tx.user.delete({ where: { id: targetId } });
      }, { isolationLevel: "Serializable" });
    } else {
      await prisma.$transaction(async (tx) => {
        if (u.role.name === RoleName.ADMIN && u.isActive && !u.deletedAt) {
          const admins = await tx.user.count({
            where: { isActive: true, deletedAt: null, role: { name: RoleName.ADMIN } },
          });
          if (admins <= 1) {
            throw Object.assign(new Error("Cannot delete the last active administrator"), { status: 400 });
          }
        }
        await tx.refreshSession.updateMany({
          where: { userId: targetId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.user.update({
          where: { id: targetId },
          data: {
            deletedAt: new Date(),
            isActive: false,
            authVersion: { increment: 1 },
          },
        });
      }, { isolationLevel: "Serializable" });
    }
  } catch (err: unknown) {
    if ((err as { status?: number }).status === 400) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    throw err;
  }

  res.status(204).send();
});

adminRouter.get("/stats", authenticateToken, requireRole(RoleName.ADMIN), async (_req, res) => {
  const [
    userCount,
    activeUserCount,
    documentCount,
    departmentCount,
    failedVersionCount,
    archivedDocumentCount,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.document.count(),
    prisma.department.count(),
    prisma.documentVersion.count({ where: { processingStatus: "FAILED" } }),
    prisma.document.count({ where: { isArchived: true } }),
  ]);

  res.json({
    users: { total: userCount, active: activeUserCount },
    documents: { total: documentCount, archived: archivedDocumentCount },
    departments: departmentCount,
    documentVersionsFailed: failedVersionCount,
  });
});

const kpiPeriodSchema = z.enum(["daily", "weekly", "monthly", "yearly"]);

function kpiRollingWindows(period: z.infer<typeof kpiPeriodSchema>): {
  current: { start: Date; end: Date };
  previous: { start: Date; end: Date };
  periodLabel: string;
} {
  const end = new Date();
  const day = 86400000;
  const lenMs =
    period === "daily" ? day : period === "weekly" ? 7 * day : period === "monthly" ? 30 * day : 365 * day;
  const currentStart = new Date(end.getTime() - lenMs);
  const previousEnd = currentStart;
  const previousStart = new Date(previousEnd.getTime() - lenMs);
  const periodLabel =
    period === "daily"
      ? "24h vs prior 24h"
      : period === "weekly"
        ? "7d vs prior 7d"
        : period === "monthly"
          ? "30d vs prior 30d"
          : "365d vs prior 365d";
  return {
    current: { start: currentStart, end },
    previous: { start: previousStart, end: previousEnd },
    periodLabel,
  };
}

/**
 * Period-over-period change. When the prior window had 0 events and the current has some,
 * we do not use +100% (misleading); we set fromZeroBaseline so the UI can show "New" instead.
 */
function kpiChange(current: number, previous: number): {
  changePercent: number | null;
  fromZeroBaseline: boolean;
  trend: "up" | "down" | "flat";
} {
  if (previous === 0 && current === 0) {
    return { changePercent: 0, fromZeroBaseline: false, trend: "flat" };
  }
  if (previous === 0 && current > 0) {
    return { changePercent: null, fromZeroBaseline: true, trend: "up" };
  }
  if (previous === 0) {
    return { changePercent: 0, fromZeroBaseline: false, trend: "down" };
  }
  const raw = ((current - previous) / previous) * 100;
  const pct = Math.round(raw * 10) / 10;
  if (Math.abs(pct) < 0.05) {
    return { changePercent: 0, fromZeroBaseline: false, trend: "flat" };
  }
  return {
    changePercent: pct,
    fromZeroBaseline: false,
    trend: current > previous ? "up" : "down",
  };
}

type AdminKpiModule = "users" | "documents" | "departments" | "system" | "ai";

type AdminKpiPayload = {
  id: string;
  module: AdminKpiModule;
  label: string;
  value: string;
  basis: string;
  /** Null when fromZeroBaseline (avoid fake +100%). */
  changePercent: number | null;
  fromZeroBaseline?: boolean;
  trend: "up" | "down" | "flat";
  invertTrend?: boolean;
};

const KPI_TIMESERIES_IDS = new Set([
  "users_total",
  "users_active",
  "logins",
  "documents_total",
  "documents_archived",
  "document_activity",
  "departments",
  "versions_failed",
  "ai_chunks",
]);

/** Last 12 calendar months (oldest → newest), local midnight bounds. */
function last12CalendarMonthBuckets(): { start: Date; end: Date; label: string }[] {
  const now = new Date();
  const buckets: { start: Date; end: Date; label: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    const monthShort = start.toLocaleString("en-US", { month: "short" });
    const y = start.getFullYear();
    buckets.push({
      start,
      end,
      label: `${monthShort} ${y}`,
    });
  }
  return buckets;
}

adminRouter.get("/stats/kpis/:kpiId/timeseries", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const kpiId = typeof req.params.kpiId === "string" ? req.params.kpiId.trim() : "";
  if (!KPI_TIMESERIES_IDS.has(kpiId)) {
    res.status(400).json({ error: "Unknown KPI id" });
    return;
  }

  const buckets = last12CalendarMonthBuckets();
  const range = (fn: (b: { start: Date; end: Date }) => Promise<number>) => Promise.all(buckets.map(fn));

  let title: string;
  let seriesLabel: string;
  let values: number[];

  switch (kpiId) {
    case "users_total":
      title = "Total users";
      seriesLabel = "New registrations per month";
      values = await range((b) =>
        prisma.user.count({ where: { createdAt: { gte: b.start, lte: b.end } } }),
      );
      break;
    case "users_active":
      title = "Active users";
      seriesLabel = "Distinct users with login per month";
      values = await range((b) =>
        prisma.user.count({
          where: { lastLoginAt: { gte: b.start, lte: b.end } },
        }),
      );
      break;
    case "logins":
      title = "Successful logins";
      seriesLabel = "Login events per month";
      values = await range((b) =>
        prisma.authEvent.count({
          where: {
            eventType: AuthEventType.LOGIN_SUCCESS,
            createdAt: { gte: b.start, lte: b.end },
          },
        }),
      );
      break;
    case "documents_total":
      title = "Documents";
      seriesLabel = "New documents per month";
      values = await range((b) =>
        prisma.document.count({ where: { createdAt: { gte: b.start, lte: b.end } } }),
      );
      break;
    case "documents_archived":
      title = "Archived documents";
      seriesLabel = "Archive events per month";
      values = await range((b) =>
        prisma.documentAuditLog.count({
          where: {
            action: DocumentAuditAction.ARCHIVED,
            createdAt: { gte: b.start, lte: b.end },
          },
        }),
      );
      break;
    case "document_activity":
      title = "Document activity";
      seriesLabel = "Audit events per month";
      values = await range((b) =>
        prisma.documentAuditLog.count({ where: { createdAt: { gte: b.start, lte: b.end } } }),
      );
      break;
    case "departments":
      title = "Departments";
      seriesLabel = "New departments per month";
      values = await range((b) =>
        prisma.department.count({ where: { createdAt: { gte: b.start, lte: b.end } } }),
      );
      break;
    case "versions_failed":
      title = "Failed processing";
      seriesLabel = "New failures per month";
      values = await range((b) =>
        prisma.documentVersion.count({
          where: {
            processingStatus: "FAILED",
            createdAt: { gte: b.start, lte: b.end },
          },
        }),
      );
      break;
    case "ai_chunks":
      title = "Embedding chunks";
      seriesLabel = "Chunks added per month (by version upload)";
      values = await range((b) =>
        prisma.documentChunk.count({
          where: {
            documentVersion: {
              createdAt: { gte: b.start, lte: b.end },
            },
          },
        }),
      );
      break;
    default:
      res.status(400).json({ error: "Unknown KPI id" });
      return;
  }

  res.json({
    kpiId,
    title,
    seriesLabel,
    labels: buckets.map((b) => b.label),
    values,
  });
});

adminRouter.get("/stats/kpis", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const parsed = kpiPeriodSchema.safeParse(typeof req.query.period === "string" ? req.query.period : "weekly");
  const period = parsed.success ? parsed.data : "weekly";
  const { current, previous, periodLabel } = kpiRollingWindows(period);

  const [
    totalUsers,
    activeUsers,
    totalDocuments,
    archivedDocuments,
    totalDepartments,
    failedVersionsTotal,
    newUsersCurr,
    newUsersPrev,
    loginsCurr,
    loginsPrev,
    activeWithLoginCurr,
    activeWithLoginPrev,
    newDocsCurr,
    newDocsPrev,
    archivedEventsCurr,
    archivedEventsPrev,
    newDeptsCurr,
    newDeptsPrev,
    failedVerCurr,
    failedVerPrev,
    auditCurr,
    auditPrev,
    embeddingChunksTotal,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.document.count(),
    prisma.document.count({ where: { isArchived: true } }),
    prisma.department.count(),
    prisma.documentVersion.count({ where: { processingStatus: "FAILED" } }),
    prisma.user.count({ where: { createdAt: { gte: current.start, lte: current.end } } }),
    prisma.user.count({ where: { createdAt: { gte: previous.start, lte: previous.end } } }),
    prisma.authEvent.count({
      where: { eventType: AuthEventType.LOGIN_SUCCESS, createdAt: { gte: current.start, lte: current.end } },
    }),
    prisma.authEvent.count({
      where: { eventType: AuthEventType.LOGIN_SUCCESS, createdAt: { gte: previous.start, lte: previous.end } },
    }),
    prisma.user.count({
      where: { lastLoginAt: { gte: current.start, lte: current.end } },
    }),
    prisma.user.count({
      where: { lastLoginAt: { gte: previous.start, lte: previous.end } },
    }),
    prisma.document.count({ where: { createdAt: { gte: current.start, lte: current.end } } }),
    prisma.document.count({ where: { createdAt: { gte: previous.start, lte: previous.end } } }),
    prisma.documentAuditLog.count({
      where: { action: DocumentAuditAction.ARCHIVED, createdAt: { gte: current.start, lte: current.end } },
    }),
    prisma.documentAuditLog.count({
      where: { action: DocumentAuditAction.ARCHIVED, createdAt: { gte: previous.start, lte: previous.end } },
    }),
    prisma.department.count({ where: { createdAt: { gte: current.start, lte: current.end } } }),
    prisma.department.count({ where: { createdAt: { gte: previous.start, lte: previous.end } } }),
    prisma.documentVersion.count({
      where: {
        processingStatus: "FAILED",
        createdAt: { gte: current.start, lte: current.end },
      },
    }),
    prisma.documentVersion.count({
      where: {
        processingStatus: "FAILED",
        createdAt: { gte: previous.start, lte: previous.end },
      },
    }),
    prisma.documentAuditLog.count({ where: { createdAt: { gte: current.start, lte: current.end } } }),
    prisma.documentAuditLog.count({ where: { createdAt: { gte: previous.start, lte: previous.end } } }),
    prisma.documentChunk.count(),
  ]);

  const kpiUsersTotal: AdminKpiPayload = {
    id: "users_total",
    module: "users",
    label: "Total users",
    value: String(totalUsers),
    basis: "New registrations",
    ...kpiChange(newUsersCurr, newUsersPrev),
  };
  const kpiUsersActive: AdminKpiPayload = {
    id: "users_active",
    module: "users",
    label: "Active users",
    value: String(activeUsers),
    basis: "Accounts with login in period",
    ...kpiChange(activeWithLoginCurr, activeWithLoginPrev),
  };
  const kpiLogins: AdminKpiPayload = {
    id: "logins",
    module: "users",
    label: "Successful logins",
    value: String(loginsCurr),
    basis: "Auth events",
    ...kpiChange(loginsCurr, loginsPrev),
  };
  const kpiDocumentsTotal: AdminKpiPayload = {
    id: "documents_total",
    module: "documents",
    label: "Documents",
    value: String(totalDocuments),
    basis: "New documents",
    ...kpiChange(newDocsCurr, newDocsPrev),
  };
  const kpiDocumentsArchived: AdminKpiPayload = {
    id: "documents_archived",
    module: "documents",
    label: "Archived documents",
    value: String(archivedDocuments),
    basis: "Archive events",
    ...kpiChange(archivedEventsCurr, archivedEventsPrev),
  };
  const kpiDocumentActivity: AdminKpiPayload = {
    id: "document_activity",
    module: "documents",
    label: "Document activity",
    value: String(auditCurr),
    basis: "Audit events",
    ...kpiChange(auditCurr, auditPrev),
  };
  const kpiDepartments: AdminKpiPayload = {
    id: "departments",
    module: "departments",
    label: "Departments",
    value: String(totalDepartments),
    basis: "New departments",
    ...kpiChange(newDeptsCurr, newDeptsPrev),
  };
  const kpiVersionsFailed: AdminKpiPayload = {
    id: "versions_failed",
    module: "system",
    label: "Failed processing",
    value: String(failedVersionsTotal),
    basis: "New failures",
    ...kpiChange(failedVerCurr, failedVerPrev),
    invertTrend: true,
  };
  const kpiAiChunks: AdminKpiPayload = {
    id: "ai_chunks",
    module: "ai",
    label: "Embedding chunks",
    value: String(embeddingChunksTotal),
    basis: "Vectors in index",
    changePercent: 0,
    fromZeroBaseline: false,
    trend: "flat",
  };

  const modules: { id: string; title: string; kpis: AdminKpiPayload[] }[] = [
    { id: "users", title: "Users", kpis: [kpiUsersTotal, kpiUsersActive, kpiLogins] },
    { id: "documents", title: "Documents", kpis: [kpiDocumentsTotal, kpiDocumentsArchived, kpiDocumentActivity] },
    { id: "departments", title: "Departments", kpis: [kpiDepartments] },
    { id: "system", title: "System", kpis: [kpiVersionsFailed] },
    { id: "ai", title: "AI & search", kpis: [kpiAiChunks] },
  ];

  const kpis = modules.flatMap((m) => m.kpis);

  res.json({ period, periodLabel, modules, kpis });
});

function buildDocumentAuditWhere(query: Record<string, unknown>): {
  where: Prisma.DocumentAuditLogWhereInput;
  orderBy: { createdAt: "asc" | "desc" };
} {
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const actionRaw = typeof query.action === "string" ? query.action.trim() : "";
  const userIdRaw = typeof query.userId === "string" ? query.userId.trim() : "";
  const documentIdRaw = typeof query.documentId === "string" ? query.documentId.trim() : "";
  const fromRaw = typeof query.from === "string" ? query.from.trim() : "";
  const toRaw = typeof query.to === "string" ? query.to.trim() : "";

  const and: Prisma.DocumentAuditLogWhereInput[] = [];

  if (documentIdRaw.length > 0 && ADMIN_UUID_RE.test(documentIdRaw)) {
    and.push({ documentId: documentIdRaw });
  }

  if (actionRaw.length > 0 && Object.values(DocumentAuditAction).includes(actionRaw as DocumentAuditAction)) {
    and.push({ action: actionRaw as DocumentAuditAction });
  }

  if (ADMIN_UUID_RE.test(userIdRaw)) {
    and.push({ userId: userIdRaw });
  }

  if (fromRaw.length > 0) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromRaw)) {
      const [y, m, d] = fromRaw.split("-").map(Number) as [number, number, number];
      and.push({ createdAt: { gte: new Date(y, m - 1, d, 0, 0, 0, 0) } });
    } else {
      const from = new Date(fromRaw);
      if (!Number.isNaN(from.getTime())) {
        and.push({ createdAt: { gte: from } });
      }
    }
  }
  if (toRaw.length > 0) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(toRaw)) {
      const [y, m, d] = toRaw.split("-").map(Number) as [number, number, number];
      and.push({ createdAt: { lte: new Date(y, m - 1, d, 23, 59, 59, 999) } });
    } else {
      const to = new Date(toRaw);
      if (!Number.isNaN(to.getTime())) {
        and.push({ createdAt: { lte: to } });
      }
    }
  }

  if (q.length > 0) {
    and.push({
      OR: [
        { document: { is: { title: { contains: q, mode: "insensitive" } } } },
        { user: { is: { email: { contains: q, mode: "insensitive" } } } },
        { user: { is: { name: { contains: q, mode: "insensitive" } } } },
      ],
    });
  }

  const where: Prisma.DocumentAuditLogWhereInput =
    and.length === 0 ? {} : and.length === 1 ? and[0]! : { AND: and };

  const sortAsc = query.sort === "createdAt_asc";
  const orderBy = { createdAt: sortAsc ? ("asc" as const) : ("desc" as const) };

  return { where, orderBy };
}

adminRouter.get("/document-audit/export", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const { where, orderBy } = buildDocumentAuditWhere(req.query as Record<string, unknown>);
  const rows = await prisma.documentAuditLog.findMany({
    where,
    orderBy,
    take: 5000,
    include: {
      user: { select: { id: true, email: true, name: true, profilePictureUrl: true } },
      document: { select: { id: true, title: true } },
    },
  });

  const esc = (s: string) => {
    const v = String(s).replace(/"/g, '""');
    return /^[=+\-@\t\r]/.test(v) ? `"'${v}"` : `"${v}"`;
  };
  const lines = [
    "id,createdAt,action,documentId,documentTitle,userId,userEmail,userName,metadata",
    ...rows.map((e) => {
      const meta = e.metadata == null ? "" : JSON.stringify(e.metadata);
      return [
        e.id,
        e.createdAt.toISOString(),
        e.action,
        e.documentId ?? "",
        e.document ? esc(e.document.title) : "",
        e.userId ?? "",
        e.user ? esc(e.user.email) : "",
        e.user ? esc(e.user.name) : "",
        esc(meta),
      ].join(",");
    }),
  ];

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="document-audit-export.csv"');
  res.send(lines.join("\n"));
});

adminRouter.get("/document-audit", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? "40"), 10) || 40));
  const { where, orderBy } = buildDocumentAuditWhere(req.query as Record<string, unknown>);

  const [total, logs] = await Promise.all([
    prisma.documentAuditLog.count({ where }),
    prisma.documentAuditLog.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { id: true, email: true, name: true, profilePictureUrl: true } },
        document: { select: { id: true, title: true } },
      },
    }),
  ]);

  res.json({
    total,
    page,
    pageSize,
    entries: logs.map((e) => ({
      id: e.id,
      action: e.action,
      createdAt: e.createdAt.toISOString(),
      metadata: e.metadata,
      documentId: e.documentId,
      document: e.document ? { id: e.document.id, title: e.document.title } : null,
      user: e.user
        ? {
            id: e.user.id,
            email: e.user.email,
            name: e.user.name,
            profilePictureUrl: e.user.profilePictureUrl ?? null,
          }
        : null,
    })),
  });
});

function buildAuthActivityWhere(query: Record<string, unknown>): {
  where: Prisma.AuthEventWhereInput;
  orderBy: { createdAt: "asc" | "desc" };
} {
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const eventTypeRaw = typeof query.eventType === "string" ? query.eventType.trim() : "";
  const ip = typeof query.ip === "string" ? query.ip.trim() : "";
  const userIdRaw = typeof query.userId === "string" ? query.userId.trim() : "";
  const fromRaw = typeof query.from === "string" ? query.from.trim() : "";
  const toRaw = typeof query.to === "string" ? query.to.trim() : "";

  const and: Prisma.AuthEventWhereInput[] = [];

  if (eventTypeRaw.length > 0 && Object.values(AuthEventType).includes(eventTypeRaw as AuthEventType)) {
    and.push({ eventType: eventTypeRaw as AuthEventType });
  }

  if (ADMIN_UUID_RE.test(userIdRaw)) {
    and.push({ userId: userIdRaw });
  }

  if (ip.length > 0) {
    and.push({ ipAddress: { contains: ip, mode: "insensitive" } });
  }

  if (fromRaw.length > 0) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromRaw)) {
      const [y, m, d] = fromRaw.split("-").map(Number) as [number, number, number];
      and.push({ createdAt: { gte: new Date(y, m - 1, d, 0, 0, 0, 0) } });
    } else {
      const from = new Date(fromRaw);
      if (!Number.isNaN(from.getTime())) {
        and.push({ createdAt: { gte: from } });
      }
    }
  }
  if (toRaw.length > 0) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(toRaw)) {
      const [y, m, d] = toRaw.split("-").map(Number) as [number, number, number];
      and.push({ createdAt: { lte: new Date(y, m - 1, d, 23, 59, 59, 999) } });
    } else {
      const to = new Date(toRaw);
      if (!Number.isNaN(to.getTime())) {
        and.push({ createdAt: { lte: to } });
      }
    }
  }

  if (q.length > 0) {
    and.push({
      OR: [
        { user: { is: { email: { contains: q, mode: "insensitive" } } } },
        { user: { is: { name: { contains: q, mode: "insensitive" } } } },
        { ipAddress: { contains: q, mode: "insensitive" } },
        { userAgent: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.AuthEventWhereInput =
    and.length === 0 ? {} : and.length === 1 ? and[0]! : { AND: and };

  const sortAsc = query.sort === "createdAt_asc";
  const orderBy = { createdAt: sortAsc ? ("asc" as const) : ("desc" as const) };

  return { where, orderBy };
}

adminRouter.get("/activity/export", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const { where, orderBy } = buildAuthActivityWhere(req.query as Record<string, unknown>);
  const rows = await prisma.authEvent.findMany({
    where,
    orderBy,
    take: 5000,
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
  });

  const esc = (s: string) => {
    const v = String(s).replace(/"/g, '""');
    return /^[=+\-@\t\r]/.test(v) ? `"'${v}"` : `"${v}"`;
  };
  const lines = [
    "id,createdAt,eventType,userId,userEmail,userName,ipAddress,userAgent,metadata",
    ...rows.map((e) => {
      const meta = e.metadata == null ? "" : JSON.stringify(e.metadata);
      return [
        e.id,
        e.createdAt.toISOString(),
        e.eventType,
        e.userId ?? "",
        e.user ? esc(e.user.email) : "",
        e.user ? esc(e.user.name) : "",
        normalizeStoredIpForDisplay(e.ipAddress) ?? "",
        esc(e.userAgent ?? ""),
        esc(meta),
      ].join(",");
    }),
  ];

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="auth-activity-export.csv"');
  res.send(lines.join("\n"));
});

adminRouter.get("/activity", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? "40"), 10) || 40));
  const { where, orderBy } = buildAuthActivityWhere(req.query as Record<string, unknown>);

  const [total, events] = await Promise.all([
    prisma.authEvent.count({ where }),
    prisma.authEvent.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
    }),
  ]);

  res.json({
    total,
    page,
    pageSize,
    events: events.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      createdAt: e.createdAt.toISOString(),
      ipAddress: normalizeStoredIpForDisplay(e.ipAddress),
      userAgent: e.userAgent,
      metadata: e.metadata,
      user: e.user ? { id: e.user.id, email: e.user.email, name: e.user.name } : null,
    })),
  });
});

/* ================================================================
   Department Access Management
   ================================================================ */

async function bumpAuthAfterDepartmentAccessChange(userId: string): Promise<void> {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { authVersion: { increment: 1 } },
    select: { authVersion: true },
  });
  await syncRefreshSessionsAuthVersion(userId, updated.authVersion);
}

adminRouter.get(
  "/users/:userId/department-access",
  authenticateToken,
  requireRole(RoleName.ADMIN),
  async (req, res) => {
    const userId = req.params.userId;
    const rows = await prisma.userDepartmentAccess.findMany({
      where: { userId },
      include: { department: { select: { id: true, name: true, parentDepartmentId: true } } },
      orderBy: { department: { name: "asc" } },
    });
    res.json(
      rows.map((r) => ({
        id: r.id,
        departmentId: r.departmentId,
        departmentName: r.department.name,
        parentDepartmentId: r.department.parentDepartmentId,
        accessLevel: r.accessLevel,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  },
);

const deptAccessBody = z.object({
  departmentId: z.string().uuid(),
  accessLevel: z.nativeEnum(DepartmentAccessLevel),
});

adminRouter.post(
  "/users/:userId/department-access",
  authenticateToken,
  requireRole(RoleName.ADMIN),
  async (req, res) => {
    const userId = req.params.userId;
    const parsed = deptAccessBody.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Validation failed", undefined, parsed.error.flatten());
    }
    const { departmentId, accessLevel } = parsed.data;

    const [userExists, deptExists] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
      prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } }),
    ]);
    if (!userExists) { res.status(404).json({ error: "User not found" }); return; }
    if (!deptExists) { res.status(404).json({ error: "Department not found" }); return; }

    const row = await prisma.userDepartmentAccess.upsert({
      where: { userId_departmentId: { userId, departmentId } },
      create: { userId, departmentId, accessLevel: accessLevel as DepartmentAccessLevel },
      update: { accessLevel: accessLevel as DepartmentAccessLevel },
      include: { department: { select: { id: true, name: true, parentDepartmentId: true } } },
    });
    await bumpAuthAfterDepartmentAccessChange(userId);
    res.json({
      id: row.id,
      departmentId: row.departmentId,
      departmentName: row.department.name,
      parentDepartmentId: row.department.parentDepartmentId,
      accessLevel: row.accessLevel,
      createdAt: row.createdAt.toISOString(),
    });
  },
);

adminRouter.delete(
  "/users/:userId/department-access/:departmentId",
  authenticateToken,
  requireRole(RoleName.ADMIN),
  async (req, res) => {
    const { userId, departmentId } = req.params;
    try {
      await prisma.userDepartmentAccess.delete({
        where: { userId_departmentId: { userId, departmentId } },
      });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "P2025") {
        res.status(404).json({ error: "Access record not found" });
        return;
      }
      throw err;
    }
    try {
      await bumpAuthAfterDepartmentAccessChange(userId);
    } catch {
      /* deletion succeeded — auth bump is best-effort; stale sessions expire naturally */
    }
    res.json({ ok: true });
  },
);

const bulkDeptAccessBody = z.object({
  assignments: z.array(
    z.object({
      departmentId: z.string().uuid(),
      accessLevel: z.nativeEnum(DepartmentAccessLevel),
    }),
  ),
});

adminRouter.put(
  "/users/:userId/department-access",
  authenticateToken,
  requireRole(RoleName.ADMIN),
  async (req, res) => {
    const userId = req.params.userId;
    const parsed = bulkDeptAccessBody.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Validation failed", undefined, parsed.error.flatten());
    }
    const userExists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!userExists) { res.status(404).json({ error: "User not found" }); return; }

    await prisma.$transaction(async (tx) => {
      await tx.userDepartmentAccess.deleteMany({ where: { userId } });
      if (parsed.data.assignments.length > 0) {
        await tx.userDepartmentAccess.createMany({
          data: parsed.data.assignments.map((a) => ({
            userId,
            departmentId: a.departmentId,
            accessLevel: a.accessLevel as DepartmentAccessLevel,
          })),
          skipDuplicates: true,
        });
      }
    });

    await bumpAuthAfterDepartmentAccessChange(userId);

    const rows = await prisma.userDepartmentAccess.findMany({
      where: { userId },
      include: { department: { select: { id: true, name: true, parentDepartmentId: true } } },
      orderBy: { department: { name: "asc" } },
    });
    res.json(
      rows.map((r) => ({
        id: r.id,
        departmentId: r.departmentId,
        departmentName: r.department.name,
        parentDepartmentId: r.department.parentDepartmentId,
        accessLevel: r.accessLevel,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  },
);

adminRouter.get(
  "/departments/:departmentId/access",
  authenticateToken,
  requireRole(RoleName.ADMIN),
  async (req, res) => {
    const departmentId = req.params.departmentId;
    const rows = await prisma.userDepartmentAccess.findMany({
      where: { departmentId },
      include: {
        user: {
          select: {
            id: true, name: true, email: true, profilePictureUrl: true,
            role: { select: { name: true } },
          },
        },
      },
      orderBy: { user: { name: "asc" } },
    });
    res.json(
      rows.map((r) => ({
        id: r.id,
        userId: r.user.id,
        userName: r.user.name,
        userEmail: r.user.email,
        userRole: r.user.role.name,
        profilePictureUrl: r.user.profilePictureUrl,
        accessLevel: r.accessLevel,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  },
);
