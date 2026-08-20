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
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.DATABASE_URL = replaceDatabaseName(
  getAdminUrl(),
  workerDbName(runId, workerId),
);
// Rate-limit counters live in Redis, so worker isolation has to cover Redis too.
// Index 0 is left to the dev app; workers take 1..n.
process.env.REDIS_DB = String(Number(workerId));
// Suites create dozens of accounts; production-strength hashing would dominate
// the runtime without testing anything the cost factor is responsible for.
process.env.BCRYPT_ROUNDS = "4";
