import { randomUUID } from "node:crypto";
import {
  PROBE_TABLE,
  databaseNameFromUrl,
  getRunId,
  workerDbName,
  withDatabaseClient,
} from "./db-isolation";

describe("Parallel worker database (e2e)", () => {
  const workerId = process.env.JEST_WORKER_ID ?? "1";
  const dbName = workerDbName(getRunId(), workerId);

  it("writes only into this worker's database", async () => {
    expect(databaseNameFromUrl(process.env.DATABASE_URL!)).toBe(dbName);

    const id = randomUUID();
    const payload = `worker-${workerId}`;
    await withDatabaseClient(dbName, async (client) => {
      await client.query(
        `INSERT INTO ${PROBE_TABLE} (id, worker_key, payload) VALUES ($1, $2, $3)`,
        [id, workerId, payload],
      );
      const mine = await client.query<{ worker_key: string }>(
        `SELECT DISTINCT worker_key FROM ${PROBE_TABLE}`,
      );
      expect(mine.rows).toHaveLength(1);
      expect(mine.rows[0].worker_key).toBe(workerId);
    });
  });
});
