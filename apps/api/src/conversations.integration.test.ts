import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createHttpApp } from "./httpApp.js";
import { prisma } from "./lib/prisma.js";
import { hashPassword } from "./lib/password.js";
import { RoleName } from "@prisma/client";

const app = createHttpApp();
const ADMIN_EMAIL = "conv-integration-test@example.com";
const ADMIN_PASS = "ConvTest123!@";
let adminToken: string;
let departmentId: string;
let roleAdminId: string;
let adminUserId: string;
let createdConvId: string;

describe("conversations API", () => {
  beforeAll(async () => {
    const dept = await prisma.department.findFirst();
    if (!dept) throw new Error("No department — run seed.");
    departmentId = dept.id;

    const adminRole = await prisma.role.findUnique({ where: { name: RoleName.ADMIN } });
    if (!adminRole) throw new Error("Missing ADMIN role — run seed.");
    roleAdminId = adminRole.id;

    await prisma.user.deleteMany({ where: { email: { startsWith: "conv-integration-test" } } });
    const user = await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        name: "Conv Integration",
        passwordHash: await hashPassword(ADMIN_PASS),
        roleId: roleAdminId,
        departmentId,
      },
    });
    adminUserId = user.id;

    const login = await request(app).post("/auth/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
    adminToken = login.body.token;
  });

  afterAll(async () => {
    if (createdConvId) {
      await prisma.answerFeedback.deleteMany({ where: { message: { conversationId: createdConvId } } });
      await prisma.conversationMessage.deleteMany({ where: { conversationId: createdConvId } });
      await prisma.conversation.deleteMany({ where: { id: createdConvId } });
    }
    await prisma.refreshSession.deleteMany({ where: { userId: adminUserId } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "conv-integration-test" } } });
    await prisma.$disconnect();
  });

  it("GET /conversations returns list", async () => {
    const res = await request(app).get("/conversations").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("POST /conversations creates a conversation", async () => {
    const res = await request(app)
      .post("/conversations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Test Conversation" });
    expect(res.status).toBe(201);
    createdConvId = res.body.conversation?.id ?? res.body.id;
    expect(createdConvId).toBeTruthy();
  });

  it("GET /conversations/:id returns conversation detail", async () => {
    if (!createdConvId) return;
    const res = await request(app)
      .get(`/conversations/${createdConvId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("PATCH /conversations/:id updates title", async () => {
    if (!createdConvId) return;
    const res = await request(app)
      .patch(`/conversations/${createdConvId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Renamed Conversation" });
    expect(res.status).toBe(200);
  });

  it("GET /conversations/feedback/stats returns stats (admin)", async () => {
    const res = await request(app)
      .get("/conversations/feedback/stats")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("DELETE /conversations/:id deletes conversation", async () => {
    if (!createdConvId) return;
    const res = await request(app)
      .delete(`/conversations/${createdConvId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect([200, 204]).toContain(res.status);
    createdConvId = "";
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/conversations");
    expect(res.status).toBe(401);
  });
});
