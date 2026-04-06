import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createHttpApp } from "./httpApp.js";
import { prisma } from "./lib/prisma.js";
import { hashPassword } from "./lib/password.js";
import { AuthErrorCode } from "./lib/authErrorCodes.js";
import { RoleName } from "@prisma/client";

const app = createHttpApp();
const TEST_EMAIL = "auth-integration-test@example.com";
const TEST_PASSWORD = "IntegrationTest123!";
let departmentId: string;
let roleAdminId: string;

describe("authentication API", () => {
  beforeAll(async () => {
    const dept = await prisma.department.findFirst();
    if (!dept) {
      throw new Error("No department in database — run npm run db:seed first.");
    }
    departmentId = dept.id;
    const role = await prisma.role.findUnique({ where: { name: RoleName.ADMIN } });
    if (!role) throw new Error("Missing ADMIN role — run seed.");
    roleAdminId = role.id;

    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
    await prisma.refreshSession.deleteMany({});
    await prisma.user.create({
      data: {
        email: TEST_EMAIL,
        name: "Auth Integration Test",
        passwordHash: await hashPassword(TEST_PASSWORD),
        roleId: roleAdminId,
        departmentId,
      },
    });
  });

  afterAll(async () => {
    await prisma.refreshSession.deleteMany({});
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
    await prisma.$disconnect();
  });

  it("POST /auth/login rejects wrong password", async () => {
    const res = await request(app).post("/auth/login").send({
      email: TEST_EMAIL,
      password: "wrong-password",
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  it("POST /auth/login returns access and refresh tokens with user", async () => {
    const res = await request(app).post("/auth/login").send({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user?.email).toBe(TEST_EMAIL);
    expect(res.body.user?.role).toBe(RoleName.ADMIN);
  });

  it("POST /auth/refresh rotates refresh token and returns new access token", async () => {
    const login = await request(app).post("/auth/login").send({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    const refreshToken = login.body.refreshToken as string;
    const refresh = await request(app).post("/auth/refresh").send({ refreshToken });
    expect(refresh.status).toBe(200);
    expect(refresh.body.token).toBeTruthy();
    expect(refresh.body.refreshToken).toBeTruthy();
    expect(refresh.body.refreshToken).not.toBe(refreshToken);

    const stale = await request(app).post("/auth/refresh").send({ refreshToken });
    expect(stale.status).toBe(401);
  });

  it("GET /auth/me requires Authorization", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });

  it("GET /auth/me returns user with valid Bearer token", async () => {
    const login = await request(app).post("/auth/login").send({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    const token = login.body.token as string;
    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user?.email).toBe(TEST_EMAIL);
  });

  it("GET /auth/me returns 401 ACCESS_TOKEN_OUTDATED when JWT claims disagree with DB (no authVersion bump)", async () => {
    const login = await request(app).post("/auth/login").send({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;

    const employeeRole = await prisma.role.findUnique({ where: { name: RoleName.EMPLOYEE } });
    if (!employeeRole) throw new Error("Missing EMPLOYEE role — run seed.");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: TEST_EMAIL } });

    await prisma.user.update({
      where: { id: user.id },
      data: { roleId: employeeRole.id, employeeBadgeNumber: `itest-${Date.now()}` },
    });

    const stale = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(stale.status).toBe(401);
    expect(stale.body.code).toBe(AuthErrorCode.ACCESS_TOKEN_OUTDATED);

    await prisma.user.update({
      where: { id: user.id },
      data: { roleId: roleAdminId, employeeBadgeNumber: null },
    });
  });

  it("PATCH /auth/profile updates badge and profile picture URL", async () => {
    const login = await request(app).post("/auth/login").send({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    const token = login.body.token as string;
    const badge = `badge-${Date.now()}`;
    const pic = "https://example.com/avatar.png";
    const res = await request(app)
      .patch("/auth/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ employeeBadgeNumber: badge, profilePictureUrl: pic });
    expect(res.status).toBe(200);
    expect(res.body.user?.employeeBadgeNumber).toBe(badge);
    expect(res.body.user?.profilePictureUrl).toBe(pic);
  });

  it("PATCH /auth/profile rejects invalid profile picture URL", async () => {
    const login = await request(app).post("/auth/login").send({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    const token = login.body.token as string;
    const res = await request(app)
      .patch("/auth/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ profilePictureUrl: "not-a-url" });
    expect(res.status).toBe(400);
  });

  it("POST /auth/change-password invalidates old token and new token works", async () => {
    const login = await request(app).post("/auth/login").send({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    const oldToken = login.body.token as string;
    const oldRefresh = login.body.refreshToken as string;

    const newPass = "NewIntegrationPass456!";
    const change = await request(app)
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${oldToken}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: newPass });
    expect(change.status).toBe(200);
    expect(change.body.token).toBeTruthy();
    expect(change.body.user?.email).toBe(TEST_EMAIL);

    const stale = await request(app).get("/auth/me").set("Authorization", `Bearer ${oldToken}`);
    expect(stale.status).toBe(401);
    const refreshStale = await request(app).post("/auth/refresh").send({ refreshToken: oldRefresh });
    expect(refreshStale.status).toBe(401);

    const fresh = await request(app).get("/auth/me").set("Authorization", `Bearer ${change.body.token}`);
    expect(fresh.status).toBe(200);

    await request(app)
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${change.body.token}`)
      .send({ currentPassword: newPass, newPassword: TEST_PASSWORD });
  });

  it("POST /auth/logout-all revokes active refresh sessions", async () => {
    const login = await request(app).post("/auth/login").send({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    const token = login.body.token as string;
    const refreshToken = login.body.refreshToken as string;

    const logout = await request(app).post("/auth/logout-all").set("Authorization", `Bearer ${token}`).send({});
    expect(logout.status).toBe(200);

    const refresh = await request(app).post("/auth/refresh").send({ refreshToken });
    expect(refresh.status).toBe(401);
  });

  it("POST /auth/forgot-password returns generic message", async () => {
    const res = await request(app).post("/auth/forgot-password").send({ email: TEST_EMAIL });
    expect(res.status).toBe(200);
    expect(res.body.message).toBeTruthy();
  });
});
