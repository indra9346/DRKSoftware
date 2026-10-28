# Fingerprint machine (eSSL) and WhatsApp alerts

> **On-site set-up for Gowda** (machine, door lock, network, tests): [GOWDA_MACHINE_SETUP.md](GOWDA_MACHINE_SETUP.md).
> **Database and hosting** (Supabase, settings, go-live): [SETUP.md](SETUP.md). This page is the full reference.

DRK Fitness Gym's entrance machine is an eSSL fingerprint terminal (ZKTeco-made). It now works with this
app over eSSL's **ADMS / "Cloud Server"** connection (ZKTeco *Attendance PUSH protocol 2.4.1*).

- **A thumb punch becomes the normal check-in** (method "Fingerprint") within 1–2 seconds. Every
  punch, allowed or not, also shows on the reception **gate screen** (`/gate`).
- **Same rule as the desk.** The door opens only if the member's profile is active and an active
  membership covers today, exactly like *Check-in*.
- **Expired members are blocked at the machine.** They are shown "ACCESS BLOCKED – renew & pay"
  on the gate screen and get a WhatsApp alert.
- **Changes reach the machine within seconds.** Renewals, payments, freezes and status changes
  made anywhere in the app are sent on the machine's next poll (it checks about every 10
  seconds). So a member who renews at the desk can enter straight away.
- **WhatsApp alerts** are prepared for every member:
  - expiry reminders (7/3/1 days), last day, access blocked, blocked at the door
  - welcome, renewal, payment receipt
  - dues, we-miss-you, birthday, win-back

  They are listed on **WhatsApp alerts**, and staff tap **Send** (WhatsApp opens with the text
  ready). Automatic sending is optional; see the end of this page.

Nothing is installed on the machine, and no eSSL PC software is needed.

## 1. Check the machine (on site)

1. Press **M/OK → System Info → Device Info** and note the model, firmware and serial number.
2. Press **M/OK → Comm.** and look for **Cloud Server Setting** (older firmware: **ADMS** or
   **Web Server**). If it is missing, ask eSSL for ADMS firmware for this model.
3. In Cloud Server Setting, check whether there is an **HTTPS** option.

## 2. Connect it

The published app runs on HTTPS. The **Fingerprint machine** page shows the exact address and port.

**A. The machine supports HTTPS.** Set Enable Domain Name ON, Server Address = the app's domain,
Server Port = 443, HTTPS ON. Save and restart the machine.

**B. No HTTPS (most eSSL units).** Run the small bridge in `bridge/` on the front-desk PC. It
relays the machine's plain-HTTP traffic to the app over HTTPS.

1. Install Node.js 20 LTS on the PC and copy the `bridge` folder (e.g. to `C:\gym-bridge`).
2. Edit `start-bridge.cmd` and set `GYM_SOFTWARE_URL` to the app's address. Double-click it; it prints
   the PC's address, e.g. `192.168.1.20`.
3. Allow the port through Windows Firewall (run once as administrator):
   ```bat
   netsh advfirewall firewall add rule name="DRK Fitness Gym bridge" dir=in action=allow protocol=TCP localport=8081
   ```
4. Give the PC a fixed address on the router (DHCP reservation).
5. Start the bridge with Windows: press Win+R, type `shell:startup`, and put a shortcut to
   `start-bridge.cmd` there.
6. On the machine: Server Address = the PC's address, Server Port = **8081**, HTTPS OFF. Save and
   restart the machine.

### Approve the machine

The machine appears on **Fingerprint machine** as *Waiting for approval*.

1. Check that the serial number matches, then press **Approve machine**. It uploads every user,
   fingerprint and past punch it holds; the app keeps a backup of the fingerprints.
2. Member records go out two minutes later. They use the cards, keypad passwords and admin rights
   the machine just reported, so nothing on the machine is wiped.

## 3. Link the members

The machine knows people by a number (its *User ID*); the app uses member codes like
`DRK-AB12CD34`. Link them once:

- **People already on the machine.** On **Fingerprint machine → Users on machine**, pick the member
  for each User ID. Matching names are pre-selected. Leave trainers, the owner and old users
  unlinked: **the app never changes unlinked users.**
- **New members.** Open **Members** → the fingerprint button on the member's row → **Link to
  machine** (a free User ID is suggested), then **Enrol finger**. The machine asks the member to
  place the finger 3 times. You can also enrol on the machine itself under the same User ID.

Machine admins (anyone with admin rights on the machine) are never blocked, so the owner can always
open the machine's menu.

## 4. Test, then switch on blocking

