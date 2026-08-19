import {
  getAdminUrl,
  getRunId,
  loadE2EEnv,
  replaceDatabaseName,
  workerDbName,
} from "./db-isolation";

loadE2EEnv();

const runId = getRunId();
const workerId = process.env.JEST_WORKER_ID ?? "1";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = replaceDatabaseName(
  getAdminUrl(),
  workerDbName(runId, workerId),
);
