import { Prisma, RoleName } from "@prisma/client";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../lib/password.js";
import { mapUserResponse } from "../lib/mapUser.js";
import { syncRefreshSessionsAuthVersion } from "../lib/refreshSessionSync.js";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { isAllowedProfilePictureUrlForUser } from "../lib/avatar.js";
import { clearUserAvatar, commitAvatarUpload } from "../lib/avatarOps.js";

export const adminRouter = Router();

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
    ids: z.array(z.string().uuid()).min(1).max(50),
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
  password: z.string().min(8, "Password must be at least 8 characters"),
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
    select: { id: true, name: true, parentDepartmentId: true },
  });

  res.status(201).json({ department });
});

adminRouter.patch("/departments/:departmentId", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const parsed = patchDepartmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
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

  const [userCount, docCount, childCount] = await Promise.all([
    prisma.user.count({ where: { departmentId: id } }),
    prisma.document.count({ where: { departmentId: id } }),
    prisma.department.count({ where: { parentDepartmentId: id } }),
  ]);

  if (userCount > 0 || docCount > 0 || childCount > 0) {
    res.status(409).json({
      error: "Department is still in use",
      userCount,
      documentCount: docCount,
      childDepartmentCount: childCount,
    });
    return;
  }

  await prisma.department.delete({ where: { id } });
  res.status(204).send();
});

adminRouter.post("/departments/merge", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const parsed = mergeDepartmentsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
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

  const childCount = await prisma.department.count({ where: { parentDepartmentId: sourceDepartmentId } });
  if (childCount > 0) {
    res.status(409).json({ error: "Reassign or delete child departments before merging this one" });
    return;
  }

  await prisma.$transaction([
    prisma.user.updateMany({
      where: { departmentId: sourceDepartmentId },
      data: { departmentId: targetDepartmentId },
    }),
    prisma.document.updateMany({
      where: { departmentId: sourceDepartmentId },
      data: { departmentId: targetDepartmentId },
    }),
    prisma.department.delete({ where: { id: sourceDepartmentId } }),
  ]);

  res.json({ ok: true, mergedInto: { id: tgt.id, name: tgt.name } });
});

adminRouter.get("/users", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? "25"), 10) || 25));
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const departmentId = typeof req.query.departmentId === "string" ? req.query.departmentId.trim() : "";
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
  if (departmentId.length > 0) {
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
      include: { role: true, department: true },
    }),
  ]);

  res.json({
    users: rows.map((u) => mapUserAdmin(u)),
    total,
    page,
    pageSize,
  });
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

adminRouter.patch("/users/:userId", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const parsed = patchUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
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

  try {
    const user = await prisma.user.update({
      where: { id: targetId },
      data,
      include: { role: true, department: true },
    });
    if (bumpAuth) {
      await syncRefreshSessionsAuthVersion(targetId, user.authVersion);
    }
    res.json({ user: mapUserAdmin(user) });
  } catch (e: unknown) {
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
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
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
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
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
      const user = await prisma.user.create({
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
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
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
      mustChangePassword: false,
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

  if (u.role.name === RoleName.ADMIN) {
    const admins = await countActiveAdmins();
    if (admins <= 1 && u.isActive && !u.deletedAt) {
      res.status(400).json({ error: "Cannot delete the last active administrator" });
      return;
    }
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

  if (hard) {
    await prisma.user.delete({ where: { id: targetId } });
    res.status(204).send();
    return;
  }

  await prisma.$transaction(async (tx) => {
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
  });

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

adminRouter.get("/document-audit", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? "40"), 10) || 40));
  const documentId = typeof req.query.documentId === "string" && req.query.documentId.length > 0 ? req.query.documentId : undefined;

  const where = documentId ? { documentId } : {};

  const [total, logs] = await Promise.all([
    prisma.documentAuditLog.count({ where }),
    prisma.documentAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { id: true, email: true, name: true } },
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
      user: e.user ? { id: e.user.id, email: e.user.email, name: e.user.name } : null,
    })),
  });
});

adminRouter.get("/activity", authenticateToken, requireRole(RoleName.ADMIN), async (req, res) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? "40"), 10) || 40));

  const [total, events] = await Promise.all([
    prisma.authEvent.count(),
    prisma.authEvent.findMany({
      orderBy: { createdAt: "desc" },
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
      ipAddress: e.ipAddress,
      userAgent: e.userAgent,
      metadata: e.metadata,
      user: e.user ? { id: e.user.id, email: e.user.email, name: e.user.name } : null,
    })),
  });
});
