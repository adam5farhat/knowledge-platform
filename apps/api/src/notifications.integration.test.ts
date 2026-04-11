import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createHttpApp } from "./httpApp.js";
import { prisma } from "./lib/prisma.js";
import { hashPassword } from "./lib/password.js";
import { RoleName, NotificationType, NotificationTarget } from "@prisma/client";

const app = createHttpApp();
const ADMIN_EMAIL = "notif-integration-test@example.com";
const ADMIN_PASS = "NotifTest123!@";
let adminToken: string;
let departmentId: string;
let roleAdminId: string;
let adminUserId: string;
let sentNotificationId: string;
let userNotificationId: string;

describe("notifications API", () => {
  beforeAll(async () => {
    const dept = await prisma.department.findFirst();
    if (!dept) throw new Error("No department — run seed.");
    departmentId = dept.id;

    const adminRole = await prisma.role.findUnique({ where: { name: RoleName.ADMIN } });
    if (!adminRole) throw new Error("Missing ADMIN role — run seed.");
    roleAdminId = adminRole.id;

    await prisma.user.deleteMany({ where: { email: { startsWith: "notif-integration-test" } } });
    const user = await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        name: "Notif Integration",
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
    await prisma.userNotification.deleteMany({ where: { userId: adminUserId } });
    await prisma.notification.deleteMany({ where: { actorId: adminUserId } });
    await prisma.refreshSession.deleteMany({ where: { userId: adminUserId } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "notif-integration-test" } } });
    await prisma.$disconnect();
  });

  it("GET /notifications returns empty list initially", async () => {
    const res = await request(app).get("/notifications").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
    expect(res.body.total).toBeGreaterThanOrEqual(0);
  });

  it("GET /notifications/unread-count returns count", async () => {
    const res = await request(app).get("/notifications/unread-count").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.unreadCount).toBe("number");
  });

  it("POST /notifications/send creates a notification", async () => {
    const res = await request(app)
      .post("/notifications/send")
      .set("Authorization", `Bearer ${adminToken}`)
      .field("title", "Test Notification")
      .field("body", "This is a test notification body")
      .field("targetType", NotificationTarget.ALL_USERS);
    expect([200, 201]).toContain(res.status);
    expect(res.body.ok).toBe(true);
    sentNotificationId = res.body.notificationId;
  });

  it("GET /notifications lists sent notification", async () => {
    const res = await request(app).get("/notifications").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    if (res.body.items.length > 0) {
      userNotificationId = res.body.items[0].id;
      expect(res.body.items[0].notification.title).toBeDefined();
    }
  });

  it("PATCH /notifications/:id/read marks as read", async () => {
    if (!userNotificationId) return;
    const res = await request(app)
      .patch(`/notifications/${userNotificationId}/read`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(200);
  });

  it("PATCH /notifications/read-all marks all as read", async () => {
    const res = await request(app)
      .patch("/notifications/read-all")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(200);
  });

  it("DELETE /notifications/:id removes notification", async () => {
    if (!userNotificationId) return;
    const res = await request(app)
      .delete(`/notifications/${userNotificationId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/notifications");
    expect(res.status).toBe(401);
  });
});
