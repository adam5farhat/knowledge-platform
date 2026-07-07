import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { RoleName } from "@prisma/client";
import { createHttpApp } from "./httpApp.js";
import { prisma } from "./lib/prisma.js";
import { hashPassword } from "./lib/password.js";
import { saveUploadedFile, deleteFileIfExists } from "./lib/storage.js";
import { avatarKeyFromParts } from "./lib/avatar.js";

const app = createHttpApp();
const TEST_EMAIL = "avatars-integration-test@example.com";

/** Minimal JPEG magic bytes so storage and Content-Type detection succeed. */
const MIN_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

let userId: string;
let filename: string;

describe("public avatar serving", () => {
  beforeAll(async () => {
    const dept = await prisma.department.findFirst();
    if (!dept) throw new Error("No department in database — run npm run db:seed first.");
    const role = await prisma.role.findUnique({ where: { name: RoleName.EMPLOYEE } });
    if (!role) throw new Error("Missing EMPLOYEE role — run seed.");

    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
    const user = await prisma.user.create({
      data: {
        email: TEST_EMAIL,
        name: "Avatar Integration Test",
        passwordHash: await hashPassword("Test123!"),
        roleId: role.id,
        departmentId: dept.id,
      },
    });
    userId = user.id;
    filename = `${randomUUID()}.jpg`;
    const key = avatarKeyFromParts(userId, filename);
    await saveUploadedFile(key, MIN_JPEG);
    const avatarUrl = `http://localhost:3001/avatars/${userId}/${filename}`;
    await prisma.user.update({
      where: { id: userId },
      data: { profilePictureUrl: avatarUrl },
    });
  });

  afterAll(async () => {
    if (userId && filename) {
      await deleteFileIfExists(avatarKeyFromParts(userId, filename));
    }
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
    await prisma.$disconnect();
  });

  it("GET /avatars/:userId/:filename returns cross-origin CORP for browser embedding", async () => {
    const res = await request(app).get(`/avatars/${userId}/${filename}`);
    expect(res.status).toBe(200);
    expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(res.headers["content-type"]).toMatch(/image\/jpeg/);
  });
});
