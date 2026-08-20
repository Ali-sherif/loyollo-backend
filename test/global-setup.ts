import {
  cleanupRunDatabases,
  loadE2EEnv,
  prepareIsolatedRun,
  resolveOrCreateRunId,
  waitForPostgres,
  waitForRedis,
} from "./db-isolation";

export default async function globalSetup(): Promise<void> {
  loadE2EEnv();
  const runId = resolveOrCreateRunId();
  try {
    await waitForPostgres();
    await waitForRedis();
    await prepareIsolatedRun(runId);
  } catch (error) {
    await cleanupRunDatabases(runId).catch(() => undefined);
    throw error;
  }
}
