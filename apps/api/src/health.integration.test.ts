import { describe, it, expect } from "vitest";
import request from "supertest";
import { createHttpApp } from "./httpApp.js";

const app = createHttpApp();

describe("health and root endpoints", () => {
  it("GET / returns service info", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.service).toBe("knowledge-platform-api");
  });

  it("GET /health returns status", async () => {
    const res = await request(app).get("/health");
    expect([200, 503]).toContain(res.status);
    expect(res.body.status).toBeDefined();
    expect(res.body.checks).toBeDefined();
  });

  it("returns 404 for unknown routes", async () => {
    const res = await request(app).get("/nonexistent-route");
    expect(res.status).toBe(404);
  });
});
