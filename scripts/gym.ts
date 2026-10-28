// Gym software server setup and health checks (Supabase / any PostgreSQL).
//
//   pnpm gym setup                 create/update the tables, create the owner login
//   pnpm gym check                 read-only report: settings, database, machine
//   pnpm gym password <email>      set or reset a login's password (--owner [--name "Name"] makes it the owner)
//   pnpm gym secret                print a new random JWT_SECRET
//
// On a server without the source tools, the built copy does the same: node dist/gym.js check
// Settings come from the environment or a .env file next to package.json (see .env.example).
import "dotenv/config";
import { randomBytes } from "crypto";
import readline from "readline";

// `secret` must print only the secret, so the app's modules (some log on load) are
// imported only after it.
if (process.argv[2] === "secret") {
  console.log(randomBytes(48).toString("base64url"));
  process.exit(0);
}
const { count, eq } = await import("drizzle-orm");
const { biometricMembers, devices, deviceCommands, members, plans } =
  await import("../drizzle/schema");
const { localAuthEnabled } = await import("../server/_core/env");
const {
  findCredential,
  makeOwner,
  normalizeEmail,
  passwordProblem,
  setPassword,
  syncAccount,
} = await import("../server/_core/localAuth");
const {
  configProblems,
  openClient,
  pendingMigrations,
  runMigrations,
  serverInfo,
  tablesWithoutRls,
} = await import("../server/_core/selfHost");
const { getBiometricSettings } = await import("../server/biometric/engine");
const { getDb, getGymSettings } = await import("../server/db");

let warnings = 0;
const ok = (text: string) => console.log(`  OK    ${text}`);
const warn = (text: string) => {
  warnings++;
  console.log(`  WARN  ${text}`);
};
const fail = (text: string) => console.log(`  FAIL  ${text}`);
const head = (text: string) => console.log(`\n${text}`);

function ask(question: string, hidden = false): Promise<string> {
  // Without a keyboard (piped or scheduled runs) a prompt would wait forever.
  if (!process.stdin.isTTY) {
    console.log(`
${question.trim()} Not typed in: pass it as an option (see the top of scripts/gym.ts).`);
    process.exit(1);
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  if (hidden) {
    // Echo * instead of the typed password.
    const rlx = rl as unknown as { _writeToOutput: (s: string) => void };
    rlx._writeToOutput = s =>
      process.stdout.write(
        s.includes(question) ? s : s.replace(/[^\r\n]/g, "*")
      );
  }
  return new Promise(resolve =>
    rl.question(question, answer => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    })
  );
}

async function askPassword(label: string): Promise<string> {
  for (;;) {
    const first = await ask(`${label}: `, true);
    const problem = passwordProblem(first);
    if (problem) {
      console.log(`  ${problem}`);
      continue;
    }
    if ((await ask("Type it again: ", true)) === first) return first;
    console.log("  The two passwords do not match. Try again.");
  }
}

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

function requireSettings() {
  const problems = configProblems();
  if (!localAuthEnabled())
    problems.push("AUTH_MODE must be local for a self-hosted install.");
  if (problems.length) {
    head("Settings");
    for (const p of problems) fail(p);
    console.log(
      "\nFix these in .env (or the host's environment variables) and run again."
    );
    process.exit(1);
  }
}

