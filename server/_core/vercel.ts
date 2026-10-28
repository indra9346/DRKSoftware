// Vercel function: api/index.js re-exports this (built to dist/vercel.js). Vercel serves the
// screens from dist/public; vercel.json sends /api/* and /iclock/* here. The app is built
// once per function instance; in demo mode that includes filling the sample data.
import type { IncomingMessage, ServerResponse } from "http";
import { createApp } from "./app";

const ready = createApp();
ready.catch(error => console.error("[Startup] Failed:", error));

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
) {
  const app = await ready;
  app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
