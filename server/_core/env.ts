// Platform values are read at use time. See the Webdev service/authentication skills.
// Self-hosted installs (AUTH_MODE=local) use the plain names: JWT_SECRET, APP_ID.
export const ENV = {
  get appId() { return process.env.MANUS_PROJECT_ID || process.env.APP_ID || (localAuthEnabled() ? "gym" : ""); },
  get cookieSecret() { return process.env.MANUS_JWT_SECRET || process.env.JWT_SECRET || ""; },
  get databaseUrl() { return process.env.DATABASE_URL ?? ""; },
  get oAuthServerUrl() { return process.env.MANUS_OAUTH_API_URL ?? ""; },
  // Preserve the legacy hint when supplied; otherwise roles remain application data.
  get ownerOpenId() { return process.env.OWNER_OPEN_ID ?? ""; },
  get isProduction() { return process.env.NODE_ENV === "production"; },
  get forgeApiUrl() { return process.env.MANUS_API_URL ?? ""; },
  get forgeApiKey() { return process.env.MANUS_API_KEY ?? ""; },
};

/** Email + password sign-in instead of Manus OAuth (self-hosted installs). */
export function localAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUTH_MODE === "local";
}
