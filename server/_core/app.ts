// Builds the Express app: settings checks, database set-up, API and fingerprint-machine
// routes. Used by index.ts (a normal server that also serves the screens) and by vercel.ts
// (Vercel serves the screens from its CDN and runs this as a function).
import "dotenv/config";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerIclockRoutes } from "../biometric/iclock";
import { prepareDemo, startDemoMachineHeartbeat } from "../demo/seed";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { registerDevLoginRoutes } from "./devLogin";
import { demoModeEnabled, localAuthEnabled } from "./env";
import { ensureFirstOwner, registerLocalAuthRoutes } from "./localAuth";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";
import { configProblems, runMigrations, trustProxySetting } from "./selfHost";

export async function createApp() {
  const localAuth = localAuthEnabled();
  if (localAuth) {
    const problems = configProblems();
    if (problems.length)
      throw new Error(`Fix these settings first:\n- ${problems.join("\n- ")}`);
  }
  if (demoModeEnabled()) {
    await prepareDemo();
    startDemoMachineHeartbeat();
    console.log(
      "[Demo] Demo mode: sample data and demo logins (see the sign-in page)."
    );
  } else {
    if (process.env.AUTO_MIGRATE === "true" && process.env.DATABASE_URL) {
      const applied = await runMigrations(process.env.DATABASE_URL);
      console.log(
        applied.length
          ? `[Setup] Database updated: ${applied.join(", ")}`
          : "[Setup] Database is up to date."
      );
    }
    if (localAuth) await ensureFirstOwner();
  }

  const app = express();
  // Behind the host's HTTPS proxy: use the real visitor IP for login limits.
  if (localAuth) app.set("trust proxy", trustProxySetting());
  // Fingerprint machine (eSSL ADMS). Before the body parsers: it posts plain text.
  registerIclockRoutes(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/platform/config.js", (_req, res) => {
    res
      .set("Cache-Control", "no-store")
      .type("application/javascript")
      .send(publicPlatformScript());
  });
  if (localAuth) registerLocalAuthRoutes(app);
  else registerOAuthRoutes(app);
  registerDevLoginRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // Unmatched API calls must fail loudly, not fall through to the SPA page.
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
}
