import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createE2EApp } from "./create-app";
import { databaseNameFromUrl, getRunId, workerDbName } from "./db-isolation";

describe("Health (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2EApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("points Prisma at this worker's isolated database, not loyollo", () => {
    const databaseName = databaseNameFromUrl(process.env.DATABASE_URL!);
    const expected = workerDbName(
      getRunId(),
      process.env.JEST_WORKER_ID ?? "1",
    );
    expect(databaseName).toBe(expected);
    expect(databaseName.startsWith("e2e_")).toBe(true);
    expect(databaseName).not.toBe("loyollo");
  });

  it("GET /health reports the isolated database as up", async () => {
    const response = await request(app.getHttpServer()).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", db: "up" });
  });
});
