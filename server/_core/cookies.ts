import type { CookieOptions, Request } from "express";
import { localAuthEnabled } from "./env";

/** True when the visitor reached us over HTTPS, directly or through the host's proxy. */
export function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  const forwarded = req.headers["x-forwarded-proto"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(
    ","
  )[0];
  return first?.trim().toLowerCase() === "https";
}

export function getSessionCookieOptions(req: Request): CookieOptions {
  // Self-hosted: a first-party cookie, Secure whenever the site is on HTTPS. A plain-HTTP
  // install on the gym's own network still works because browsers drop Secure cookies there.
  if (localAuthEnabled())
    return {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: isHttpsRequest(req),
    };
  // Preview is public HTTPS in a cross-site frame even when the upstream request is HTTP.
  return { httpOnly: true, path: "/", sameSite: "none", secure: true };
}
