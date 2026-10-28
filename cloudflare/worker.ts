// Runs the gym software on Cloudflare. This Worker receives every request (staff screens,
// the gate screen and the fingerprint machine's /iclock traffic) and forwards it to one
// always-on Cloudflare Container running the repository's Dockerfile, the same image any
// other host would run. All data lives in Supabase. Settings: wrangler.jsonc + secrets.
import { Container, getContainer } from "@cloudflare/containers";

interface Env {
  APP: DurableObjectNamespace<GymApp>;
  // Secrets (Cloudflare dashboard → the Worker → Settings → Variables and Secrets, or
  // `wrangler secret put NAME`).
  DATABASE_URL: string;
  JWT_SECRET: string;
  FIRST_OWNER_NAME?: string;
  FIRST_OWNER_EMAIL?: string;
  FIRST_OWNER_PASSWORD?: string;
  DATABASE_SSL_CA?: string;
  WHATSAPP_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  // Plain settings ("vars" in wrangler.jsonc).
  PUBLIC_URL?: string;
  ADMS_TIMEZONE?: string;
  WHATSAPP_TEMPLATE?: string;
  WHATSAPP_TEMPLATE_LANG?: string;
}

// Settings handed to the app's environment, as on any other host (.env.example).
const PASSED_SETTINGS = [
  "DATABASE_URL",
  "JWT_SECRET",
  "FIRST_OWNER_NAME",
  "FIRST_OWNER_EMAIL",
  "FIRST_OWNER_PASSWORD",
  "DATABASE_SSL_CA",
  "WHATSAPP_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "PUBLIC_URL",
  "ADMS_TIMEZONE",
  "WHATSAPP_TEMPLATE",
  "WHATSAPP_TEMPLATE_LANG",
] as const;

export class GymApp extends Container<Env> {
  defaultPort = 3000;
  // Any request keeps it awake, and the fingerprint machine checks in about every 10 seconds,
  // so it only sleeps when the gym is offline. The next request wakes it in a few seconds.
  sleepAfter = "30m";

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    const settings: Record<string, string> = {};
    for (const key of PASSED_SETTINGS) {
      const value = env[key];
      if (typeof value === "string" && value) settings[key] = value;
    }
    this.envVars = {
      NODE_ENV: "production",
      PORT: "3000",
      AUTH_MODE: "local",
      AUTO_MIGRATE: "true",
      // One proxy hop (this Worker), which sets X-Forwarded-For below.
      TRUST_PROXY: "1",
      ...settings,
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    // The app uses these for HTTPS-only cookies and per-visitor sign-in limits. Both are set
    // here from Cloudflare's own values, so a visitor cannot fake them.
    headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
    const visitor = request.headers.get("cf-connecting-ip");
    if (visitor) headers.set("x-forwarded-for", visitor);
    else headers.delete("x-forwarded-for");
    // A single instance: sign-in limits and the machine's update timing live in its memory.
    return getContainer(env.APP).fetch(new Request(request, { headers }));
  },
};
