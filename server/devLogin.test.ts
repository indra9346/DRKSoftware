import { describe, expect, it } from "vitest";
import { devLoginEnabled, isLocalDatabaseUrl, resolveDevRole } from "./_core/devLogin";
import { publicPlatformConfig } from "./_core/publicConfig";

const local = "mysql://root:dev@127.0.0.1:3307/swangym_dev";

describe("local-only dev login guard", () => {
  it("recognises only loopback database hosts", () => {
    expect(isLocalDatabaseUrl(local)).toBe(true);
    expect(isLocalDatabaseUrl("mysql://u:p@localhost:3306/db")).toBe(true);
    expect(isLocalDatabaseUrl("mysql://u:p@[::1]:3306/db")).toBe(true);
    expect(isLocalDatabaseUrl("mysql://u:p@db.example.com:3306/db")).toBe(false);
    expect(isLocalDatabaseUrl("mysql://u:p@localhost.example.com/db")).toBe(false);
    expect(isLocalDatabaseUrl("not a url")).toBe(false);
    expect(isLocalDatabaseUrl(undefined)).toBe(false);
  });

  it("requires development mode, the opt-in flag and a local database", () => {
    const on = { NODE_ENV: "development", DEV_LOGIN: "true", DATABASE_URL: local };
    expect(devLoginEnabled(on)).toBe(true);
    expect(devLoginEnabled({ ...on, NODE_ENV: "production" })).toBe(false);
    expect(devLoginEnabled({ ...on, NODE_ENV: undefined })).toBe(false);
    expect(devLoginEnabled({ ...on, DEV_LOGIN: undefined })).toBe(false);
    expect(devLoginEnabled({ ...on, DEV_LOGIN: "1" })).toBe(false);
    expect(devLoginEnabled({ ...on, DATABASE_URL: "mysql://u:p@shared.host/db" })).toBe(false);
    expect(devLoginEnabled({ ...on, DATABASE_URL: undefined })).toBe(false);
  });

  it("only accepts known dev roles", () => {
    expect(resolveDevRole("owner")?.openId).toBe("dev-owner");
    expect(resolveDevRole("frontdesk")?.role).toBe("receptionist");
    expect(resolveDevRole("trainer")?.role).toBe("trainer");
    expect(resolveDevRole("member")?.role).toBe("member");
    expect(resolveDevRole("admin")).toBeNull();
    expect(resolveDevRole("toString")).toBeNull();
    expect(resolveDevRole(undefined)).toBeNull();
  });

  it("tells the browser whether dev login is available", () => {
    expect(publicPlatformConfig({ NODE_ENV: "development", DEV_LOGIN: "true", DATABASE_URL: local }).devLogin).toBe(true);
    expect(publicPlatformConfig({ NODE_ENV: "production", DEV_LOGIN: "true", DATABASE_URL: local }).devLogin).toBe(false);
  });
});
