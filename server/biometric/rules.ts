// Fingerprint-machine rules: who the machine lets in, what it shows, and which WhatsApp alerts
// are due. Pure functions (no database) so they are unit-tested and the desk, the machine and
// the gate screen always agree.
//
// The access rule is the same one the desk check-in uses (gymRouter.checkIn): the member's
// profile is active and an ACTIVE membership covers today. The machine adds only the owner's
// explicit "always allow / always block" override.

export type ISODate = string;

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function parts(d: ISODate): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new Error(`Invalid date: ${d}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function todayIST(now: Date = new Date()): ISODate {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  const [y, m, day] = parts(d);
  return new Date(Date.UTC(y, m - 1, day + n)).toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: ISODate, b: ISODate): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS
  );
}

/** "25 Oct 2026" */
export function formatDate(d: ISODate | null | undefined): string {
  if (!d) return "-";
  const [y, m, day] = parts(d);
  return `${day} ${MONTHS[m - 1]} ${y}`;
}

/** The machine stamps punches with its own clock ("2026-10-25 06:09:12"), set to India time. */
export function deviceTimeToDate(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(
    local.trim()
  );
  if (!m) return null;
  const ms =
    Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) -
    IST_OFFSET_MS;
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** Date -> "2026-10-25 06:09:12" in India time (the format the machine understands). */
export function dateToDeviceTime(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

// ---------------------------------------------------------------- access

export interface MemberFacts {
  id: number;
  name: string;
  status: "active" | "inactive" | "frozen";
  override: "allow" | "block" | null;
}

export interface TermFacts {
  id: number;
  planName: string;
  startDate: ISODate;
  endDate: ISODate;
  status: "active" | "expired" | "frozen" | "cancelled";
  /** planPrice - discount */
  fee: number;
  /** posted payments against this membership */
  paid: number;
}

export type AccessReason =
  | "override_allow"
  | "active"
  | "expiring"
  | "ends_today"
  | "override_block"
  | "inactive"
  | "frozen"
  | "not_started"
  | "expired"
  | "no_membership";

export interface AccessState {
  allowed: boolean;
  reason: AccessReason;
  /** Days after today still covered (0 = today is the last day). */
  daysLeft: number | null;
  /** Last day of the unbroken run of active memberships covering today. */
  validUntil: ISODate | null;
  expiredOn: ISODate | null;
  upcomingStart: ISODate | null;
  balanceDue: number;
  duesSince: ISODate | null;
  /** Short line for the gate screen and machine ("12 days left"). */
  headline: string;
}

const covering = (t: TermFacts, day: ISODate) =>
  t.status === "active" && t.startDate <= day && day <= t.endDate;

export function accessState(
  member: MemberFacts,
  terms: TermFacts[],
  today: ISODate,
  expiringWindowDays = 7
): AccessState {
  const live = terms
    .filter(t => t.status !== "cancelled")
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const active = live.filter(t => t.status === "active");
  const current = active.find(t => covering(t, today)) ?? null;
  let validUntil: ISODate | null = null;
  if (current) {
    validUntil = current.endDate;
    for (const t of active)
      if (t.startDate <= addDays(validUntil, 1) && t.endDate > validUntil)
        validUntil = t.endDate;
  }
  const upcoming = active.find(t => t.startDate > today) ?? null;
  const ended = live.filter(
    t => (t.status === "active" || t.status === "expired") && t.endDate < today
  );
  const expiredOn = ended.length
    ? ended.reduce((a, t) => (t.endDate > a ? t.endDate : a), ended[0]!.endDate)
    : null;
  const owing = live.filter(t => t.fee - t.paid > 0);
  const balanceDue = owing.reduce((s, t) => s + (t.fee - t.paid), 0);
  const base = {
    daysLeft: current && validUntil ? daysBetween(today, validUntil) : null,
    validUntil,
    expiredOn: current ? null : expiredOn,
    upcomingStart: upcoming?.startDate ?? null,
    balanceDue,
    duesSince: owing[0]?.startDate ?? null,
  };
  const s = (
    allowed: boolean,
    reason: AccessReason,
    headline: string
  ): AccessState => ({ ...base, allowed, reason, headline });

  if (member.override === "block")
    return s(false, "override_block", "Access blocked by gym");
  if (member.override === "allow")
    return s(true, "override_allow", "Access allowed by owner");
  if (member.status === "inactive")
    return s(false, "inactive", "Inactive member - see front desk");
  if (member.status === "frozen")
    return s(false, "frozen", "Membership frozen");
  if (current && base.daysLeft !== null) {
    if (base.daysLeft === 0)
      return s(true, "ends_today", "Last day today - renew");
    if (base.daysLeft <= expiringWindowDays)
      return s(
        true,
        "expiring",
        `${base.daysLeft} day${base.daysLeft === 1 ? "" : "s"} left - renew soon`
      );
    return s(true, "active", `${base.daysLeft} days left`);
  }
  if (upcoming)
    return s(false, "not_started", `Starts ${formatDate(upcoming.startDate)}`);
  if (expiredOn) return s(false, "expired", "Access blocked - renew & pay");
  return s(false, "no_membership", "No membership - please pay");
}

// ---------------------------------------------------------------- machine

export type BlockMode = "fingers" | "remove" | "group";

export interface MachineSettings {
  /** Off = monitor mode: membership rules never block anyone on the machine. */
  enforce: boolean;
  blockMode: BlockMode;
  blockedGroup: number;
  showMessages: boolean;
  /** Repeat punches within this many minutes are the same visit. */
  duplicateMinutes: number;
  /**
   * A later punch at least this many minutes after check-in checks the member out. 0 (default) =
   * never: an entrance machine is used on the way in, so a second punch is not a departure.
   */
  checkoutAfterMinutes: number;
  pollSeconds: number;
}

export interface DesiredOnDevice {
  present: boolean;
  allowed: boolean;
  blockMode: BlockMode | null;
  message: string | null;
}

/** Plain-ASCII text for the machine screen. */
export function machineMessage(name: string, s: AccessState): string | null {
  const first =
    (name.split(" ")[0] ?? name).replace(/[^\x20-\x7E]/g, "").slice(0, 12) ||
    "Member";
  switch (s.reason) {
    case "expiring":
      return `Hi ${first}, ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left. Please renew`;
    case "ends_today":
      return `Hi ${first}, last day today. Please renew`;
    case "expired":
    case "no_membership":
      return `${first}: ACCESS BLOCKED. Please renew & pay`;
    case "frozen":
      return `${first}: membership frozen`;
    default:
      return null;
  }
}

/** What the machine should hold for a member, given the owner's machine settings. */
export function desiredOnDevice(
  name: string,
  state: AccessState,
  m: MachineSettings
): DesiredOnDevice {
  const message = m.showMessages ? machineMessage(name, state) : null;
  // Monitor mode: membership rules never take access away. The owner's explicit "Always block"
  // still applies (also the safe way to test blocking on one person).
  if (state.allowed || (!m.enforce && state.reason !== "override_block"))
    return { present: true, allowed: true, blockMode: null, message };
  return {
    present: m.blockMode !== "remove",
    allowed: false,
    blockMode: m.blockMode,
    // Without fingerprints on the machine the member cannot be identified, so a message never shows.
    message: m.blockMode === "group" ? message : null,
  };
}

// ---------------------------------------------------------------- alerts

export type AlertKind =
  | "welcome"
  | "renewed"
  | "receipt"
  | "expiry_reminder"
  | "ends_today"
  | "expired"
  | "blocked_attempt"
  | "dues"
  | "absent"
  | "birthday"
  | "winback";

export const ALERT_KINDS: { kind: AlertKind; label: string; when: string }[] = [
  { kind: "welcome", label: "Welcome", when: "A member's first plan" },
  {
    kind: "renewed",
    label: "Renewal confirmed",
    when: "A new plan for an existing member",
  },
  { kind: "receipt", label: "Payment receipt", when: "Every posted payment" },
  {
    kind: "expiry_reminder",
    label: "Expiry reminder",
    when: "Days before the end date (reminder days)",
  },
  {
    kind: "ends_today",
    label: "Ends today",
    when: "Last day of the membership",
  },
  {
    kind: "expired",
    label: "Access blocked",
    when: "The day after the membership ends",
  },
  {
    kind: "blocked_attempt",
    label: "Blocked at the door",
    when: "A blocked member uses the machine (once a day)",
  },
  {
    kind: "dues",
    label: "Dues reminder",
    when: "Balance pending (dues reminder days)",
  },
  {
    kind: "absent",
    label: "We miss you",
    when: "Active member absent for the absent days",
  },
  {
    kind: "birthday",
    label: "Birthday wish",
    when: "On the member's birthday",
  },
  {
    kind: "winback",
    label: "Win-back",
    when: "Days after expiry (win-back days)",
  },
];

export const DEFAULT_TEMPLATES: Record<AlertKind, string> = {
  welcome:
    "Hi {name}, welcome to {gym}! Your {plan} membership runs from {start} to {validUntil}. Use your fingerprint at the entrance. Let's crush your limits! 💪",
  renewed:
    "Hi {name}, your {gym} membership is renewed: {plan}, valid till {validUntil}. See you at the gym! 💪",
  receipt:
    "Hi {name}, we received ₹{amount} by {mode} (receipt {receipt}). {balanceLine}Thank you! - {gym}",
  expiry_reminder:
    "Hi {name}, your {gym} membership ends on {validUntil} ({days} day(s) left). Renew before it ends to keep your fingerprint access active. Pay at the front desk or reply here.",
  ends_today:
    "Hi {name}, today is the last day of your {gym} membership. Renew today so your fingerprint keeps working from tomorrow.",
  expired:
    "Hi {name}, your {gym} membership ended on {expiredOn}, so fingerprint access is now blocked. Please renew and pay at the front desk to start again.",
  blocked_attempt:
    "Hi {name}, you tried to enter {gym} today but access is blocked ({status}). Please renew and pay at the front desk - access opens again as soon as you pay.",
  dues: "Hi {name}, ₹{balance} is pending on your {gym} membership. Please clear it at the front desk. Thank you!",
  absent:
    "Hi {name}, we haven't seen you at {gym} for {absentDays} days. Your membership is active till {validUntil} - come back and crush it! 💪",
  birthday:
    "Happy birthday, {name}! 🎉 Wishing you a strong and healthy year ahead. - Team {gym}",
  winback:
    "Hi {name}, we miss you at {gym}! Your membership ended on {expiredOn}. Renew now and get back on track - reply here to know the current plans.",
};

export interface AlertSettings {
  enabled: Record<AlertKind, boolean>;
  reminderDays: number[];
  duesReminderDays: number[];
  absentDays: number;
  winbackDays: number[];
  templates: Record<AlertKind, string>;
}

export interface BiometricSettings {
  machine: MachineSettings;
  alerts: AlertSettings;
}

export const DEFAULT_BIOMETRIC_SETTINGS: BiometricSettings = {
  machine: {
    enforce: false,
    blockMode: "fingers",
    blockedGroup: 2,
    showMessages: true,
    duplicateMinutes: 5,
    checkoutAfterMinutes: 0,
    pollSeconds: 10,
  },
  alerts: {
    enabled: Object.fromEntries(ALERT_KINDS.map(k => [k.kind, true])) as Record<
      AlertKind,
      boolean
    >,
    reminderDays: [7, 3, 1],
    duesReminderDays: [3, 7, 15],
    absentDays: 7,
    winbackDays: [7, 30],
    templates: DEFAULT_TEMPLATES,
  },
};

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function merge<T>(base: T, over: unknown): T {
  if (!isPlain(base) || !isPlain(over))
    return over === undefined || over === null ? base : (over as T);
  const out: Plain = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (!(k in out) || v === undefined || v === null) continue;
    out[k] = isPlain(out[k]) ? merge(out[k], v) : v;
  }
  return out as T;
}

export function mergeBiometricSettings(stored: unknown): BiometricSettings {
  return merge(DEFAULT_BIOMETRIC_SETTINGS, stored);
}

export type TemplateVars = Record<string, string | number | null | undefined>;

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template
    .replace(/\{(\w+)\}/g, (_w, key: string) => {
      const v = vars[key];
      return v === undefined || v === null ? "" : String(v);
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Indian mobile -> "91XXXXXXXXXX" for WhatsApp, or null. */
export function waNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  if (d.length === 10 && /^[6-9]/.test(d)) return `91${d}`;
  if (d.length === 12 && d.startsWith("91")) return d;
  if (d.length === 11 && d.startsWith("0")) return `91${d.slice(1)}`;
  return null;
}

export interface AlertDraft {
  kind: AlertKind;
  dedupeKey: string;
  vars: TemplateVars;
}

function bucketDown(value: number, thresholds: number[]): number | null {
  return [...thresholds].sort((a, b) => a - b).find(t => value <= t) ?? null;
}

/** Largest threshold passed recently (3-day catch-up window). */
function bucketUp(
  value: number,
  thresholds: number[],
  window = 3
): number | null {
  const t = [...thresholds].sort((a, b) => b - a).find(x => value >= x);
  return t !== undefined && value < t + window ? t : null;
}

/**
 * Time-based alerts due today for one member. Each has a dedupe key, so running this many times
 * (or missing a day) never sends a stage twice; long-expired members are never messaged on import.
 */
export function dailyAlerts(
  input: {
    state: AccessState;
    dob: ISODate | null;
    lastVisit: ISODate | null;
    currentStart: ISODate | null;
  },
  today: ISODate,
  a: AlertSettings
): AlertDraft[] {
  const { state } = input;
  const out: AlertDraft[] = [];
  if (state.reason === "inactive" || state.reason === "override_allow")
    return out;

  if (state.allowed && state.validUntil && state.daysLeft !== null) {
    if (state.daysLeft === 0) {
      if (a.enabled.ends_today)
        out.push({
          kind: "ends_today",
          dedupeKey: `ends:${state.validUntil}`,
          vars: {},
        });
    } else {
      const r = bucketDown(state.daysLeft, a.reminderDays);
      if (r !== null && a.enabled.expiry_reminder)
        out.push({
          kind: "expiry_reminder",
          dedupeKey: `expiry:${state.validUntil}:${r}`,
          vars: { days: state.daysLeft },
        });
    }
  }
  if (state.reason === "expired" && state.expiredOn) {
    const since = daysBetween(state.expiredOn, today);
    if (since >= 1 && since <= 3 && a.enabled.expired)
      out.push({
        kind: "expired",
        dedupeKey: `expired:${state.expiredOn}`,
        vars: {},
      });
    const w = bucketUp(since, a.winbackDays);
    if (w !== null && a.enabled.winback)
      out.push({
        kind: "winback",
        dedupeKey: `winback:${state.expiredOn}:${w}`,
        vars: {},
      });
  }
  if (state.balanceDue > 0 && state.duesSince && a.enabled.dues) {
    const d = bucketUp(daysBetween(state.duesSince, today), a.duesReminderDays);
    if (d !== null)
      out.push({
        kind: "dues",
        dedupeKey: `dues:${state.duesSince}:${d}`,
        vars: { balance: state.balanceDue },
      });
  }
  const seen = input.lastVisit ?? input.currentStart;
  if (state.allowed && seen && a.enabled.absent && a.absentDays > 0) {
    const away = daysBetween(seen, today);
    if (away >= a.absentDays && away < a.absentDays + 3)
      out.push({
        kind: "absent",
        dedupeKey: `absent:${seen}`,
        vars: { absentDays: away },
      });
  }
  if (
    input.dob &&
    input.dob.slice(5) === today.slice(5) &&
    state.allowed &&
    a.enabled.birthday
  )
    out.push({
      kind: "birthday",
      dedupeKey: `birthday:${today.slice(0, 4)}`,
      vars: {},
    });
  return out;
}
