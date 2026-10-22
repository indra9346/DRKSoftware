# Swan Gym Management — delivery outcomes

Progress reflects implemented evidence in the repository. `[x]` means the requested behavior is implemented in the app; `[~]` means the code is present but depends on unresolved policy, view limits, provider configuration or UAT; `[ ]` means an external handover responsibility remains open.

## [~] 1. Authentication, roles and account status

- FR-01: “Secure login/logout, password reset by admin, role-based access, active/inactive staff accounts.”
- Admin creates staff accounts and assigns role permissions.
- Owner/Admin: “Full settings, member, plans, staff, financial reports and exports.” Receptionist: “Register members, renew plans, check-in, record payments, issue receipts; no owner-only reports.” Trainer: “View assigned members, assign workouts and record progress; no financial reports.” Member: “View own plan validity, attendance, receipts, assigned workouts and progress.”
- Acceptance criterion: “Admin, receptionist, trainer and member can log in and access only permitted information.”
- **Implementation status:** Manus OAuth, app sessions, allow-listed roles, deactivation checks and server-side access controls are implemented. Admin reset of a gym password is not an in-app feature because no gym password is stored; provider-managed identity recovery must be accepted or another explicitly approved provider/workflow selected. Real multi-role sign-in/UAT remains outstanding.

## [~] 2. Member directory and registration

- FR-03: “Create/edit member with ID, photo optional, name, mobile, DOB optional, emergency contact, joining date, fitness goal, status and history; search/filter.”
- Registration workflow: “Receptionist enters member → selects plan → records payment/dues → system generates member ID and receipt → member appears as active.”
- Duplicate phone numbers trigger review; they do not automatically merge records.
- **Implementation status:** Member forms, profile/history, filters, duplicate-phone review, plan assignment and first-payment workflow are implemented. New member, optional membership, first payment/receipt and audit rows commit in one transaction, so a failed validation does not leave a partial registration. Optional photos use a URL field (not an upload service). Directory results are capped at 2,000 for front desk/admin and 500 per trainer; overflow shows a warning, and expected volume/pagination remain UAT decisions.

## [~] 3. Plans, membership validity, renewals and freezes

- FR-04: “Create monthly/quarterly/half-yearly/yearly/custom plans with price/duration; assign, renew, discount, freeze/reactivate with audit trail and configurable rules.”
- Renewal workflow: “Staff opens member → selects renewal plan/start date → records amount → new validity and receipt saved without losing history.”
- A member may have historic memberships, but only one current active validity window unless an admin override is logged.
- Discounts and membership freezes require authorised roles; freeze extension rules are confirmed with the client.
- Expired/inactive membership triggers a warning at check-in; any admin override is logged.
- **Implementation status:** Plan CRUD, renewal, sequential terms, authorized discounts/overlap override, atomic freeze/reactivation and audit history are implemented. A frozen member cannot check in or bypass freeze by profile edit/plan assignment. Exact discount authority/limits, freeze extension and validity/override policy require client sign-off.

## [~] 4. Attendance and check-in

- FR-05: “Unique member QR code; staff scan or manual lookup; timestamped check-in, duplicate check-in prevention, daily history and inactive member list.”
- Check-in workflow: “Staff scans QR or searches member → system checks membership validity → records visit or displays expired/inactive warning.”
- Acceptance criterion: “QR and manual check-in record one valid visit and show expired-member warning.”
- Duplicate check-ins are prevented. Lost QR can be regenerated.
- **Implementation status:** QR member codes, optional browser-camera scanning, manual lookup, IST timestamps, one-check-in-per-member-per-day protection, membership validation, logged admin override and check-in history are implemented. Camera availability depends on browser permission/support. Attendance views cap at 2,000 rows; role-specific UAT and hardware choice remain open.

## [~] 5. Payments, dues, receipts and correction audit

