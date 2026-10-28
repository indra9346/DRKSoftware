// Self-hosted installs (Supabase / any PostgreSQL): database migrations and start-up
// checks. Used by the server at start (AUTO_MIGRATE=true) and by scripts/fitcrush.ts.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { existsSync, readFileSync } from "fs";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";
import { connectionOptions } from "../db";
import { localAuthEnabled } from "./env";

export const MIN_JWT_SECRET_LENGTH = 32;
// Drizzle records applied migrations here (its default for PostgreSQL).
const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

/** Finds drizzle/ next to the app, from the source tree or the built dist/ folder. */
export function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), "drizzle"),
    path.resolve(here, "..", "drizzle"),
    path.resolve(here, "..", "..", "drizzle"),
  ];
  const found = candidates.find(dir =>
    existsSync(path.join(dir, "meta", "_journal.json"))
  );
  if (!found)
    throw new Error(
      `Database migration files not found (looked in ${candidates.join(", ")}).`
    );
  return found;
}

type JournalEntry = { idx: number; when: number; tag: string };

function journal(): JournalEntry[] {
  const file = path.join(migrationsFolder(), "meta", "_journal.json");
  return (JSON.parse(readFileSync(file, "utf8")) as { entries: JournalEntry[] })
    .entries;
}

/** One client set up like the app's pool: TLS rules from DATABASE_SSL*, UTC session. */
export async function openClient(
  url: string,
  env: NodeJS.ProcessEnv = process.env
) {
  const client = new pg.Client(connectionOptions(url, env));
  await client.connect();
  await client.query("SET TIME ZONE 'UTC'");
  return client;
}

export type ServerInfo = {
  version: string;
  major: number;
  database: string;
  user: string;
};

export async function serverInfo(client: pg.Client): Promise<ServerInfo> {
  const { rows } = await client.query<{
    version: string;
    num: string;
    db: string;
    usr: string;
  }>(
    "SELECT version() AS version, current_setting('server_version_num') AS num, current_database() AS db, current_user AS usr"
  );
  const row = rows[0];
  return {
    version: row.version,
    major: Math.floor(Number(row.num) / 10000),
    database: row.db,
    user: row.usr,
  };
}

/** Migrations in drizzle/ that the database has not applied yet. */
export async function pendingMigrations(client: pg.Client): Promise<string[]> {
  const exists = await client.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2",
    [MIGRATIONS_SCHEMA, MIGRATIONS_TABLE]
  );
  const applied = exists.rowCount
    ? Number(
        (
          await client.query<{ last: string | null }>(
            `SELECT MAX(created_at) AS last FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`
          )
        ).rows[0].last ?? 0
      )
    : 0;
  return journal()
    .filter(entry => entry.when > applied)
    .map(entry => entry.tag);
}

/** App tables that the Supabase Data API could still read (row level security off). */
export async function tablesWithoutRls(client: pg.Client): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity ORDER BY 1`
  );
  return rows.map(r => r.name);
}

/** Applies pending migrations. They only add tables, columns and rules, so this is safe on every start. */
export async function runMigrations(
  url: string,
  env: NodeJS.ProcessEnv = process.env
) {
  const client = await openClient(url, env);
  try {
    const { major } = await serverInfo(client);
    if (major < 14)
      throw new Error(
        `PostgreSQL ${major} is too old. Use PostgreSQL 14 or newer (Supabase is 15+).`
      );
    const pending = await pendingMigrations(client);
    if (!pending.length) return [];
    await migrate(drizzle(client), {
      migrationsFolder: migrationsFolder(),
      migrationsSchema: MIGRATIONS_SCHEMA,
      migrationsTable: MIGRATIONS_TABLE,
    });
    return pending;
  } finally {
    await client.end();
  }
}

/** Settings problems that stop a self-hosted server from starting safely. */
export function configProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  if (!env.DATABASE_URL) problems.push("DATABASE_URL is not set.");
  else {
    try {
      const url = new URL(env.DATABASE_URL);
      if (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
        problems.push(
          "DATABASE_URL must start with postgresql:// (copy it from Supabase → Connect → Session pooler)."
        );
      if (!url.pathname.replace("/", ""))
        problems.push(
          "DATABASE_URL has no database name after the last / (Supabase uses /postgres)."
        );
      if (url.password.includes("[") || /YOUR-PASSWORD/i.test(url.password))
        problems.push(
          "DATABASE_URL still has the [YOUR-PASSWORD] placeholder; put the real database password there."
        );
    } catch {
      problems.push(
        "DATABASE_URL is not a valid address. Special characters in the password (@ # / ? %) must be URL-encoded."
      );
    }
  }
  if (localAuthEnabled(env)) {
    const secret = env.JWT_SECRET || env.MANUS_JWT_SECRET || "";
    if (secret.length < MIN_JWT_SECRET_LENGTH)
      problems.push(
        `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} random characters.`
      );
  }
  return problems;
}

/** Express "trust proxy" for the host's HTTPS proxy, so the real visitor IP is used for login limits. */
export function trustProxySetting(
  env: NodeJS.ProcessEnv = process.env
): string | number | boolean {
  const value = env.TRUST_PROXY?.trim();
  if (!value) return "loopback, linklocal, uniquelocal";
  if (/^\d+$/.test(value)) return Number(value);
  if (value === "true" || value === "false") return value === "true";
  return value;
}
