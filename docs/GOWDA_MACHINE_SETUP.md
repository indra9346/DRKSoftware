# Fit Crush: fingerprint machine and door set-up (for Gowda)

**Goal:** a member with a valid, paid membership places a finger → the door unlocks and the visit is
recorded in the Fit Crush software. An expired member's finger is **not accepted** → the door stays
locked, and the reception screen shows **ACCESS BLOCKED – renew & pay**. When they renew at the desk,
their finger works again within about 10 seconds, without enrolling again.

You will get from SWAN: the **software address** (for example `https://app.example.in`) and a login
for the test. Nothing is installed on the machine itself.

## How the door decision works (important)

- The **machine itself** opens the door when it recognises a finger. It does not wait for the
  internet, so the door is fast and keeps working if the internet goes down.
- The software controls **which fingers the machine holds**: when a membership ends, it removes that
  member's fingerprints (and card / keypad password) from the machine. It keeps a backup and puts
  them back automatically on renewal.
- So the machine must stay **connected** to the software. Expiries are applied every night after
  midnight and changes from the desk within about 10 seconds. If the connection is down, the machine
  keeps the last list it had until the connection returns.
- Users who are **admins on the machine** (owner, staff) are never blocked.

## 1. What the gym needs

**Machine:** an eSSL model with both:

- **Cloud Server / ADMS** under M/OK → Comm. (older firmware calls it ADMS or Web Server), and
- **Access control with a lock output**: lock / relay terminals (NO, COM, NC) on the back and an
  **Access Control** menu. An attendance-only model cannot open a door by itself.

**Door hardware** (install as in the eSSL wiring diagram for the model):

- Electromagnetic (EM) lock or drop bolt with its bracket, sized for the door.
- A **separate 12 V access-control power supply with battery backup** for the lock. Do not run the
  lock from the machine's own adapter.
- **Exit button** on the inside, and an **emergency break-glass** release. People must always be
  able to leave, even with no power or a failed lock.
- Door sensor (optional).
- For an EM lock (locked while powered) the relay is normally wired through **COM + NC**. Follow the
  model's diagram and fit the protection diode if the manual asks for one.

**Network:**

- The machine on the gym router by LAN cable (best) or Wi-Fi.
- Most eSSL units cannot use HTTPS. Then a **front-desk PC** runs a small "bridge" program that
  passes the machine's data to the software. That PC must stay **on 24/7** (power settings: never
  sleep), with the PC and router on a **UPS**.

## 2. Check the machine first (send these to SWAN)

1. **M/OK → System Info → Device Info**: model, firmware version, **serial number**.
2. **M/OK → Comm. → Cloud Server Setting** (or ADMS / Web Server): does it exist? Is there an
   **HTTPS** option?
3. Does the machine have an **Access Control** menu and lock terminals?
4. Photos: the Cloud Server screen and the back of the machine (wiring).

## 3. Network settings on the machine

**M/OK → Comm. → Ethernet** (or Wi-Fi):

- Fixed **IP address** (e.g. `192.168.1.201`), subnet `255.255.255.0`,
- **Gateway** = the router (e.g. `192.168.1.1`),
- **DNS** = the router or `8.8.8.8` (needed when the server address is a domain name).

**M/OK → Date/Time**: correct date and India time, 24-hour.

## 4. Connect the machine to the software

### A. The machine has an HTTPS option

**M/OK → Comm. → Cloud Server Setting:**

- Enable Domain Name: **ON**
- Server Address: the software address **without** `https://` (e.g. `app.example.in`)
- Server Port: **443**
- HTTPS: **ON**

Save, then restart the machine.

### B. No HTTPS (most units): bridge on the front-desk PC

1. Install **Node.js 20 LTS** (or newer) from nodejs.org on the front-desk PC.
2. Copy the `bridge` folder from SWAN to `C:\fitcrush-bridge`.
3. Right-click `start-bridge.cmd` → Edit. Set `FITCRUSH_URL=` to the software address
   (e.g. `https://app.example.in`). Save.
