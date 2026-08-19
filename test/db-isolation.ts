import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import dotenv from "dotenv";
import { Client } from "pg";

export const DEFAULT_E2E_WORKER_COUNT = 2;
export const PROBE_TABLE = "e2e_isolation_probe";

const PROTECTED_DATABASES = new Set([
  "loyollo",
  "postgres",
  "template0",
  "template1",
]);

export function repoRoot(): string {
  return join(__dirname, "..");
}

export function runIdFilePath(): string {
  return join(repoRoot(), "test", ".e2e-run-id");
}

export function loadE2EEnv(): void {
  dotenv.config({ path: join(repoRoot(), ".env"), override: false });
}

export function sanitizeRunId(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (!cleaned) {
    throw new Error("E2E_RUN_ID is empty after sanitization");
  }
  return cleaned.slice(0, 40);
}

export function persistRunId(runId: string): void {
  mkdirSync(join(repoRoot(), "test"), { recursive: true });
  writeFileSync(runIdFilePath(), runId, "utf8");
}

export function resolveOrCreateRunId(): string {
  const runId = process.env.E2E_RUN_ID
    ? sanitizeRunId(process.env.E2E_RUN_ID)
    : sanitizeRunId(`local_${process.pid}_${Date.now()}`);
  persistRunId(runId);
  process.env.E2E_RUN_ID = runId;
  return runId;
}

export function getRunId(): string {
  if (process.env.E2E_RUN_ID) {
    return sanitizeRunId(process.env.E2E_RUN_ID);
  }
  if (existsSync(runIdFilePath())) {
    const raw = readFileSync(runIdFilePath(), "utf8").trim();
    if (raw) {
      return sanitizeRunId(raw);
    }
  }
  throw new Error(
    "E2E_RUN_ID is missing. Jest globalSetup must run before workers.",
  );
}

export function workerCount(): number {
  const raw = process.env.E2E_WORKER_COUNT;
  if (!raw) {
    return DEFAULT_E2E_WORKER_COUNT;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 16) {
    throw new Error("E2E_WORKER_COUNT must be an integer between 1 and 16");
  }
  return parsed;
}

export function templateDbName(runId: string): string {
  return assertSafeDbName(`e2e_${runId}_tpl`);
}

export function workerDbName(runId: string, workerId: string): string {
  if (!/^\d+$/.test(workerId)) {
    throw new Error(`Invalid Jest worker id: ${workerId}`);
  }
  return assertSafeDbName(`e2e_${runId}_w${workerId}`);
}

export function proofDbName(runId: string, label: string): string {
  if (!/^[a-z0-9]+$/.test(label)) {
    throw new Error(`Invalid proof database label: ${label}`);
  }
  return assertSafeDbName(`e2e_${runId}_proof_${label}`);
}

export function assertSafeDbName(name: string): string {
  if (!/^e2e_[a-z0-9_]+$/.test(name) || name.length > 63) {
    throw new Error(`Refusing unsafe database name: ${name}`);
  }
  if (PROTECTED_DATABASES.has(name)) {
    throw new Error(`Refusing to use protected database: ${name}`);
  }
  return name;
}

function quoteIdent(name: string): string {
  assertSafeDbName(name);
  return `"${name}"`;
}

export function getAdminUrl(): string {
  const url = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "E2E_DATABASE_URL is required for e2e tests. It is the Postgres instance admin URL from .env.example. Tests never write to this database; they create isolated e2e_* databases instead.",
    );
  }
  return url;
}

export function databaseNameFromUrl(connectionString: string): string {
  const parsed = new URL(connectionString);
  return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
}

export function replaceDatabaseName(
  connectionString: string,
  dbName: string,
): string {
  assertSafeDbName(dbName);
  const parsed = new URL(connectionString);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

export async function withAdminClient<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: getAdminUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function withDatabaseClient<T>(
  dbName: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    connectionString: replaceDatabaseName(getAdminUrl(), dbName),
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function waitForPostgres(timeoutMs = 30_000): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      await withAdminClient(async (client) => {
        await client.query("SELECT 1");
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Postgres is not reachable for e2e tests: ${String(lastError)}`);
}

export async function databaseExists(name: string): Promise<boolean> {
  assertSafeDbName(name);
  return withAdminClient(async (client) => {
    const result = await client.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
      [name],
    );
    return result.rows[0]?.exists === true;
  });
}

export async function createDatabase(name: string): Promise<void> {
  const dbName = assertSafeDbName(name);
  await withAdminClient(async (client) => {
    await client.query(`CREATE DATABASE ${quoteIdent(dbName)}`);
  });
}

export async function createDatabaseFromTemplate(
  name: string,
  templateName: string,
): Promise<void> {
  const dbName = assertSafeDbName(name);
  const template = assertSafeDbName(templateName);
  await withAdminClient(async (client) => {
    await client.query(
      `CREATE DATABASE ${quoteIdent(dbName)} TEMPLATE ${quoteIdent(template)}`,
    );
  });
}

export async function dropDatabase(name: string): Promise<void> {
  const dbName = assertSafeDbName(name);
  await withAdminClient(async (client) => {
    await client.query(
      `DROP DATABASE IF EXISTS ${quoteIdent(dbName)} WITH (FORCE)`,
    );
  });
}

export async function listRunDatabases(runId: string): Promise<string[]> {
  const prefix = `e2e_${sanitizeRunId(runId)}_`;
  return withAdminClient(async (client) => {
    const result = await client.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE $1 ORDER BY datname",
      [`${prefix}%`],
    );
    return result.rows.map((row) => row.datname);
  });
}

export async function cleanupRunDatabases(runId: string): Promise<string[]> {
  const names = await listRunDatabases(runId);
  for (const name of names) {
    await dropDatabase(name);
  }
  return names;
}

function hasPrismaMigrations(): boolean {
  const dir = join(repoRoot(), "prisma", "migrations");
  if (!existsSync(dir)) {
    return false;
  }
  return readdirSync(dir).some((entry) =>
    statSync(join(dir, entry)).isDirectory(),
  );
}

export function applyMigrations(databaseUrl: string): void {
  if (!hasPrismaMigrations()) {
    return;
  }
  // Run the CLI's JS entrypoint directly rather than the `npx` shim: Node refuses
  // to spawn a `.cmd` without a shell on Windows, and a shell here buys nothing.
  const prismaCli = require.resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: repoRoot(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
}

export async function applyTemplateSchema(templateName: string): Promise<void> {
  const databaseUrl = replaceDatabaseName(getAdminUrl(), templateName);
  applyMigrations(databaseUrl);
  await withDatabaseClient(templateName, async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${PROBE_TABLE} (
        id TEXT PRIMARY KEY,
        worker_key TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  });
}

export async function prepareIsolatedRun(runId: string): Promise<void> {
  await cleanupRunDatabases(runId);
  const template = templateDbName(runId);
  await createDatabase(template);
  await applyTemplateSchema(template);
  const workers = workerCount();
  for (let worker = 1; worker <= workers; worker += 1) {
    await createDatabaseFromTemplate(
      workerDbName(runId, String(worker)),
      template,
    );
  }
}
