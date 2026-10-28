// In-memory PostgreSQL for demo mode without a DATABASE_URL. PGlite runs a real PostgreSQL
// inside Node, so the app's queries, migrations and triggers run unchanged. It is rebuilt
// (and refilled with sample data) every time the server starts.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

let demo: ReturnType<typeof drizzle> | null = null;
let client: PGlite | null = null;

export function createDemoDatabase() {
  client = new PGlite();
  demo = drizzle({ client });
  return demo;
}

export async function migrateDemoDatabase(migrationsFolder: string) {
  if (!demo || !client) throw new Error("Demo database is not created yet");
  await client.exec("SET TIME ZONE 'UTC'");
  await migrate(demo, { migrationsFolder });
}