4. Double-click `start-bridge.cmd`. The window shows the PC's address, e.g. `192.168.1.20`. Keep it
   open (it restarts itself if it stops).
5. Allow the port in Windows Firewall. Open Command Prompt **as administrator** and run:
   ```
   netsh advfirewall firewall add rule name="Fit Crush bridge" dir=in action=allow protocol=TCP localport=8081
   ```
6. On the router, give the PC a **fixed address** (DHCP reservation).
7. Start the bridge with Windows: Win+R → `shell:startup` → put a shortcut to `start-bridge.cmd` there.
8. On the machine, **M/OK → Comm. → Cloud Server Setting:**
   - Enable Domain Name: **OFF**
   - Server Address: the **PC's address** (e.g. `192.168.1.20`)
   - Server Port: **8081**
   - HTTPS: **OFF**

   Save, then restart the machine.

### Approve the machine

Within a minute the machine appears in the software under **Fingerprint machine** as *Waiting for
approval*. The owner (or SWAN, on the phone) checks that the **serial number matches** and presses
**Approve machine**. The machine then uploads its users and fingerprints; the software keeps a backup.

## 5. Door settings on the machine

**M/OK → Access Control → Access Options** (names differ slightly by model):

- **Lock delay / door open time:** 5 seconds (enough to push the door open).
- Door sensor: as installed (None if there is no sensor).
- Verification mode: fingerprint (card or password too, if the gym uses them).

## 6. Members on the machine

- **Members already on the machine:** the software lists them under **Fingerprint machine → Users
  on machine** and matches them by name; the owner confirms the links. Do **not** delete or
  renumber users on the machine after that.
- **New members:** in the software, **Members → fingerprint button → Link to machine** (it shows
  the **User ID**), then **Enrol finger**, or enrol on the machine under that same User ID.
- The owner and staff should be **admins on the machine**, so they can always open the menu.

## 7. Test before going live (with SWAN or the owner)

The software starts in **monitor mode**: punches are recorded, nobody is blocked yet.

| # | Test | Expected |
|---|---|---|
| 1 | A member with a valid plan places a finger | Door unlocks. Software: visit under **Check-in** as "Fingerprint"; reception screen `/gate` shows the name in green |
| 2 | Owner sets a test member to **Always block** (member's fingerprint button) | Within about 10 s (up to 2 minutes the first time, while the software saves a backup) the machine stops accepting that finger; the door stays locked |
| 3 | Set the same member back to **Follow membership** | The finger works again without enrolling |
| 4 | Unplug the internet (router WAN cable) and punch with a valid member | Door still unlocks. Reconnect: the punch appears in the software |
| 5 | Exit button and break-glass | Door releases every time |
| 6 | Power cut (switch off mains) | Lock behaves as designed for safety; battery backup keeps it running |
| 7 | Check the machine clock | India time. If it is hours off, tell SWAN (the `ADMS_TIMEZONE` setting) |

When all tests pass and every member's plan is entered, the owner switches on **Block expired
members on the machine** (Fingerprint machine → Access & alert settings). From then on, expired
members' fingers stop working automatically.

Put a small sign near the machine: *"Finger not accepted? Your membership may have expired. Please
renew at the front desk."*

## 8. If something does not work

| What you see | Check |
|---|---|
| Machine never appears in the software | Server address and port; HTTPS setting; DNS on the machine; bridge window open; firewall rule; the PC and machine on the same network |
| *Waiting for approval* | The owner must press **Approve machine** |
| Punch shows "Not linked in the software" | Link that User ID under **Users on machine** |
| Valid member's finger not accepted | Is the member's plan entered with the right dates? Is the finger enrolled? |
| Expired member still gets in | Is blocking switched on? Is the machine connected (Fingerprint machine page, last contact)? Is the member an admin on the machine? |
| Door does not unlock for a recognised finger | Lock wiring (NO/NC), lock power supply, lock delay setting |

The software's **Fingerprint machine → Connection log** shows every message from the machine. Send
SWAN a screenshot of it with any question.
