import { existsSync, unlinkSync } from "node:fs";
import {
  cleanupRunDatabases,
  getRunId,
  loadE2EEnv,
  runIdFilePath,
} from "./db-isolation";

export default async function globalTeardown(): Promise<void> {
  loadE2EEnv();
  const runId = getRunId();
  await cleanupRunDatabases(runId);
  if (existsSync(runIdFilePath())) {
    unlinkSync(runIdFilePath());
  }
}
