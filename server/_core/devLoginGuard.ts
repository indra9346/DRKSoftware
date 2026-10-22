// Dependency-free on purpose: vite.config.ts loads publicConfig.ts (and so
// this file) before path aliases exist, so nothing here may import app code.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLocalDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Dev login exists only in development, when opted in, against a local database. */
export function devLoginEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.NODE_ENV === "development" &&
    env.DEV_LOGIN === "true" &&
    isLocalDatabaseUrl(env.DATABASE_URL)
  );
}
