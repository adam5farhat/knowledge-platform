import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createHttpApp } from "./httpApp.js";
import { prisma } from "./lib/prisma.js";
import { hashPassword } from "./lib/password.js";
import { RoleName } from "@prisma/client";

const app = createHttpApp();
const ADMIN_EMAIL = "search-integration-test@example.com";
const ADMIN_PASS = "SearchTest123!@";
let adminToken: string;
let departmentId: string;
let roleAdminId: string;

describe("search API", () => {
  beforeAll(async () => {
    const dept = await prisma.department.findFirst();
    if (!dept) throw new Error("No department — run seed.");
    departmentId = dept.id;

    const adminRole = await prisma.role.findUnique({ where: { name: RoleName.ADMIN } });
    if (!adminRole) throw new Error("Missing ADMIN role — run seed.");
    roleAdminId = adminRole.id;

    await prisma.user.deleteMany({ where: { email: { startsWith: "search-integration-test" } } });
    await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        name: "Search Integration",
        passwordHash: await hashPassword(ADMIN_PASS),
        roleId: roleAdminId,
        departmentId,
      },
    });

    const login = await request(app).post("/auth/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
    adminToken = login.body.token;
  });

  afterAll(async () => {
    await prisma.refreshSession.deleteMany({ where: { user: { email: ADMIN_EMAIL } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "search-integration-test" } } });
    await prisma.$disconnect();
  });

  it("POST /search/semantic requires authentication", async () => {
    const res = await request(app).post("/search/semantic").send({ query: "test" });
    expect(res.status).toBe(401);
  });

  it("POST /search/semantic validates body", async () => {
    const res = await request(app)
      .post("/search/semantic")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("POST /search/semantic accepts valid query (may 503 without Gemini)", async () => {
    const res = await request(app)
      .post("/search/semantic")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ query: "test document", limit: 5 });
    // Might be 200 (if Gemini configured) or 503 (if not)
    expect([200, 503]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.results).toBeDefined();
    }
  });

  it("POST /search/ask requires authentication", async () => {
    const res = await request(app).post("/search/ask").send({ question: "test" });
    expect(res.status).toBe(401);
  });

  it("POST /search/ask validates body", async () => {
    const res = await request(app)
      .post("/search/ask")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("POST /search/ask accepts valid question (may 503 without Gemini)", async () => {
    const res = await request(app)
      .post("/search/ask")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "What is this about?" });
    // SSE endpoint: 200 starts streaming, or 503 if Gemini not configured
    expect([200, 503]).toContain(res.status);
  });

  it("restricts users with AI queries disabled", async () => {
    const empEmail = "search-integration-test-restricted@example.com";
    const empRole = await prisma.role.findUnique({ where: { name: RoleName.EMPLOYEE } });
    if (!empRole) return;

    await prisma.user.deleteMany({ where: { email: empEmail } });
    await prisma.user.create({
      data: {
        email: empEmail,
        name: "Search Restricted",
        passwordHash: await hashPassword("Restricted123!@"),
        roleId: empRole.id,
        departmentId,
        useAiQueriesAllowed: false,
      },
    });
    const login = await request(app).post("/auth/login").send({ email: empEmail, password: "Restricted123!@" });
    const token = login.body.token;

    const res = await request(app)
      .post("/search/semantic")
      .set("Authorization", `Bearer ${token}`)
      .send({ query: "test" });
    expect(res.status).toBe(403);

    await prisma.refreshSession.deleteMany({ where: { user: { email: empEmail } } });
    await prisma.user.deleteMany({ where: { email: empEmail } });
  });
});
