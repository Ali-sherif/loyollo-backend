import {
  cleanupRunDatabases,
  loadE2EEnv,
  prepareIsolatedRun,
  resolveOrCreateRunId,
  waitForPostgres,
} from "./db-isolation";

export default async function globalSetup(): Promise<void> {
  loadE2EEnv();
  const runId = resolveOrCreateRunId();
  try {
    await waitForPostgres();
    await prepareIsolatedRun(runId);
  } catch (error) {
    await cleanupRunDatabases(runId).catch(() => undefined);
    throw error;
  }
}