function ageText(date: Date | null) {
  if (!date) return "never";
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 90) return `${s} seconds ago`;
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`;
  if (s < 172800) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}

async function setup() {
  requireSettings();
  const url = process.env.DATABASE_URL!;
  head("Database");
  const client = await openClient(url);
  const info = await serverInfo(client);
  ok(
    `Connected: PostgreSQL ${info.major}, database "${info.database}" as ${info.user}`
  );
  await client.end();
  const applied = await runMigrations(url);
  ok(
    applied.length
      ? `Tables created/updated: ${applied.join(", ")}`
      : "Tables are already up to date"
  );
  const check = await openClient(url);
  const open = await tablesWithoutRls(check);
  await check.end();
  if (open.length) warn(`Row level security is OFF for: ${open.join(", ")}`);
  else
    ok("Tables are closed to the Supabase public API (row level security on)");
  const settings = await getGymSettings();
  ok(`Gym settings ready (${settings?.gymName ?? "the gym"})`);

  head("Owner login");
  if (settings?.ownerOpenId) {
    ok(
      "An owner is already set. Use `gym password <email>` to reset a password."
    );
  } else {
    const email = normalizeEmail(
      arg("email") ??
        process.env.FIRST_OWNER_EMAIL ??
        (await ask("Owner's email: "))
    );
    if (!email.includes("@")) {
      fail("That is not an email address.");
      process.exit(1);
    }
    const password =
      arg("password") ??
      process.env.FIRST_OWNER_PASSWORD ??
      (await askPassword("Owner's password (8+ characters)"));
    const name =
      arg("name") ??
      process.env.FIRST_OWNER_NAME ??
      (process.stdin.isTTY
        ? await ask("Owner's name (shown in the app): ")
        : "");
    const { openId } = await setPassword(email, password);
    await makeOwner(openId, email, name || null);
    ok(`Owner login created: ${email}`);
  }

  head("Next");
  console.log(
    "  Start the app, open it in a browser and sign in with the owner's email and password."
  );
  console.log(
    "  Then run `gym check` any time to see the database and machine status."
  );
}

async function checkAll() {
  let problems = 0;
  head("Settings");
  const settingsProblems = configProblems();
  for (const p of settingsProblems) fail(p);
  problems += settingsProblems.length;
  if (localAuthEnabled()) ok("Sign-in: email + password (AUTH_MODE=local)");
  else {
    warn("AUTH_MODE is not local, so the app expects Manus sign-in");
    problems++;
  }
  if (process.env.AUTO_MIGRATE === "true")
    ok("AUTO_MIGRATE=true: the app updates its tables on start");
  else warn("AUTO_MIGRATE is off: run `gym setup` after every update");
  if (process.env.FIRST_OWNER_PASSWORD)
    warn(
      "FIRST_OWNER_PASSWORD is still set; remove it after the first sign-in"
    );
  if (!process.env.DATABASE_URL) return finish(problems + 1);

  head("Database");
  let client;
  try {
    const started = Date.now();
    client = await openClient(process.env.DATABASE_URL);
    const info = await serverInfo(client);
    ok(
      `Connected in ${Date.now() - started} ms: PostgreSQL ${info.major}, database "${info.database}"`
    );
  } catch (error) {
    fail(`Cannot connect: ${error instanceof Error ? error.message : error}`);
    console.log(
      "        Check the Session pooler address, the password and that the Supabase project is not paused."
    );
    return finish(problems + 1);
  }
  const pending = await pendingMigrations(client);
  if (pending.length) {
    fail(`Tables not up to date (${pending.join(", ")}). Run \`gym setup\`.`);
    await client.end();
    return finish(problems + 1);
  }
  ok("Tables are up to date");
  const open = await tablesWithoutRls(client);
  if (open.length) {
    fail(
      `Row level security is OFF for: ${open.join(", ")} (readable with the Supabase public key)`
    );
    problems++;
  } else ok("Row level security is on for every table");
  await client.end();

  const db = (await getDb())!;
  const settings = await getGymSettings();
  if (settings?.ownerOpenId) ok(`Owner is set (gym name: ${settings.gymName})`);
  else {
    fail("No owner yet. Run `gym setup`.");
    problems++;
  }
  const [{ n: memberCount }] = await db.select({ n: count() }).from(members);
  const [{ n: planCount }] = await db
    .select({ n: count() })
    .from(plans)
    .where(eq(plans.active, true));
  ok(`${memberCount} members, ${planCount} active plans`);
  if (!planCount)
    warn("No active plans yet: add the gym's plans and prices under Plans");

  head("Fingerprint machine");
  const machineSettings = await getBiometricSettings(db);
  const machines = await db.select().from(devices);
  const [{ n: linked }] = await db
    .select({ n: count() })
    .from(biometricMembers);
  if (!machines.length)
    warn(
      "No machine has connected yet (Gowda points it at the server, see docs/BIOMETRIC.md)"
    );
  for (const m of machines) {
    const seen =
      m.lastSeenAt && Date.now() - m.lastSeenAt.getTime() < 5 * 60_000;
    const line = `${m.name} (serial ${m.sn}): ${m.status}, last contact ${ageText(m.lastSeenAt)}`;
    if (m.status === "active" && seen) ok(line);
    else {
      warn(
        m.status === "pending"
          ? `${line}. Approve it on the Fingerprint machine page.`
          : line
      );
      problems++;
    }
  }
  const [{ n: failed }] = await db
    .select({ n: count() })
    .from(deviceCommands)
    .where(eq(deviceCommands.status, "failed"));
  if (failed)
    warn(
      `${failed} machine updates failed; see Fingerprint machine → Recent updates`
    );
  ok(`${linked} members linked to a machine User ID`);
  if (machineSettings.machine.enforce)
    ok(
      `Blocking is ON: expired members' fingerprints are removed (${machineSettings.machine.blockMode})`
    );
  else
    warn(
      "Blocking is OFF (monitor mode): expired members can still open the door. Switch it on after testing."
    );

  if (process.env.PUBLIC_URL) {
    head("Website");
    const base = process.env.PUBLIC_URL.replace(/\/+$/, "");
    try {
      const res = await fetch(`${base}/api/health`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) ok(`${base} is online`);
      else {
        fail(`${base}/api/health answered ${res.status}`);
        problems++;
      }
    } catch (error) {
      fail(
        `${base} cannot be reached: ${error instanceof Error ? error.message : error}`
      );
      problems++;
    }
  }
  return finish(problems);
}

