# DRK Fitness Gym Gym Management Software

DRK Fitness Gym's single-branch gym operations web app built on React, Express, tRPC, Drizzle and PostgreSQL (Supabase). It covers members, plans and renewals, attendance, manual receipts, training, expenses, owner reports, retention follow-up and member self-service. The app uses India Standard Time (Asia/Kolkata) and INR.

## Going live (Supabase + Cloudflare)

The self-hosted set-up uses a Supabase PostgreSQL database, the app on Cloudflare (a Worker in front of a Cloudflare Container built from the `Dockerfile`; `wrangler.jsonc`, deployed by `.github/workflows/deploy-cloudflare.yml`) with the domain on Cloudflare, `render.yaml` as an alternative host, and email + password sign-in (`AUTH_MODE=local`). Step by step, including what to buy, every setting and the checks to run: [docs/SETUP.md](docs/SETUP.md). The settings template is [.env.example](.env.example).

```bash
pnpm gym setup    # create/update the tables, create the owner login
pnpm gym check    # read-only report: settings, database, machine, blocking on/off
pnpm gym password <email>   # reset a password (owner: add --owner)
```

On the server the built copy does the same: `node dist/gym.js check`.

With `AUTH_MODE=local` the owner adds staff under **Team & access** with an email and a password; roles, deactivation and the bootstrap-owner protection below work the same way. Passwords are stored as salted scrypt hashes, a login pauses for 15 minutes after 8 wrong passwords, and setting a new password signs that person out of their other devices. Every table has row level security on with no policies, so Supabase's public API keys cannot read gym data; the app's own database connection is unaffected.

## First access and owner security (Manus installs)

On Manus, the app uses Manus OAuth; it does not store gym passwords. Before the first sign-in, keep project visibility set to **owner** (or another restricted setting) and do not publish/open the app publicly. If `OWNER_OPEN_ID` is set in the server environment before any login, only that Manus identity is the initial owner. Otherwise, the first authenticated identity atomically claims the owner/admin role and the open ID is stored in a private settings column. Once claimed, other accounts cannot claim or remove that owner role through the Team page. Sign in as the gym owner first, then invite staff/member accounts.

An admin can allow-list an email and role from Team & Access. The invited person must sign in through Manus OAuth; the app does not send the invitation or a password. A member's account must be linked to their member profile before the member portal can show personal information. Inactive accounts are rejected server-side.

The PRD's “password reset by admin” is **not implemented as an in-app password system**. Authentication and any account recovery are handled by the Manus identity provider. Confirm that this provider workflow is acceptable before launch; otherwise select an explicitly approved identity provider/workflow before changing authentication.

## Roles

- **Owner/Admin:** manage members, plans, discounts, staff and settings; review finance, reports and exports; correct payments with a reason; freeze/reactivate memberships with audit history; perform logged expiry overrides.
- **Receptionist:** create/update member profiles, assign/renew plans, review member-portal renewal requests, record cash/UPI/bank receipts, check in/out members, view retention lists and record follow-ups. Owner-only finance reports/settings are withheld.
- **Trainer:** see assigned members, create workouts and coaching/diet notes, and record weight/progress. Trainer access does not include billing or owner reports.
- **Member:** see only the member profile linked to that login, plan start/end dates and days remaining, own visits and posted receipts, assigned workouts and progress history. Members can check themselves in/out through the portal and see a privacy-safe live occupancy count.

Access rules are enforced in tRPC procedures as well as the interface. Payment corrections are reversals with an audit reason rather than silent deletion. Frozen/inactive member records cannot bypass check-in restrictions with the expiry override.

## Main workflows