- FR-06: “Record cash/UPI/bank payments, partial payments, discounts and due balance; sequential receipt number; PDF receipt; payment correction restricted to admin with audit log.”
- Registration can be partially paid and a PDF receipt issued.
- Renewal correctly updates dates and preserves old memberships/payment history.
- No silent deletion of a payment record; corrections use reversal/adjustment with a reason.
- Payments are manual; the base scope has no online payment gateway.
- **Implementation status:** Cash/UPI/bank payments, partial dues, monthly sequential receipts, transactional amount checks, print/save-as-PDF receipts and reasoned admin-only reversals are implemented. Due labels in the payment picker use complete posted-payment aggregates for each front-desk-visible membership rather than the capped payment-history array. Reversed receipts are excluded from member receipt retrieval and collection totals. Live transaction/receipt UAT remains outstanding; view limits are documented above.

## [x] 6. Trainer, workout and progress tracking

- FR-07: “Trainer profiles, assign trainer to member, simple workout schedule and diet notes, weight/BMI and progress entries; avoid medical advice claims.”
- Trainer access is limited to assigned members; trainers have no financial reports.
- Members can see their assigned workouts and own progress only.
- **Implementation status:** Trainer assignment, role-scoped member/training APIs, workout/diet notes, weight history and a clearly non-medical BMI reference are implemented. Trainers have no check-in, payments, pricing or receipt access.

## [~] 7. Expenses, owner reports and exports

- FR-08: “Expense category/date/amount/notes; collection, dues, membership, attendance and expense reports with date filters and CSV/Excel/PDF export.”
- Owner dashboard/reporting includes today/month collection, pending dues and expense/revenue summary.
- Acceptance criterion: “Owner reports match recorded transactions and can export correctly.”
- Month-end workflow: “Owner filters collections, dues, attendance and expenses → exports reports.”
- **Implementation status:** Admin-only date-filtered reports, expense entry, CSV export and print-to-PDF are implemented. Dashboard headline counts and revenue/dues/expense aggregates are computed across the database, independent of capped visible lists. Exports are complete only within stated bounds (5,000 rows per report section; 20,000 current-dues snapshot); overflow is flagged and exports disabled. Reconciliation UAT remains outstanding.

## [~] 8. Member portal and privacy boundary

- FR-09: “Own profile, membership dates, attendance, receipt downloads, assigned workout and progress history.”
- Acceptance criterion: “Member portal shows only that member’s own information.”
- “CSV export and handover documentation; data privacy notice and access controls for personal/fitness information.”
- **Implementation status:** Member queries and receipt downloads are server-scoped to the linked member; only posted receipts are retrievable. Provider login, consent/retention notice and full-volume history beyond documented caps require review/sign-off.

## [~] 9. Retention alerts and follow-up

- FR-10: “Dashboard lists memberships expiring within configurable days and members with no visits for configurable days; manual follow-up status.”
- Retention workflow: “Admin sees expiring/inactive lists → staff marks contacted / follow-up notes.”
- Acceptance criterion: “Expiry/inactivity flags appear under agreed thresholds; member can view only own information.”
- **Implementation status:** Editable expiry/no-visit windows, server-derived retention results based on complete membership/attendance history, and manual follow-up status/notes are implemented. Retention lists cap at 500 rows and overflow is visibly flagged as incomplete; expected scale/UAT and threshold approval remain open.

## [~] 10. Gym settings and configurable defaults

- FR-11: “Gym name/logo/address/contact, business details for receipts, plan defaults, expiry thresholds and staff permissions.”
- Open client sign-off decisions: gym name, logo, address and invoice/tax details; exact membership types, expiry calculation, freeze rules and discount authority; expected member/staff count; whether member login uses password or OTP (OTP fees excluded); QR scan device and whether check-out is needed; diet/workout templates and trainer assignment rules; hosting payer, source-code ownership, maintenance terms and launch date.
- **Implementation status:** Gym identity, receipt details, plan defaults, alert thresholds, staff roles and permissions are configurable in the app; confirm exact content and operational defaults with the client before launch. Password reset, login mode, freeze/discount policy and hosting decisions remain sign-off items.

## [x] 11. Data integrity, business rules and operational workflows

