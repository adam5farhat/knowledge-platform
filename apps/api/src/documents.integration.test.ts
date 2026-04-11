import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createHttpApp } from "./httpApp.js";
import { prisma } from "./lib/prisma.js";
import { hashPassword } from "./lib/password.js";
import { RoleName } from "@prisma/client";

const app = createHttpApp();
const ADMIN_EMAIL = "docs-integration-test@example.com";
const ADMIN_PASS = "DocsTest123!@";
let adminToken: string;
let departmentId: string;
let roleAdminId: string;
let roleEmployeeId: string;
let uploadedDocId: string;
let uploadedVersionId: string;

describe("documents API", () => {
  beforeAll(async () => {
    const dept = await prisma.department.findFirst();
    if (!dept) throw new Error("No department — run seed.");
    departmentId = dept.id;

    const adminRole = await prisma.role.findUnique({ where: { name: RoleName.ADMIN } });
    const empRole = await prisma.role.findUnique({ where: { name: RoleName.EMPLOYEE } });
    if (!adminRole || !empRole) throw new Error("Missing roles — run seed.");
    roleAdminId = adminRole.id;
    roleEmployeeId = empRole.id;

    await prisma.user.deleteMany({ where: { email: { startsWith: "docs-integration-test" } } });
    await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        name: "Docs Integration",
        passwordHash: await hashPassword(ADMIN_PASS),
        roleId: roleAdminId,
        departmentId,
      },
    });

    const login = await request(app).post("/auth/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
    adminToken = login.body.token;
  });

  afterAll(async () => {
    if (uploadedDocId) {
      await prisma.documentChunk.deleteMany({ where: { documentVersion: { documentId: uploadedDocId } } });
      await prisma.documentVersion.deleteMany({ where: { documentId: uploadedDocId } });
      await prisma.documentAuditLog.deleteMany({ where: { documentId: uploadedDocId } });
      await prisma.documentUserFavorite.deleteMany({ where: { documentId: uploadedDocId } });
      await prisma.documentUserRecent.deleteMany({ where: { documentId: uploadedDocId } });
      await prisma.document.deleteMany({ where: { id: uploadedDocId } });
    }
    await prisma.refreshSession.deleteMany({ where: { user: { email: ADMIN_EMAIL } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "docs-integration-test" } } });
    await prisma.$disconnect();
  });

  it("POST /documents/upload uploads a text file", async () => {
    const res = await request(app)
      .post("/documents/upload")
      .set("Authorization", `Bearer ${adminToken}`)
      .field("title", "Integration Test Document")
      .attach("file", Buffer.from("This is a test document content for integration testing."), {
        filename: "test-doc.txt",
        contentType: "text/plain",
      });
    expect(res.status).toBe(201);
    uploadedDocId = res.body.document?.id;
    uploadedVersionId = res.body.version?.id;
    expect(uploadedDocId).toBeTruthy();
    expect(uploadedVersionId).toBeTruthy();
  });

  it("POST /documents/upload rejects missing file", async () => {
    const res = await request(app)
      .post("/documents/upload")
      .set("Authorization", `Bearer ${adminToken}`)
      .field("title", "No file document");
    expect(res.status).toBe(400);
  });

  it("POST /documents/upload rejects missing title", async () => {
    const res = await request(app)
      .post("/documents/upload")
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("file", Buffer.from("content"), { filename: "test.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
  });

  it("GET /documents returns document list", async () => {
    const res = await request(app).get("/documents").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("GET /documents/:id returns document detail", async () => {
    if (!uploadedDocId) return;
    const res = await request(app)
      .get(`/documents/${uploadedDocId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("PATCH /documents/:id updates document", async () => {
    if (!uploadedDocId) return;
    const res = await request(app)
      .patch(`/documents/${uploadedDocId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Updated Title" });
    expect(res.status).toBe(200);
  });

  it("POST /documents/:id/view marks document as viewed", async () => {
    if (!uploadedDocId) return;
    const res = await request(app)
      .post(`/documents/${uploadedDocId}/view`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect([200, 204]).toContain(res.status);
  });

  it("POST /documents/:id/favorite adds favorite", async () => {
    if (!uploadedDocId) return;
    const res = await request(app)
      .post(`/documents/${uploadedDocId}/favorite`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect([200, 201, 204]).toContain(res.status);
  });

  it("DELETE /documents/:id/favorite removes favorite", async () => {
    if (!uploadedDocId) return;
    const res = await request(app)
      .delete(`/documents/${uploadedDocId}/favorite`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect([200, 204]).toContain(res.status);
  });

  it("GET /documents/:id/audit returns audit trail", async () => {
    if (!uploadedDocId) return;
    const res = await request(app)
      .get(`/documents/${uploadedDocId}/audit`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("GET /documents/tags/suggestions returns tags", async () => {
    const res = await request(app)
      .get("/documents/tags/suggestions")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("rejects unauthenticated document access", async () => {
    const res = await request(app).get("/documents");
    expect(res.status).toBe(401);
  });

  it("restricts employee from managing documents", async () => {
    const empEmail = "docs-integration-test-emp@example.com";
    await prisma.user.deleteMany({ where: { email: empEmail } });
    await prisma.user.create({
      data: {
        email: empEmail,
        name: "Docs Emp Test",
        passwordHash: await hashPassword("EmployeeTest123!@"),
        roleId: roleEmployeeId,
        departmentId,
      },
    });
    const login = await request(app).post("/auth/login").send({ email: empEmail, password: "EmployeeTest123!@" });
    const empToken = login.body.token;

    const res = await request(app)
      .post("/documents/upload")
      .set("Authorization", `Bearer ${empToken}`)
      .field("title", "Should Fail")
      .attach("file", Buffer.from("content"), { filename: "test.txt", contentType: "text/plain" });
    expect(res.status).toBe(403);

    await prisma.refreshSession.deleteMany({ where: { user: { email: empEmail } } });
    await prisma.user.deleteMany({ where: { email: empEmail } });
  });

  it("DELETE /documents/:id deletes document", async () => {
    if (!uploadedDocId) return;
    const res = await request(app)
      .delete(`/documents/${uploadedDocId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect([200, 204]).toContain(res.status);
    uploadedDocId = "";
  });
});
