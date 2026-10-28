// Platform values are read at use time. See the Webdev service/authentication skills.
// Self-hosted installs (AUTH_MODE=local) use the plain names: JWT_SECRET, APP_ID.
// Dependency-free on purpose: vite.config.ts loads this (through publicConfig.ts).
export const ENV = {
  get appId() { return process.env.MANUS_PROJECT_ID || process.env.APP_ID || (localAuthEnabled() ? "gym" : ""); },
  get cookieSecret() { return jwtSecret(); },
  get databaseUrl() { return process.env.DATABASE_URL ?? ""; },
  get oAuthServerUrl() { return process.env.MANUS_OAUTH_API_URL ?? ""; },
  // Preserve the legacy hint when supplied; otherwise roles remain application data.
  get ownerOpenId() { return process.env.OWNER_OPEN_ID ?? ""; },
  get isProduction() { return process.env.NODE_ENV === "production"; },
  get forgeApiUrl() { return process.env.MANUS_API_URL ?? ""; },
  get forgeApiKey() { return process.env.MANUS_API_KEY ?? ""; },
};

/**
 * Demo mode: the whole software with sample data and demo logins, for showing to a client.
 * On with DEMO_MODE=true, and automatically on Vercel when no DATABASE_URL is set. Without a
 * DATABASE_URL it runs on an in-memory database that is rebuilt on every start.
 */
export function demoModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DEMO_MODE === "true" || (env.VERCEL === "1" && !env.DATABASE_URL);
}

/** Email + password sign-in instead of Manus OAuth (self-hosted installs and demo mode). */
export function localAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUTH_MODE === "local" || demoModeEnabled(env);
}

// Only signs demo sessions over sample data; a real install must set its own JWT_SECRET.
const DEMO_JWT_SECRET = "demo-only-session-key-for-sample-data-not-for-real-use";

export function jwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  return env.MANUS_JWT_SECRET || env.JWT_SECRET || (demoModeEnabled(env) ? DEMO_JWT_SECRET : "");
}
