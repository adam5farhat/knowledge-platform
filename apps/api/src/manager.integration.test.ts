import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createHttpApp } from "./httpApp.js";
import { prisma } from "./lib/prisma.js";
import { hashPassword } from "./lib/password.js";
import { RoleName } from "@prisma/client";

const app = createHttpApp();
const MGR_EMAIL = "mgr-integration-test@example.com";
const MGR_PASS = "ManagerTest123!@";
const EMP_EMAIL = "mgr-integration-test-emp@example.com";
const EMP_PASS = "EmployeeTest123!@";
let mgrToken: string;
let empToken: string;
let departmentId: string;
let roleManagerId: string;
let roleEmployeeId: string;

describe("manager API", () => {
  beforeAll(async () => {
    const dept = await prisma.department.findFirst();
    if (!dept) throw new Error("No department — run seed.");
    departmentId = dept.id;

    const mgrRole = await prisma.role.findUnique({ where: { name: RoleName.MANAGER } });
    const empRole = await prisma.role.findUnique({ where: { name: RoleName.EMPLOYEE } });
    if (!mgrRole || !empRole) throw new Error("Missing roles — run seed.");
    roleManagerId = mgrRole.id;
    roleEmployeeId = empRole.id;

    await prisma.user.deleteMany({ where: { email: { startsWith: "mgr-integration-test" } } });
    await prisma.user.create({
      data: {
        email: MGR_EMAIL,
        name: "Manager Integration",
        passwordHash: await hashPassword(MGR_PASS),
        roleId: roleManagerId,
        departmentId,
      },
    });
    await prisma.user.create({
      data: {
        email: EMP_EMAIL,
        name: "Employee Integration",
        passwordHash: await hashPassword(EMP_PASS),
        roleId: roleEmployeeId,
        departmentId,
      },
    });

    const mgrLogin = await request(app).post("/auth/login").send({ email: MGR_EMAIL, password: MGR_PASS });
    mgrToken = mgrLogin.body.token;

    const empLogin = await request(app).post("/auth/login").send({ email: EMP_EMAIL, password: EMP_PASS });
    empToken = empLogin.body.token;
  });

  afterAll(async () => {
    await prisma.refreshSession.deleteMany({
      where: { user: { email: { startsWith: "mgr-integration-test" } } },
    });
    await prisma.user.deleteMany({ where: { email: { startsWith: "mgr-integration-test" } } });
    await prisma.$disconnect();
  });

  it("GET /manager/departments returns departments for manager", async () => {
    const res = await request(app).get("/manager/departments").set("Authorization", `Bearer ${mgrToken}`);
    expect(res.status).toBe(200);
    expect(res.body.departments).toBeDefined();
  });

  it("GET /manager/department returns department detail", async () => {
    const res = await request(app)
      .get(`/manager/department?departmentId=${departmentId}`)
      .set("Authorization", `Bearer ${mgrToken}`);
    expect(res.status).toBe(200);
    expect(res.body.department).toBeDefined();
    expect(res.body.members).toBeDefined();
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/manager/departments");
    expect(res.status).toBe(401);
  });

  it("rejects employees without manager access", async () => {
    const res = await request(app).get("/manager/departments").set("Authorization", `Bearer ${empToken}`);
    expect(res.status).toBe(403);
  });
});
