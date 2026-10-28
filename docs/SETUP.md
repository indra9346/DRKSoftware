# Going live: Supabase database + app hosting

This is the checklist for putting Fit Crush on its own database (Supabase) and its own web
address, with email + password sign-in. The fingerprint machine and door are Gowda's part:
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
| **A Node.js host for the app** | Supabase only stores data. The screens, logins and the machine's connection run in this app, which needs a server | Hostinger **Business** or **Cloud** web hosting (Node.js web apps), the same kind we use for our other sites. Any VPS with Node.js 20+ also works. |
| **A web address** | Where staff open the software and where the machine sends punches | For example `app.<gym-domain>`. Must have HTTPS (Hostinger adds it free). |
| At the gym: **front-desk PC on 24/7** with a UPS, router on the UPS | Runs the small bridge program when the machine cannot use HTTPS (most eSSL units) | Gowda confirms this on site. |

## 1. Create the Supabase project

1. supabase.com → **New project**.
   - Name: `fitcrush`
   - Region: **South Asia (Mumbai)**
   - Database password: long, **letters and numbers only** (no `@ # / ? %`, which break the
     address). Save it in a password manager.
2. Open the project → **Connect** → choose **Session pooler** → copy the URI. It looks like
   `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`.
   Replace `[YOUR-PASSWORD]` (including the brackets) with the password.
   - Use **Session pooler**, not "Direct connection": the direct one needs IPv6, which most
     hosting does not have.

Do not create tables by hand. The app creates and updates them itself, and switches on row level
security so Supabase's public API keys cannot read any gym data.

## 2. Prepare the settings

All settings are listed, with explanations, in [`.env.example`](../.env.example).

| Setting | Value |
|---|---|
| `DATABASE_URL` | The Session pooler URI from step 1, with the real password |
| `AUTH_MODE` | `local` |
| `JWT_SECRET` | 48+ random characters. Make one with `pnpm fitcrush secret`. Keep it secret; changing it signs everyone out |
| `AUTO_MIGRATE` | `true` |
| `NODE_ENV` | `production` |
| `FIRST_OWNER_NAME` | The gym owner's name, shown in the app |
| `FIRST_OWNER_EMAIL` | The owner's email (their sign-in) |
| `FIRST_OWNER_PASSWORD` | A temporary password, 8+ characters. Remove it after the first sign-in |
| `PUBLIC_URL` | The web address, e.g. `https://app.example.in` |

Optional: `ADMS_TIMEZONE` (default `330`, India time), `DATABASE_SSL_CA` (verifies Supabase's
certificate; the connection is encrypted either way), and the `WHATSAPP_*` settings for automatic
WhatsApp (see [BIOMETRIC.md](BIOMETRIC.md)).

## 3. Put the app on Hostinger (Node.js web app)

1. hPanel → **Websites → Add website → Node.js web app**.
2. Source: **Import from GitHub** → `swandigitalsolutions/Fit-Crush-Gym-Software`, branch `main`
   (after PR #1 is merged). A zip upload of the repository also works; leave out `node_modules`
   and `.git`.
3. Build settings:
   - Node.js version: **22** (20 also works)
   - Package manager: **pnpm** (detected automatically from `pnpm-lock.yaml`)
   - Build command: the `build` script
   - Entry file: **`dist/index.js`**
4. **Environment variables**: add every setting from step 2.
5. Deploy. On the first start the log shows:
   ```
   [Setup] Database updated: 0000_supabase_initial, 0001_supabase_hardening
   [Setup] Owner login created for owner@example.com.
   Server listening on port ...
   ```
6. Connect the domain and make sure HTTPS is on.
7. Open the address, sign in with the owner email and temporary password, then **Change password**
   (bottom of the menu). Remove `FIRST_OWNER_PASSWORD` from the environment variables and redeploy.

Other hosts: run `pnpm install`, `pnpm build`, then `node dist/index.js` with the same settings.
A `Dockerfile` is included for a VPS.

## 4. Check everything

On your PC, in a copy of the repository with a `.env` file holding the same settings (or on the
server: `node dist/fitcrush.js check`):

```bash
pnpm fitcrush check
```

Before the machine is connected it should end with only warnings, no `FAIL` lines:

```
Database
  OK    Connected in 120 ms: PostgreSQL 17, database "postgres"
  OK    Tables are up to date
  OK    Row level security is on for every table
  OK    Owner is set (gym name: Fit Crush)
Fingerprint machine
  WARN  No machine has connected yet ...
  WARN  Blocking is OFF (monitor mode) ...
Website
  OK    https://app.example.in is online
```

If the app is not deployed yet, `pnpm fitcrush setup` creates the tables and the owner login from
your PC instead (it asks for the owner's email, name and password).

## 5. Fill in the software (gym owner, before blocking)

1. **Settings**: gym name, address, phone, receipt details.
2. **Plans & renewals**: Fit Crush's real plans and prices.
3. **Members**: every current member with their **real plan end date** and payments. Blocking uses
   these dates, so a member without a plan here would be blocked.
4. **Team & access → Add staff**: email, role and a password for each receptionist and trainer.
   Tell them the password in person; they can change it after signing in.

## 6. Hand over to Gowda

Send Gowda:
- [GOWDA_MACHINE_SETUP.md](GOWDA_MACHINE_SETUP.md) (or its PDF),
- the web address from step 3,
- a receptionist or owner login for the test (or be on the phone with the owner).

When the machine shows **Waiting for approval** on **Fingerprint machine**, the owner checks the
serial number and presses **Approve machine**.

## 7. Switch on blocking

Only after Gowda's tests pass and every member's plan is entered: **Fingerprint machine → Access &
alert settings → Block expired members on the machine → Save**. The page lists exactly who will be
blocked before it saves. Run `pnpm fitcrush check` afterwards: it should say `Blocking is ON`.

## Day to day

- **Forgotten staff password:** owner → Team & access → **Reset password**.
- **Forgotten owner password:** `pnpm fitcrush password owner@example.com --owner` (from a PC with
  the `.env` settings). It signs the owner out of other devices.
- **Updates:** merge to `main` and redeploy. With `AUTO_MIGRATE=true` the app updates its own tables
  on start (additions only, nothing is deleted).
- **Backups:** Supabase Pro keeps daily backups. Once a month also export **Reports & expenses →
  CSV** and keep it with the gym's records.

## If something goes wrong

| Message | Fix |
|---|---|
| `DATABASE_URL still has the [YOUR-PASSWORD] placeholder` | Put the real password in, without brackets |
| `password authentication failed` | Wrong password, or the user is not `postgres.<project-ref>` (copy the Session pooler URI again) |
| `Tenant or user not found` | The pooler address is for another region or project; copy it again from Connect |
| `connect ENETUNREACH` or a long IPv6 address in the error | You used the Direct connection; use the Session pooler |
| `self-signed certificate in certificate chain` | Remove `sslmode=` from the address and `DATABASE_SSL_CA`, or give the correct Supabase certificate |
| The sign-in page says "Sign in with Manus" | `AUTH_MODE=local` is missing |
| Everyone is signed out after a restart | `JWT_SECRET` changed; keep it fixed |
| `Fix these settings first` and the app stops | The log lists exactly which setting to fix |
| Project paused (Free plan) | Restore it in the Supabase dashboard, or move to Pro |

## Existing data on Manus

If the gym has already entered real members in the old Manus version, that data is in Manus's
own database and does **not** move to Supabase by itself. Copy it across before go-live, or enter
the members again in step 5.
