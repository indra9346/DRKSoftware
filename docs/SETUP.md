# Going live: Supabase (database) + Cloudflare (app and domain)

This is the checklist for putting DRK Fitness Gym's software on its own database (Supabase) and
on Cloudflare, with email + password sign-in. The fingerprint machine and door are Gowda's part:
[GOWDA_MACHINE_SETUP.md](GOWDA_MACHINE_SETUP.md).

| Who | Does what |
|---|---|
| You (SWAN) | Buy and set up the database and hosting (steps 1–4), give Gowda the address |
| Gym owner (owner login) | Fills in plans, members and staff (step 5), approves the machine, switches on blocking |
| Gowda | Machine, door lock and network at the gym, and the on-site tests |

## What to buy

| Item | Why | Notes |
|---|---|---|
| **Supabase project** | The database: members, payments, attendance, fingerprint backups | Region **South Asia (Mumbai)**. **Pro** plan recommended for a live gym: daily backups and the project is never paused. The Free plan has no backup guarantee and pauses after a week without use. Check today's prices on supabase.com/pricing. |
| **Cloudflare Workers Paid plan** | Runs the app (screens, logins, the fingerprint machine's connection) as a Cloudflare Container | $5 a month, plus container use beyond the included amount. The app needs one always-on "basic" instance (¼ vCPU, 1 GB); expect very roughly $12–15 a month in total. Check developers.cloudflare.com/containers/platform/pricing. |
| **A domain on Cloudflare** (recommended) | The web address staff open and the machine sends punches to, e.g. `app.<gym-domain>` | Any domain whose DNS is on Cloudflare (free plan). Without one the app still works at `https://drk-fitness.<your-account>.workers.dev`. |
| At the gym: **front-desk PC on 24/7** with a UPS, router on the UPS | Runs the small bridge program when the machine cannot use HTTPS (most eSSL units) | Gowda confirms this on site. |

## 1. Create the Supabase project

1. supabase.com → **New project**.
   - Name: `drk-fitness`
   - Region: **South Asia (Mumbai)**
   - Database password: long, **letters and numbers only** (no `@ # / ? %`, which break the
     address). Save it in a password manager.
2. Open the project → **Connect** → choose **Session pooler** → copy the URI. It looks like
   `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`.
   Replace `[YOUR-PASSWORD]` (including the brackets) with the password.
   - Use **Session pooler**, not "Direct connection": the direct one needs IPv6.

Do not create tables by hand. The app creates and updates them itself on its first start, and
switches on row level security so Supabase's public API keys cannot read any gym data.

## 2. Prepare the settings

All settings are listed, with explanations, in [`.env.example`](../.env.example). On Cloudflare
these are already fixed by the deployment: `AUTH_MODE=local`, `AUTO_MIGRATE=true`,
`NODE_ENV=production`, `ADMS_TIMEZONE=330`. You add only these:

| Setting | Type on Cloudflare | Value |
|---|---|---|
| `DATABASE_URL` | Secret | The Session pooler URI from step 1, with the real password |
| `JWT_SECRET` | Secret | 48+ random characters. Make one with `pnpm gym secret`. Changing it later signs everyone out |
| `FIRST_OWNER_NAME` | Secret | The gym owner's name, shown in the app |
| `FIRST_OWNER_EMAIL` | Secret | The owner's email (their sign-in) |
| `FIRST_OWNER_PASSWORD` | Secret | A temporary password, 8+ characters. Delete it after the first sign-in |
| `PUBLIC_URL` | Text | The web address, e.g. `https://app.example.in` |

Optional: `DATABASE_SSL_CA` (verifies Supabase's certificate; the connection is encrypted either
way) and the `WHATSAPP_*` settings for automatic WhatsApp (see [BIOMETRIC.md](BIOMETRIC.md)).

## 3. Put the app on Cloudflare

How it runs: [`wrangler.jsonc`](../wrangler.jsonc) defines a Worker ([`cloudflare/worker.ts`](../cloudflare/worker.ts))
that forwards every request to one Cloudflare Container built from the repository's
[`Dockerfile`](../Dockerfile). Building the container needs Docker, so the easiest way is to let
GitHub build and deploy it (no Docker needed on your PC).

### 3a. One-time Cloudflare set-up

1. dash.cloudflare.com → sign in → **Workers & Pages** → subscribe to **Workers Paid**.
2. Note your **Account ID** (Workers & Pages → right-hand side of the overview page).
3. **My Profile → API Tokens → Create Token** → template **Edit Cloudflare Workers** → choose
   your account → create, and copy the token. (If the deploy later says the token lacks a
   Containers permission, edit the token and add **Containers: Edit**.)

### 3b. Deploy from GitHub

1. GitHub → `swandigitalsolutions/Fit-Crush-Gym-Software` → **Settings → Secrets and variables →
   Actions**:
   - **Secrets** tab: `CLOUDFLARE_API_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID`.
   - **Variables** tab: `CLOUDFLARE_DEPLOY` = `true`.
2. **Actions → Deploy to Cloudflare → Run workflow** (branch `main`). It also runs by itself after
   every merge to `main`. The first build takes several minutes.
3. Cloudflare → **Workers & Pages → drk-fitness → Settings → Variables and Secrets**: add the
   settings from step 2.
4. Run the workflow once more, so the container starts with these settings. (A running container
   keeps the settings it started with.) After the first deploy, Cloudflare says to allow a few
   minutes before the container answers.
5. Open `https://drk-fitness.<your-account>.workers.dev` (shown on the Worker's page). Sign in with
   the owner email and temporary password, then **Change password** (bottom of the menu).
6. Delete the `FIRST_OWNER_PASSWORD` secret on Cloudflare.

Deploying from a PC instead: start Docker Desktop, then in the repository run
`pnpm exec wrangler login` and `pnpm exec wrangler deploy`.

The container's logs (the `[Setup] Database updated ...` and `Owner login created ...` lines on
the first start) are under **Workers & Pages → drk-fitness → Containers / Logs**.

### 3c. Your domain

1. The domain must be on Cloudflare (add the site and switch its nameservers, if not done yet).
2. **Workers & Pages → drk-fitness → Settings → Domains & Routes → Add → Custom domain**:
   e.g. `app.example.in`. Cloudflare creates the DNS record and the certificate.
3. Change `PUBLIC_URL` to the new address and give Gowda this address.

### Alternative: Render

[`render.yaml`](../render.yaml) runs the same Docker image on Render (render.com → **New →
Blueprint** → this repository; region Singapore, smallest paid instance). The settings are the
same as step 2. Other hosts: `pnpm install`, `pnpm build`, then `node dist/index.js` with the
settings from [`.env.example`](../.env.example).

## 4. Check everything

On your PC, in a copy of the repository with a `.env` file holding the same settings:

```bash
pnpm gym check
```

Before the machine is connected it should end with only warnings, no `FAIL` lines:

```
Database
  OK    Connected in 120 ms: PostgreSQL 17, database "postgres"
  OK    Tables are up to date
  OK    Row level security is on for every table
  OK    Owner is set (gym name: DRK Fitness Gym)
Fingerprint machine
  WARN  No machine has connected yet ...
  WARN  Blocking is OFF (monitor mode) ...
Website
  OK    https://app.example.in is online
```

`pnpm gym setup` can also create the tables and the owner login from your PC, before the app is
deployed (it asks for the owner's email, name and password).

## 5. Fill in the software (gym owner, before blocking)

1. **Settings**: address, phone, receipt details. (The name is already DRK Fitness Gym.)
2. **Plans & renewals**: DRK Fitness Gym's real plans and prices.
3. **Members**: every current member with their **real plan end date** and payments. Blocking uses
   these dates, so a member without a plan here would be blocked.
4. **Team & access → Add staff**: email, role and a password for each receptionist and trainer.
   Tell them the password in person; they can change it after signing in.

## 6. Hand over to Gowda

Send Gowda:
- [GOWDA_MACHINE_SETUP.md](GOWDA_MACHINE_SETUP.md) (or its PDF / Word file) and the bridge program,
- the web address from step 3,
- a receptionist or owner login for the test (or be on the phone with the owner).

When the machine shows **Waiting for approval** on **Fingerprint machine**, the owner checks the
serial number and presses **Approve machine**.

## 7. Switch on blocking

Only after Gowda's tests pass and every member's plan is entered: **Fingerprint machine → Access &
alert settings → Block expired members on the machine → Save**. The page lists exactly who will be
blocked before it saves. Run `pnpm gym check` afterwards: it should say `Blocking is ON`.

## Day to day

- **Forgotten staff password:** owner → Team & access → **Reset password**.
- **Forgotten owner password:** `pnpm gym password owner@example.com --owner` (from a PC with the
  `.env` settings). It signs the owner out of other devices.
- **Updates:** merge to `main`; the GitHub workflow deploys it. With `AUTO_MIGRATE=true` the app
  updates its own tables on start (additions only, nothing is deleted).
- **Backups:** Supabase Pro keeps daily backups. Once a month also export **Reports & expenses →
  CSV** and keep it with the gym's records.

## If something goes wrong

| Message | Fix |
|---|---|
| `DATABASE_URL still has the [YOUR-PASSWORD] placeholder` | Put the real password in, without brackets |
| `password authentication failed` | Wrong password, or the user is not `postgres.<project-ref>` (copy the Session pooler URI again) |
| `Tenant or user not found` | The pooler address is for another region or project; copy it again from Connect |
| `connect ENETUNREACH` or a long IPv6 address in the error | You used the Direct connection; use the Session pooler |
| `Fix these settings first` in the container log | The line names the missing setting; add it on Cloudflare and run the deploy again |
| The site shows an error right after the first deploy | Wait a few minutes; then check the container log |
| Deploy workflow is skipped | The `CLOUDFLARE_DEPLOY` variable is not `true` |
| Deploy fails with an authentication or permission error | Check `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`; add **Containers: Edit** to the token |
| `self-signed certificate in certificate chain` | Remove `sslmode=` from the address and `DATABASE_SSL_CA`, or give the correct Supabase certificate |
| The sign-in page says "Sign in with Manus" | `AUTH_MODE=local` is missing (only on hosts other than Cloudflare) |
| Everyone is signed out after a deploy | `JWT_SECRET` changed; keep it fixed |
| Project paused (Free plan) | Restore it in the Supabase dashboard, or move to Pro |
