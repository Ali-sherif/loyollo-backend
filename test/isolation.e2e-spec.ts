import {
  PROBE_TABLE,
  createDatabaseFromTemplate,
  databaseNameFromUrl,
  dropDatabase,
  getRunId,
  listRunDatabases,
  proofDbName,
  templateDbName,
  withDatabaseClient,
  workerCount,
} from "./db-isolation";

async function insertProbe(
  dbName: string,
  id: string,
  payload: string,
): Promise<void> {
  await withDatabaseClient(dbName, async (client) => {
    await client.query(
      `INSERT INTO ${PROBE_TABLE} (id, worker_key, payload) VALUES ($1, $2, $3)`,
      [id, dbName, payload],
    );
  });
}

async function probePayloads(dbName: string): Promise<string[]> {
  return withDatabaseClient(dbName, async (client) => {
    const result = await client.query<{ payload: string }>(
      `SELECT payload FROM ${PROBE_TABLE} ORDER BY payload`,
    );
    return result.rows.map((row) => row.payload);
  });
}

describe("E2E database isolation", () => {
  const runId = getRunId();
  const dbA = proofDbName(runId, "a");
  const dbB = proofDbName(runId, "b");

  beforeAll(async () => {
    const template = templateDbName(runId);
    await createDatabaseFromTemplate(dbA, template);
    await createDatabaseFromTemplate(dbB, template);
  });

  afterAll(async () => {
    await dropDatabase(dbA);
    await dropDatabase(dbB);
  });

  it("does not use a shared application database", () => {
    const current = databaseNameFromUrl(process.env.DATABASE_URL!);
    expect(current).not.toBe("loyollo");
    expect(current).not.toBe("postgres");
    expect(current.startsWith(`e2e_${runId}_`)).toBe(true);
  });

  it("pre-creates a unique database per parallel Jest worker", async () => {
    const names = await listRunDatabases(runId);
    const workerNames = names.filter((name) => /_w\d+$/.test(name));
    expect(workerNames).toHaveLength(workerCount());
    expect(new Set(workerNames).size).toBe(workerCount());
  });

  it("keeps writes in one isolated database invisible to another", async () => {
    await insertProbe(dbA, "row-a", "alpha");
    await insertProbe(dbB, "row-b", "beta");

    await expect(probePayloads(dbA)).resolves.toEqual(["alpha"]);
    await expect(probePayloads(dbB)).resolves.toEqual(["beta"]);
  });

  it("only lists e2e_* databases for this run and refuses to drop loyollo", async () => {
    const names = await listRunDatabases(runId);
    expect(names.every((name) => name.startsWith(`e2e_${runId}_`))).toBe(true);
    expect(names).not.toContain("loyollo");
    await expect(dropDatabase("loyollo")).rejects.toThrow(
      /unsafe database name|protected database/,
    );
  });
});