- Preserve distinct records for Member (ID, contact, join date, status, emergency contact); Membership (member, plan, start/end dates, freeze history, status); Plan (name, duration, price, active flag); Payment/Receipt (number, member, membership, amount, mode, timestamp, recorded by); Attendance (member, check-in timestamp, method, staff); Staff/Trainer (user ID, role, active flag, assignments); Workout/Progress (member, trainer, date, exercises/notes, weight); Expense (date, category, amount, description, entered by); Follow-up (member, trigger, status, notes, assignee).
- Use India Standard Time and INR; receipt tax fields are configurable based on client tax status.
- Duplicate phone numbers trigger review, not automatic merge; QR code can be regenerated.
- **Implementation status:** The entities and required workflows are persisted in the Drizzle/MySQL schema. Receipt counters, payments/reversals, membership assignment/freeze/reactivation and audits use transactions; linked member accounts are unique; relationship checks are server-side; no development test member/payment records were created.

## [ ] 12. Responsive, security and handover requirements

- Responsive on modern desktop and mobile browsers, with clear navigation and readable forms.
- HTTPS, hashed passwords, server-side role checks, input validation and least-privilege access. No sensitive member information is stored in application logs.
- Daily database backup and documented restore procedure are production handover responsibilities; no sensitive member data in application logs.
- Target common screens to load within 3 seconds on normal broadband for agreed expected usage; confirm user/member volumes.
- CSV export and handover documentation; data privacy notice and access controls for personal/fitness information.
- Client tests agreed UAT scenarios and signs completion; critical defects fixed before handover.
- Explicit exclusions: biometric device/turnstile integration; native Android/iOS apps; multiple branches; automatic WhatsApp/SMS sends and third-party message fees; payment gateway and transaction fees; AI workout coach, advanced diet prescriptions; ecommerce, inventory and digital marketing; hardware, domain, hosting, email, payment gateway and ongoing third-party subscriptions unless separately itemised.
- **Handover status:** Daily backups/restore are not configured by this app, common-screen latency is not benchmarked, and client UAT/privacy/retention approvals are not complete. These must be assigned and signed off before production use.

## [~] 13. Member self-service attendance and live occupancy
- “When entered the gym he can login and click on signin” — an authenticated member can check in for themself from the member portal when arriving at the gym, and the visit is recorded against their own linked profile after membership validation.
- “after when leaving singour” — the member can check out from the same portal; the visit stays marked as currently in the gym until checkout.
- “that should show the live members in the gym now” — the member portal shows the current live in-gym occupancy and refreshes while open. To protect member privacy, this is an aggregate count and does not expose other members’ names/identities.
- Preserve the existing one check-in per member per IST day rule and keep staff attendance workflows intact; authorized staff can also close an open visit from daily attendance history.
- **Implementation status:** Member-scoped check-in/check-out, aggregate live count, periodic portal polling and staff checkout controls are implemented. Additive migration 0005 is applied and verified in the managed database; live member-account UAT remains pending.

## [~] 14. Member plan details, expiry notice and portal renewal
- “in the member portal should have his membership plan and details like plan starts and end dates and days left in the plan” — show plan name, start date, end date and days remaining (or expired status) for the linked member’s own membership.
- “ending date before 5 days notifications should be sent to his portal like membership expiring soon do renewal” — show an in-portal expiry notice reading “Membership expiring soon — renew now” when the membership has five or fewer days remaining, including the expiry day.
- “from there eonly he can take the membership like that options” — allow the member to choose an active plan and submit a renewal request from their portal; an authorized staff member processes the request and records any agreed manual payment or due through the existing workflow. Do not activate/claim payment online: this application has no payment gateway, and submitting the request alone does not create a paid renewal.
- If a pending request's selected plan becomes inactive, authorized front-desk staff can close the request; the server permits this only when the requested plan is no longer active and records an audit entry. The member portal shows that the request was closed and allows the member to select another active plan and submit a new request.
- **Implementation status:** Member plan detail/day-count, in-portal expiry alert, one-pending-request enforcement, staff request queue, audited inactive-plan closure and portal re-request flow, and transactional fulfillment through the existing membership workflow are implemented. Additive migration 0005 is applied and verified in the managed database; real member/staff UAT remains pending.