Until **Block expired members on the machine** is ticked (Fingerprint machine → Access & alert
settings), the app runs in *monitor mode*. It records punches and shows red on the gate screen, but
nobody is blocked by membership. Test on one person first:

1. Link a test member and enrol a finger. Punch: the visit appears under Check-in as
   "Fingerprint", and green on `/gate`.
2. Open the member's fingerprint panel and choose **Always block**. This works even in monitor
   mode. Within about 10 seconds the machine stops accepting that finger.
3. Choose **Follow membership**. The fingerprint is restored from the backup, and the finger works
   again without enrolling.
4. Check the machine's clock shows India time. If it is off by hours, set the `ADMS_TIMEZONE`
   environment variable (default `330` = +5:30 in minutes).

Then tick **Block expired members on the machine**. Before you save, the page lists exactly who will
be blocked.

### How a blocked member is stopped

| Setting | What happens on the machine |
|---|---|
| **Remove fingerprints** (default) | The user stays; fingerprints, card and keypad password come off. All are restored on renewal. Works on every ADMS machine. |
| Remove the member | The user is deleted from the machine; restored with fingerprints on renewal. |
| Blocked access group | The user moves to an access group with no allowed time and keeps their fingerprints. Only if the firmware enforces groups: set the group up on the machine and test first. |

**Safety rules**

- Before removing fingerprints, the app asks the machine for a backup and waits 90 seconds.
- **Gate screen → Open door** sends the machine's unlock command (if the model supports it).
- **Check-in** at the desk still works for any member.

Put a small sign by the machine: *"Finger not accepted? Your membership may have expired. Please
renew at the front desk."*

## Settings on the machine page

- **Repeat punches.** A punch within *N* minutes of the last one is the same visit (default 5).
- **Check-out on punch.** Off by default: an entrance machine is used on the way in. Set minutes
  if members also punch when leaving.
- **Days-left messages on the machine screen.** "Hi Kabir, 2 days left. Please renew". This needs
  firmware with personal messages; switch it off if yours does not show them.
- **WhatsApp alerts.** Reminder days, dues days, absence days, win-back days, an on/off switch and
  editable text for every alert.

## Automatic WhatsApp (optional)

Set `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` (Meta WhatsApp Business Cloud API), plus an
approved template `gym_alert` whose body is `Hello from DRK Fitness Gym. {{1}}`. Pending alerts
are then sent by the daily job instead of by staff. Meta charges per message.
`WHATSAPP_TEMPLATE` and `WHATSAPP_TEMPLATE_LANG` override the template name and language.

## Daily job

The machine's first poll after midnight (India time) does three things:

1. Re-checks every linked member and sends the changes to the machine.
2. Creates the day's alerts.
3. Clears old logs.

**WhatsApp alerts → Run today's checks** does the same at any time.

## Practise without the machine

`scripts/essl-simulator.mjs` behaves like the machine:

```bash
node scripts/essl-simulator.mjs --server https://<app-domain> --sn TEST-SIM --enroll "9001=Test User" --punch 9001 --polls 3
node scripts/essl-simulator.mjs --server http://127.0.0.1:3000 --interactive
```

## For developers

- **Code:**
  - `server/biometric/`: rules, ADMS protocol, engine, `/iclock` route, tRPC `biometric` router.
  - `client/src/components/gym/Biometric.tsx`: the screens.
  - `client/src/pages/Gate.tsx`: the gate screen.
- **Database:** PostgreSQL (`drizzle/0000_supabase_initial.sql`), tables `gym_biometric_*`,
  `gym_device*`, `gym_fingerprint_templates`, `gym_member_*` and `gym_biometric_punches`;
  `gym_attendance.method` includes `biometric`.
- **Tests:** `pnpm test` runs the rule tests. The end-to-end machine test (a simulated machine over
  HTTP against PostgreSQL) runs with
  `BIOMETRIC_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/<name>_test pnpm test`. It drops
  everything in that `_test` database first.

## Troubleshooting

**Fingerprint machine → Connection log** shows every request from the machine and the app's reply.

| Symptom | Check |
|---|---|
| Machine never appears | Address/port; Enable Domain Name ON; bridge window running; PC firewall rule |
| "Waiting for approval" | Approve it (admin) |
| Updates stay "waiting" | Machine offline or restarted; it re-sends automatically up to 3 times, then "Retry failed" |
| "Not supported by this machine" | That firmware lacks the command (e.g. remote enrolment): enrol on the machine |
| Punch shows "Not linked in the software" | Link that User ID under Users on machine |