1. Register a member (name and mobile required; DOB, emergency contact, email, height, photo URL, goal and trainer are optional), choose an active plan if available, and enter any first payment. The profile, optional membership, first payment/receipt and audit records commit in one database transaction; a validation failure does not leave a partial registration. Duplicate mobile numbers are flagged for review and are never merged automatically.
2. Create monthly, quarterly, half-yearly, yearly or custom plans. Each plan stores its own duration and price; Settings only supplies starting defaults. Renewals preserve previous terms. Members can request an active plan in their portal; staff review pending requests on the Plans page and complete them through the existing manual payment/due workflow. A portal request alone does not charge or activate a plan. If the requested plan becomes inactive, staff can close that pending request and the portal explains that the member can choose an active plan and submit another; this cancellation is audited. If a membership start overlaps a current/future term, only an authorized admin can override, and that decision is audited.
3. Scan the generated `DRK|member-code` (older `FITCRUSH|` and `SWAN|` badges still scan) QR where browser camera/BarcodeDetector support and permission are available, search by member ID/name/full phone, or allow a logged-in member to sign in through their portal. Only one check-in per member per IST calendar day is allowed; the member or authorized staff can sign out/close the open visit. The portal shows aggregate live occupancy (not other members’ identities) and refreshes automatically. Expired/future terms warn; only an admin can use the logged validity override. Inactive and frozen member profiles are blocked.
4. Record manual cash, UPI or bank payments, including partial amounts against a membership. Monthly receipt numbers are sequenced in the database. Open **Print / Save as PDF** from the receipt view; allow pop-ups in the browser if prompted.
5. Use Reports & Expenses to filter collections, expenses, attendance, registrations and memberships by date. Outstanding membership balances are a current snapshot independent of that date range. **CSV / Excel** exports the report rows; **Export PDF** opens a print-ready report.
6. Retention lists use editable expiry/no-visit thresholds. Follow-up status and notes are recorded manually. Member WhatsApp alerts (expiry reminders, access blocked, receipts and more) are prepared on **WhatsApp alerts** and sent by staff with one tap, or automatically if the WhatsApp Business Cloud API is configured; the app does not send SMS or email.
7. Staff can freeze a membership with a required reason. Reactivation asks for a reason and an explicit extension in days so the business freeze rule is not silently assumed; the change is audited.
8. The member portal shows plan name, start/end dates and remaining days. When an active term has five or fewer days left (including the expiry day), it displays “Membership expiring soon — renew now” with a jump to available renewal plans. Each member may have one pending portal renewal request at a time. If staff close a request because its selected plan is inactive, the portal shows a status notice and lets the member submit a new active-plan request.

## Fingerprint machine (eSSL)

The entrance eSSL fingerprint machine connects over ADMS (Cloud Server). A thumb punch records the normal check-in (method "Fingerprint") under the same validity rule as the desk. Expired, frozen and inactive members are blocked at the machine, with a fingerprint backup restored on renewal. A reception screen at `/gate` shows "ACCESS BLOCKED – renew & pay". The app starts in monitor mode until an admin switches blocking on. Set-up, linking existing machine users, testing and troubleshooting: [docs/BIOMETRIC.md](docs/BIOMETRIC.md).

## Operational list and export limits

The app returns bounded recent-first lists rather than paginating every view. Administrators/front desk receive up to 2,000 member profiles; each trainer receives 500 assigned members. Membership history is capped at 10,000 for front desk/admin, 1,000 for trainers and 100 for a member portal. Payment history is capped at 5,000 for administrators and 500 for other permitted users; attendance history is capped at 2,000. Expenses are capped at 5,000, plans at 200, workouts/progress at 2,000 for administrators, 1,000 for trainers and 200 for a member, follow-ups at 2,000, and staff/invitations at 500. Headline dashboard totals (member, membership, registration, visit, collection, dues and expense counts/sums) use full database aggregates rather than these capped arrays. Payment-picker due labels use complete posted-payment sums for the visible membership IDs, not the capped payment-history list. Expiry and no-visit retention candidates are also derived from full history, with each returned retention list capped at 500 and an explicit overflow warning.

