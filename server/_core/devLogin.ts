// Local-only sign-in that skips Manus OAuth so the app can be explored on a
// developer machine. It is registered only when ALL of these hold:
//   NODE_ENV=development, DEV_LOGIN=true, and DATABASE_URL points at loopback.
// The loopback check keeps it away from the shared managed database.
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import type { InsertUser } from "../../drizzle/schema";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { devLoginEnabled } from "./devLoginGuard";
import { sdk } from "./sdk";

export { devLoginEnabled, isLocalDatabaseUrl } from "./devLoginGuard";

type DevRole = {
  openId: string;
  name: string;
  email: string;
  // Omitted for the owner: upsertUser grants "admin" to the claimed owner.
  role?: InsertUser["role"];
};

const DEV_ROLES: Record<string, DevRole> = {
  owner: { openId: "dev-owner", name: "Dev Owner", email: "owner@dev.local" },
  frontdesk: { openId: "dev-frontdesk", name: "Dev Front Desk", email: "frontdesk@dev.local", role: "receptionist" },
  trainer: { openId: "dev-trainer", name: "Dev Trainer", email: "trainer@dev.local", role: "trainer" },
  member: { openId: "dev-member", name: "Dev Member", email: "member@dev.local", role: "member" },
};

export function resolveDevRole(key: unknown): DevRole | null {
  return typeof key === "string" && Object.hasOwn(DEV_ROLES, key) ? DEV_ROLES[key] : null;
}

async function ensureDevUser(devRole: DevRole) {
  await db.upsertUser({ ...devRole, loginMethod: "dev" });
}

/** Creates every dev user, owner first so it claims the empty owner slot. */
export async function ensureDevUsers() {
  for (const devRole of Object.values(DEV_ROLES)) await ensureDevUser(devRole);
}

export async function signInDevUser(devRole: DevRole) {
  // The owner goes first so it claims the owner slot instead of whichever
  // role happens to be picked first.
  await ensureDevUser(DEV_ROLES.owner);
  if (devRole !== DEV_ROLES.owner) await ensureDevUser(devRole);
  return sdk.createSessionToken(devRole.openId, { name: devRole.name, expiresInMs: ONE_YEAR_MS });
}

export function registerDevLoginRoutes(app: Express) {
  if (!devLoginEnabled()) return;
  console.warn("[DevLogin] Local dev login is ENABLED at POST /api/dev/login (local database only).");

  app.post("/api/dev/login", async (req: Request, res: Response) => {
    const devRole = resolveDevRole(req.body?.as);
    if (!devRole) {
      res.status(400).json({ error: "Unknown dev role" });
      return;
    }
    try {
      const sessionToken = await signInDevUser(devRole);
      res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
      res.redirect(303, "/");
    } catch (error) {
      console.error("[DevLogin] Failed", error instanceof Error ? error.message : error);
      res.status(500).json({ error: "Dev login failed. Is the local database running and migrated?" });
    }
  });
}
