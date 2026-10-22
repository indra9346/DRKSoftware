# Swan Gym Management — implementation plan

## Product scope and architecture

Build a responsive, single-branch gym-operations web application using the initialized React + TypeScript client, Express/tRPC backend, Drizzle ORM and managed MySQL database. Use Manus OAuth as the app identity provider, preserve the starter's `webdev_app_session` cookie and its HTTPS Preview attributes, and enforce all application roles on the server. The SPA is served from the existing Vite/Express setup on port 3000; `/manus-routes.json` declares the single page route.

The authenticated application supports owner/admin, receptionist, trainer and linked-member roles. Owner/admin handles staff, gym settings, plans, discounts, financial reports, exports, payment corrections and audited overrides. Reception works the member directory, registration, plans, payments, receipts, check-ins and retention follow-up. Trainers see assigned members and coaching/progress data only; they do not receive cross-member check-in, billing, receipt or finance procedures. A member account can see only its linked profile, plan, visits, posted receipts, workouts and progress. The bootstrap owner identity is private, claimed once atomically when no explicit owner ID is configured, and protected from staff role reassignment; project visibility must remain restricted for that first login.

The database contains members, plans, memberships and freezes, sequential receipt counters and payment/reversal history, attendance, staff invitations, workouts, progress, expenses, follow-ups, settings and audit logs. Application date logic uses Asia/Kolkata and currency is INR. The existing MySQL migration history remains additive and is applied once with `pnpm db:migrate`.

## Implementation approach and material decisions

- **Registration:** a single server transaction creates the member, optional selected membership, optional first cash/UPI/bank payment, sequential receipt and audit rows. Validation failure rolls the entire operation back. Profile updates are update-only and use a row lock; payment, assignment/renewal, correction, freeze and reactivation paths serialize balance/state changes under parent-row locks.
- **Membership policy:** plan price and duration are snapshotted to the membership so later plan edits do not rewrite history. Renewals preserve older membership/payment rows. Overlapping validity requires an authorized audited override. Freeze/reactivation is a dedicated audited workflow; exact extension/discount/override policy stays configurable or requires client sign-off.
- **Attendance and retention:** manual lookup and optional browser-camera QR scan share the same membership validation. One visit per member per IST day is enforced. Owner dashboards calculate member, membership, registration, visit, collection, dues and expense KPIs from database aggregates rather than capped UI slices. Retention lists are derived server-side from complete membership/attendance history and visibly report when the 500-row list cap is exceeded.
- **Reports and scale:** recent-first lists are bounded and every exceeded cap is disclosed in the UI. Date-filtered report sections cap at 5,000 rows each and the current-dues/membership section at 20,000; any overflow disables CSV/print-PDF export rather than silently exporting partial rows. The client must confirm expected scale; pagination/large-volume optimization is a follow-up if the thresholds are too low.
- **Receipts and exports:** receipts are sequentially numbered, browser-printable and Save-as-PDF ready. Reports export to formula-safe CSV (Excel-compatible) or a print layout. No payment gateway, OTP/SMS provider or external messaging service is added.
- **Authentication trade-off:** no gym-local passwords are stored. Admin password-reset wording is satisfied only if provider-managed Manus account recovery is accepted; otherwise the client must explicitly choose an alternative identity workflow. Member login remains a linked Manus OAuth account, not an OTP flow.
- **Operations:** development and production share the managed database; do not seed fictitious members/payments for acceptance testing. Daily backup/restore, privacy notice, exact client settings, UAT, volume/performance confirmation, hosting/ownership and maintenance are go-live responsibilities, not silently assumed platform features.

## Project structure

| Path | Responsibility |
| --- | --- |
| `client/src/pages/Home.tsx` | Authenticated SPA views and the role-aware member, attendance, billing, training, reports, retention and settings workflows. |
| `client/src/components/gym/` | Navigation shell, accessible modal/forms and optional QR camera scanner. |
| `client/src/gym/format.ts` | IST/INR labels, safe CSV generation and print-ready receipt utilities. |
| `client/src/index.css` | Responsive Swan operational dashboard, forms, tables, receipt and print styles. |
| `client/public/manus-routes.json` | Static manifest for the root SPA route. |
| `server/gymRouter.ts` | Zod-validated role-protected business procedures, reports, transactions, audits and ownership checks. |
| `server/db.ts` | Managed database access, identity bootstrap, IST/date helpers, bounded history queries and transaction-scoped receipt sequence. |
| `server/_core/` | Existing OAuth/session cookies, request context, tRPC roles, Express startup and platform integration. |
| `drizzle/schema.ts`, `drizzle/*.sql`, `drizzle/meta/` | Persisted domain schema and additive migration history, including one linked member login per profile. |
| `shared/gym.ts` | Shared roles and view/navigation constants. |
| `README.md`, `TODO.md` | Operator setup, security/limit caveats, open sign-off decisions and traceable PRD outcomes. |