When a bootstrap list exceeds its limit, a persistent warning identifies the affected section; treat it as incomplete and do not use it as a complete reconciliation or member-history record. Date-filtered report sections are capped at 5,000 rows each, with a 20,000-row current-dues/membership snapshot. The report warns which section overflowed and disables CSV and print/PDF export rather than silently exporting partial data. There is no pagination past these caps yet. Confirm expected member/staff/history volume before live use; if expected volume can exceed a limit, implement pagination and re-run UAT before go-live.

## Development and migrations

The initialized project uses Node.js with pnpm 10.18.0. Dependencies are in `package.json`/`pnpm-lock.yaml`; application code is in `client/`, `server/`, `shared/` and `drizzle/`.

```bash
pnpm dev       # development server (Preview port 3000)
pnpm check     # TypeScript check
pnpm build     # production frontend and server build (dist/index.js, dist/gym.js)
pnpm db:migrate # apply already-generated, committed migrations
pnpm test      # rule tests; add BIOMETRIC_TEST_DATABASE_URL for the database tests
```

The database is PostgreSQL 14+ (Supabase runs 15/17). For an intentional schema change, review `drizzle/schema.ts` and the generated SQL, then use `pnpm db:push`. Keep migrations additive and commit them with the app; with `AUTO_MIGRATE=true` the server applies them on start. A new table also needs row level security switched on (see `drizzle/0001_supabase_hardening.sql`); `gym check` reports any table without it. `updatedAt` columns are kept current by a database trigger. Never point tests or sample data at the live database: the database tests drop everything in the `_test` database they are given, for example

```bash
BIOMETRIC_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/gym_test pnpm test
```

On Manus, the OAuth cookie is `webdev_app_session` with `SameSite=None; Secure` for HTTPS Preview; with `AUTH_MODE=local` it is a first-party `SameSite=Lax` cookie, `Secure` whenever the site is on HTTPS.

## Privacy, data and handover

Member contact, emergency-contact, date-of-birth, attendance, weight and coaching information should be treated as personal/sensitive operational data. Only collect fields the gym needs, restrict project visibility and staff roles, avoid screenshots/exports in public channels, use HTTPS, and distribute CSV/PDF exports only to authorized personnel. The app does not include an external privacy-consent workflow; the gym must approve and publish its own notice and retention policy before real member onboarding.

Supabase takes daily backups on paid plans (the free plan has none, and pauses a project after a week without activity), but this repository does **not** configure or run backups and does not provide point-in-time recovery. Daily backup ownership, access, retention, and a documented restore drill must be agreed with the hosting/database operator before production. Do not describe the app itself as a backup system. Source-code ownership, hosting payer, monitoring/maintenance, launch date and responsibility for the ongoing service are also client/operator decisions.

## Client sign-off required before go-live

Confirm the gym name, logo and address, contact and receipt/tax details; plan catalogue, duration calculation, discount authority/limits, freeze/reactivation and expiry-override rules; expiry and inactivity thresholds; expected member/staff volume; who can scan and which phone/tablet/camera will be used; workout/diet templates and trainer assignment; who holds the owner login and resets staff passwords; whether each member should receive a linked account; and hosting, backup/restore, ownership, maintenance and launch responsibilities. The sample defaults (7-day expiry alert, 14-day no-visit alert, 30-day monthly plan, India/INR) are editable/configurable where provided; they are not client-approved policy.

## Deliberate scope boundaries

This release is single-branch, browser-based, and uses manual cash/UPI/bank entry. It has no online payment gateway, turnstile integration, native app, SMS (automatic WhatsApp only with the optional Meta Cloud API), advanced AI coaching or diet prescription, inventory/ecommerce, hardware provisioning, or domain/email subscription. The profile photo is an optional HTTPS URL field rather than a photo-upload service. Browser print-to-PDF and CSV are the included export paths; no external spreadsheet or PDF vendor is connected.