function finish(problems: number) {
  if (problems)
    console.log(`\n${problems} problem(s) to fix (FAIL lines above).`);
  else if (warnings)
    console.log(
      `\nNo problems. ${warnings} warning(s) above to look at before going live.`
    );
  else console.log("\nEverything is ready.");
  process.exit(problems ? 1 : 0);
}

async function password() {
  requireSettings();
  const email = process.argv[3];
  if (!email || !email.includes("@")) {
    console.log("Usage: gym password <email> [--owner]");
    process.exit(1);
  }
  const pending = await (async () => {
    const client = await openClient(process.env.DATABASE_URL!);
    try {
      return await pendingMigrations(client);
    } finally {
      await client.end();
    }
  })();
  if (pending.length) {
    fail("The tables are not set up yet. Run `gym setup` first.");
    process.exit(1);
  }
  const existed = Boolean(await findCredential(email));
  const value =
    arg("password") ??
    (await askPassword(`New password for ${normalizeEmail(email)}`));
  const { openId } = await setPassword(email, value);
  if (process.argv.includes("--owner")) {
    await makeOwner(openId, normalizeEmail(email), arg("name"));
    ok(`${normalizeEmail(email)} is now the owner.`);
  } else await syncAccount(openId, normalizeEmail(email));
  ok(
    existed
      ? "Password changed. Their other devices are signed out."
      : "Login created."
  );
  process.exit(0);
}

const command = process.argv[2];
const run =
  command === "setup"
    ? setup
    : command === "check"
      ? checkAll
      : command === "password"
        ? password
        : null;
if (!run) {
  console.log("Usage: gym setup | check | password <email> [--owner] | secret");
  process.exit(1);
}
run()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(
      `\nFailed: ${error instanceof Error ? error.message : error}`
    );
    process.exit(1);
  });