## Design direction

Three directions considered: **Modern sports editorial**—warm paper, ink and decisive oxblood details (0.08); **Neon performance lab**—dark graphite with electric cyan/lime metrics (0.05); **Neighborhood training club**—forest green, copper and tactile community surfaces (0.07). Selected: **Modern sports editorial**, aligned with Swan's burgundy-and-canvas UI and front-desk legibility.

- **Design Movement:** Swiss editorial typography filtered through the calm authority of a boutique training studio.
- **Core Principles:** prioritize rapid scanning at the desk; make role boundaries legible; pair each consequential action with a clear confirmation; be honest whenever an operational view is capped or incomplete.
- **Color Philosophy:** warm canvas (#f4f2ed) and clean white panels reduce glare, ink (#222128) carries dense data, burgundy (#8f1838) is the ownable action/brand color, and restrained mint/amber distinguish positive and attention states. Avoid promotional gradients and alarm-red overload.
- **Layout Paradigm:** a persistent compact navigation rail and wide operational workspace; asymmetric dashboard panels put check-in and today's status first, with dense tables on focused pages and a deliberate single-column stack on mobile.
- **Signature Elements:** the app's CSS swan/wing symbol beside a restrained `SWAN` wordmark, thin editorial section rules, and small status/receipt chips that keep critical state visible without decorative clutter.
- **Interaction Philosophy:** direct language, predictable save/cancel actions, server-confirmed financial or membership changes, explicit role-appropriate affordances, and visible overflow warnings; no hidden destructive actions.
- **Animation:** use brief 140–180 ms opacity/position transitions for modal and navigation changes, a restrained spinner only while a request is pending, no looping decorative movement, and honor reduced-motion preferences.
- **Typography System:** Manrope is the interface and heading family with a strong weight/size hierarchy; neutral system monospace is reserved for member codes, receipt IDs and timestamps. Keep tables compact but body text readable.
- **Brand Essence:** “A calm, accountable operating desk for independent gyms”—practical, confident, welcoming.
- **Brand Voice:** short and operational, never scolding; headlines explain the next useful action. Examples: “Good operations start at the desk.” and “The next visit starts here.”
- **Wordmark & Logo:** the uploaded custom swan SVG is the Manus project mark; the app navigation uses its own CSS wing mark. Printed receipts show the gym logo configured in Settings, rather than silently substituting the platform icon.
- **Signature Brand Color:** Swan burgundy `#8f1838`.

## Client sign-off decisions that remain open

Confirm gym name/logo/address and receipt/tax content; exact plan catalogue, duration calculation, discount authority and limits, freeze/reactivation and expiry-override rules; expiry/no-visit thresholds; expected member/staff/history volume; member login and provider-managed password recovery; linked member accounts; QR device and whether check-out is needed; workout/diet templates and trainer assignment; privacy notice and retention period; daily backup/restore ownership; hosting, source-code ownership, maintenance and launch date. Do not describe this implementation as production-ready until those decisions, applicable UAT and agreed load expectations are accepted.

### Full payment totals for visible membership due labels

The payment dialog does not infer an outstanding balance from its recent/capped payment-history rows. The server groups posted payments for the currently visible membership IDs, returns those totals only to front-desk roles, and the browser subtracts them from the stored membership price/discount. An additive `gym_payments_membership_idx` supports that scoped aggregate. Reversed payments are excluded, and trainer/member responses receive no payment totals.

## Member self-service attendance, renewal and live occupancy (requested 2026-10-22)

Extend attendance with nullable `checkedOutAt` and an additive migration; server-side member-only mutations check in the authenticated member's linked profile (valid membership required) and check out only that member's currently-open visit. Preserve the unique one-visit-per-member-per-IST-day rule. Expose an aggregate count of current on-floor visits (today's check-ins without checkout) to member portals; do not disclose other members' identities. Poll the count and personal visit state periodically while the portal is open, with a manual refresh/focus refresh as fallback. Authorized front-desk staff can close an open visit from daily history; the staff check-in flow otherwise remains intact.

The member portal shows the current/latest membership name, exact plan start/end dates, and days remaining (or expired state). Show an in-portal "Membership expiring soon — renew now" alert when 0–5 days remain, inclusive. Members can select an active plan and submit a renewal request from this page. Because this application only records manual cash/UPI/bank payments and has no payment gateway, do not imply that submitting a request takes payment or activates a membership; staff review and complete the request through the existing renewal workflow, recording any manual payment or agreed due. Requests are persisted and audit logged; prevent duplicate pending requests and scope both member creation and staff review/actions server-side. If the selected plan later becomes inactive, front desk may close that request only after server-side confirmation that the plan is inactive; record the operator and reason, then show the member a portal status so they can submit a new active-plan request. Refresh the front-desk queue and member portal request state periodically while those pages are open.
