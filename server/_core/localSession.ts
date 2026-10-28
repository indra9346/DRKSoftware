// Session check for email + password logins (AUTH_MODE=local). Kept apart from
// localAuth.ts so sdk.ts can use it without an import cycle.
import { eq } from "drizzle-orm";
import { loginCredentials } from "../../drizzle/schema";
import { getDb } from "../db";
import { localAuthEnabled } from "./env";

/**
 * A session for a password login is valid only if it was issued after the password was
 * last set, so resetting a password signs that person out everywhere. Accounts without
 * a password row (Manus or dev logins) are not affected.
 */
export async function credentialSessionValid(
  openId: string,
  issuedAtSeconds: number | undefined
): Promise<boolean> {
  if (!localAuthEnabled()) return true;
  const db = await getDb();
  if (!db) return false;
  const credential = (
    await db
      .select({ passwordChangedAt: loginCredentials.passwordChangedAt })
      .from(loginCredentials)
      .where(eq(loginCredentials.openId, openId))
      .limit(1)
  )[0];
  if (!credential) return true;
  if (!issuedAtSeconds) return false;
  return (
    issuedAtSeconds >= Math.floor(credential.passwordChangedAt.getTime() / 1000)
  );
}
