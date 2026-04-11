import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createHttpApp } from "./httpApp.js";
import { prisma } from "./lib/prisma.js";
import { hashPassword } from "./lib/password.js";
import { RoleName } from "@prisma/client";

const app = createHttpApp();
const ADMIN_EMAIL = "admin-integration-test@example.com";
const ADMIN_PASS = "AdminTest123!@";
let adminToken: string;
let departmentId: string;
let roleAdminId: string;
let roleEmployeeId: string;
let createdUserId: string;
let createdDeptId: string;

describe("admin API", () => {
  beforeAll(async () => {
    const dept = await prisma.department.findFirst();
    if (!dept) throw new Error("No department — run seed.");
    departmentId = dept.id;

    const adminRole = await prisma.role.findUnique({ where: { name: RoleName.ADMIN } });
    const empRole = await prisma.role.findUnique({ where: { name: RoleName.EMPLOYEE } });
    if (!adminRole || !empRole) throw new Error("Missing roles — run seed.");
    roleAdminId = adminRole.id;
    roleEmployeeId = empRole.id;

    await prisma.user.deleteMany({ where: { email: { startsWith: "admin-integration-test" } } });
    await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        name: "Admin Integration",
        passwordHash: await hashPassword(ADMIN_PASS),
        roleId: roleAdminId,
        departmentId,
      },
    });

    const login = await request(app).post("/auth/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
    adminToken = login.body.token;
  });

  afterAll(async () => {
    if (createdUserId) {
      await prisma.refreshSession.deleteMany({ where: { userId: createdUserId } });
      await prisma.user.deleteMany({ where: { id: createdUserId } });
    }
    if (createdDeptId) {
      await prisma.department.deleteMany({ where: { id: createdDeptId } }).catch(() => {});
    }
    await prisma.refreshSession.deleteMany({ where: { user: { email: ADMIN_EMAIL } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "admin-integration-test" } } });
    await prisma.$disconnect();
  });

  // --- Department CRUD ---

  it("GET /admin/departments returns list", async () => {
    const res = await request(app).get("/admin/departments").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.departments ?? res.body)).toBe(true);
  });

  it("POST /admin/departments creates a department", async () => {
    const res = await request(app)
      .post("/admin/departments")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Test Dept Admin Integration" });
    expect(res.status).toBe(201);
    expect(res.body.department?.name ?? res.body.name).toBe("Test Dept Admin Integration");
    createdDeptId = res.body.department?.id ?? res.body.id;
  });

  it("PATCH /admin/departments/:id updates name", async () => {
    if (!createdDeptId) return;
    const res = await request(app)
      .patch(`/admin/departments/${createdDeptId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Renamed Dept" });
    expect(res.status).toBe(200);
  });

  it("DELETE /admin/departments/:id removes department", async () => {
    if (!createdDeptId) return;
    // Move any users first
    await prisma.user.updateMany({ where: { departmentId: createdDeptId }, data: { departmentId } });
    const res = await request(app)
      .delete(`/admin/departments/${createdDeptId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect([200, 204]).toContain(res.status);
    createdDeptId = "";
  });

  // --- User CRUD ---

  it("POST /admin/users creates a user", async () => {
    const res = await request(app)
      .post("/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        email: "admin-integration-test-created@example.com",
        password: "TestUser123!@",
        name: "Created User",
        role: RoleName.EMPLOYEE,
        departmentId,
        employeeBadgeNumber: "ITEST-001",
      });
    expect(res.status).toBe(201);
    createdUserId = res.body.user?.id ?? res.body.id;
    expect(createdUserId).toBeTruthy();
  });

  it("GET /admin/users returns paginated list", async () => {
    const res = await request(app).get("/admin/users").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.users ?? res.body.items).toBeDefined();
  });

  it("PATCH /admin/users/:id updates user", async () => {
    if (!createdUserId) return;
    const res = await request(app)
      .patch(`/admin/users/${createdUserId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Updated User Name" });
    expect(res.status).toBe(200);
  });

  it("POST /admin/users/:id/lock locks a user", async () => {
    if (!createdUserId) return;
    const res = await request(app)
      .post(`/admin/users/${createdUserId}/lock`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect([200, 204]).toContain(res.status);
  });

  it("POST /admin/users/:id/unlock unlocks a user", async () => {
    if (!createdUserId) return;
    const res = await request(app)
      .post(`/admin/users/${createdUserId}/unlock`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect([200, 204]).toContain(res.status);
  });

  it("POST /admin/users/:id/set-password sets password", async () => {
    if (!createdUserId) return;
    const res = await request(app)
      .post(`/admin/users/${createdUserId}/set-password`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ password: "NewPassword456!@" });
    expect([200, 204]).toContain(res.status);
  });

  it("DELETE /admin/users/:id soft-deletes user", async () => {
    if (!createdUserId) return;
    const res = await request(app)
      .delete(`/admin/users/${createdUserId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect([200, 204]).toContain(res.status);
  });

  // --- Roles ---

  it("GET /admin/roles returns all roles", async () => {
    const res = await request(app).get("/admin/roles").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  // --- Stats ---

  it("GET /admin/stats returns system stats", async () => {
    const res = await request(app).get("/admin/stats").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("GET /admin/stats/kpis returns KPI data", async () => {
    const res = await request(app).get("/admin/stats/kpis").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  // --- Authorization ---

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/admin/users");
    expect(res.status).toBe(401);
  });

  it("rejects non-admin users", async () => {
    // Create employee and login
    const empEmail = "admin-integration-test-emp@example.com";
    await prisma.user.deleteMany({ where: { email: empEmail } });
    await prisma.user.create({
      data: {
        email: empEmail,
        name: "Employee Test",
        passwordHash: await hashPassword("EmployeeTest123!@"),
        roleId: roleEmployeeId,
        departmentId,
      },
    });
    const login = await request(app).post("/auth/login").send({ email: empEmail, password: "EmployeeTest123!@" });
    const empToken = login.body.token;

    const res = await request(app).get("/admin/users").set("Authorization", `Bearer ${empToken}`);
    expect(res.status).toBe(403);

    await prisma.refreshSession.deleteMany({ where: { user: { email: empEmail } } });
    await prisma.user.deleteMany({ where: { email: empEmail } });
  });

  // --- Audit/Activity ---

  it("GET /admin/document-audit returns audit log", async () => {
    const res = await request(app).get("/admin/document-audit").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("GET /admin/activity returns auth activity", async () => {
    const res = await request(app).get("/admin/activity").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});
