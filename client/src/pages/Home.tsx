import { startLogin } from "@/const";
import { GymShell, type GymView } from "@/components/gym/GymShell";
import { Field, Modal } from "@/components/gym/Modal";
import { Field as FormField } from "@/components/gym/Modal";
import { QrScanner } from "@/components/gym/QrScanner";
import { AlertsView, FingerprintModal, MachineView } from "@/components/gym/Biometric";
import {
  csvExport,
  daysBetween,
  inr,
  prettyDate,
  printReceipt,
  todayLocal,
} from "@/gym/format";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "../../../server/routers";
import type { inferRouterOutputs } from "@trpc/server";
import { isAdminRole, roleLabels, type GymRole } from "@shared/gym";
import { QRCodeSVG } from "qrcode.react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Download,
  Dumbbell,
  FileText,
  Filter,
  Fingerprint,
  Flame,
  HeartPulse,
  LoaderCircle,
  LogIn,
  LogOut,
  MoreHorizontal,
  Plus,
  Printer,
  QrCode,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const dateNow = todayLocal();
type Boot = inferRouterOutputs<AppRouter>["gym"]["bootstrap"];
type Member = Boot["members"][number];
type PaymentRow = Boot["payments"][number];
type ModalState =
  | "member"
  | "plan"
  | "renew"
  | "payment"
  | "receipt"
  | "expense"
  | "workout"
  | "progress"
  | "invite"
  | "qr"
  | "freeze"
  | "reactivate"
  | "fingerprint"
  | null;

const currency = (amount: number) => inr(amount);
const planPeriodLabels: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Half-yearly",
  yearly: "Yearly",
  custom: "Custom",
};
type PlanPeriod = "monthly" | "quarterly" | "half_yearly" | "yearly" | "custom";
const parsePlanDefaults = (raw?: string | null) => {
  try {
    const value = JSON.parse(raw || "{}") as {
      period?: string;
      durationDays?: number;
    };
    return {
      period: (value.period && value.period in planPeriodLabels
        ? value.period
        : "monthly") as PlanPeriod,
      durationDays:
        Number.isInteger(value.durationDays) && value.durationDays! > 0
          ? value.durationDays!
          : 30,
    };
  } catch {
    return { period: "monthly" as PlanPeriod, durationDays: 30 };
  }
};
const paymentModes: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  bank: "Bank transfer",
};

function HeaderTitle({
  kicker,
  title,
  description,
  actions,
}: {
  kicker: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{kicker}</p>
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  );
}
function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "green" | "amber" | "red" | "burgundy" | "blue";
}) {
  return (
    <span className={`status-badge badge-${tone}`}>
      <i />
      {children}
    </span>
  );
}
function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <ClipboardListIcon />
      </span>
      <h3>{title}</h3>
      <p>{message}</p>
      {action}
    </div>
  );
}
function ClipboardListIcon() {
  return <FileText size={20} strokeWidth={1.7} />;
}
function StatCard({
  label,
  value,
  note,
  icon: Icon,
  trend,
  tone = "ink",
}: {
  label: string;
  value: string;
  note: string;
  icon: React.ComponentType<{ size?: number }>;
  trend?: string;
  tone?: string;
}) {
  return (
    <article className={`stat-card stat-${tone}`}>
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">
          <Icon size={19} />
        </span>
      </div>
      <strong className="stat-value">{value}</strong>
      <div className="stat-foot">
        <span>{note}</span>
        {trend && <b>{trend}</b>}
      </div>
    </article>
  );
}
function SectionHeading({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {detail && <p>{detail}</p>}
      </div>
      {action}
    </div>
  );
}
function EmptyRows({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="empty-row">
        {text}
      </td>
    </tr>
  );
}

export default function Home() {
  const utils = trpc.useUtils();
  const auth = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const user = auth.data;
  const role = (user?.role ?? "user") as GymRole;
  const hasRole = Boolean(user && user.active && role !== "user");
  const isAdmin = isAdminRole(role);
  const isFrontDesk =
    role === "owner" || role === "admin" || role === "receptionist";
  const [view, setView] = useState<GymView>(
    role === "member" ? "portal" : "dashboard"
  );
  useEffect(() => {
    if (role === "member" && view !== "portal") setView("portal");
  }, [role, view]);
  const dataQuery = trpc.gym.bootstrap.useQuery(undefined, {
    enabled: hasRole,
    refetchOnWindowFocus: true,
    refetchInterval: () =>
      (isFrontDesk && view === "plans") ||
      (role === "member" && view === "portal")
        ? 30_000
        : false,
    retry: false,
  });
  const data = dataQuery.data as Boot | undefined;
  const liveStatusQuery = trpc.gym.liveStatus.useQuery(undefined, {
    enabled:
      hasRole &&
      ((role === "member" && view === "portal") ||
        (isFrontDesk && view === "attendance")),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const [modal, setModal] = useState<ModalState>(null);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<
    Boot["plans"][number] | null
  >(null);
  const [selectedPayment, setSelectedPayment] = useState<PaymentRow | null>(
    null
  );
  const [selectedRenewalRequestId, setSelectedRenewalRequestId] = useState<
    number | null
  >(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [paymentSearch, setPaymentSearch] = useState("");
  const [attendanceLookup, setAttendanceLookup] = useState("");
  const [attendanceDate, setAttendanceDate] = useState(dateNow);
  const [scanMode, setScanMode] = useState(false);
  const [checkInOverride, setCheckInOverride] = useState(false);
  const [lastCheckin, setLastCheckin] = useState<{
    name: string;
    code: string;
    time: string;
  } | null>(null);
  const [reportFrom, setReportFrom] = useState(`${dateNow.slice(0, 7)}-01`);
  const [reportTo, setReportTo] = useState(dateNow);
  const [followText, setFollowText] = useState<Record<string, string>>({});
  const [followStatus, setFollowStatus] = useState<
    Record<string, "pending" | "contacted" | "follow_up">
  >({});
  const [logoutBusy, setLogoutBusy] = useState(false);
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      setLogoutBusy(false);
      void auth.refetch();
    },
    onError: () => setLogoutBusy(false),
  });
  const reportQuery = trpc.gym.reports.useQuery(
    { from: reportFrom, to: reportTo },
    { enabled: view === "reports" && isAdmin, retry: false }
  );

  const refresh = () => {
    void utils.gym.bootstrap.invalidate();
    void utils.gym.liveStatus.invalidate();
    if (isAdmin && view === "reports") void reportQuery.refetch();
  };
  const notify = (success: string) => ({
    onSuccess: () => {
      toast.success(success);
      refresh();
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });
  const saveMember = trpc.gym.saveMember.useMutation();
  const registerMember = trpc.gym.registerMember.useMutation();
  const savePlan = trpc.gym.savePlan.useMutation();
  const assignMembership = trpc.gym.assignMembership.useMutation();
  const savePayment = trpc.gym.savePayment.useMutation();
  const checkIn = trpc.gym.checkIn.useMutation();
  const checkOut = trpc.gym.checkOut.useMutation();
  const requestRenewal = trpc.gym.requestRenewal.useMutation();
  const closeUnavailableRenewalRequest =
    trpc.gym.closeUnavailableRenewalRequest.useMutation();
  const saveExpense = trpc.gym.saveExpense.useMutation();
  const saveWorkout = trpc.gym.saveWorkout.useMutation();
  const saveProgress = trpc.gym.saveProgress.useMutation();
  const saveSettings = trpc.gym.saveSettings.useMutation();
  const inviteStaff = trpc.gym.inviteStaff.useMutation();
  const updateStaff = trpc.gym.updateStaff.useMutation();
  const updateFollowUp = trpc.gym.updateFollowUp.useMutation();
  const correctPayment = trpc.gym.correctPayment.useMutation();
  const freezeMutation = trpc.gym.freezeMembership.useMutation();
  const reactivateMutation = trpc.gym.reactivateMembership.useMutation();
  const cancelInvite = trpc.gym.cancelInvite.useMutation();

  const members = data?.members ?? [];
  const plans = data?.plans ?? [];
  const memberships = data?.memberships ?? [];
  const attendance = data?.attendance ?? [];
  const payments = data?.payments ?? [];
  const settings = data?.settings;
  const planDefaults = parsePlanDefaults(settings?.planDefaults);
  const today = data?.today ?? dateNow;
  const expiringRows = data?.retention.expiring ?? [];
  const inactiveRows = data?.retention.inactive ?? [];
  const expiringCountLabel = data?.limitsExceeded.includes(
    "expiring memberships"
  )
    ? `${expiringRows.length}+`
    : String(expiringRows.length);
  const inactiveCountLabel = data?.limitsExceeded.includes("inactive members")
    ? `${inactiveRows.length}+`
    : String(inactiveRows.length);
  const liveMembership = (memberId: number) =>
    memberships.find(
      item =>
        item.memberId === memberId &&
        item.status === "active" &&
        item.startDate <= today &&
        item.endDate >= today
    );
  const latestMembership = (memberId: number) =>
    memberships
      .filter(item => item.memberId === memberId)
      .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  const portalMembership = members[0]
    ? (liveMembership(members[0].id) ?? latestMembership(members[0].id))
    : undefined;
  const portalDaysLeft = portalMembership
    ? daysBetween(today, portalMembership.endDate)
    : null;
  const portalExpirySoon = Boolean(
    portalMembership?.status === "active" &&
      portalMembership.startDate <= today &&
      portalDaysLeft !== null &&
      portalDaysLeft >= 0 &&
      portalDaysLeft <= 5
  );
  const renewalRequests = data?.renewalRequests ?? [];
  const latestRenewalRequest = renewalRequests[0];
  const pendingRenewalRequest = renewalRequests.find(
    item => item.request.status === "pending"
  );
  const paymentTotals = useMemo(() => {
    const result = new Map<number, number>();
    for (const row of data?.membershipPaidTotals ?? [])
      if (row.membershipId) result.set(row.membershipId, Number(row.amount));
    return result;
  }, [data?.membershipPaidTotals]);
  const duesFor = (membershipId: number) => {
    const membership = memberships.find(item => item.id === membershipId);
    return membership
      ? Math.max(
          0,
          membership.planPrice -
            membership.discount -
            (paymentTotals.get(membership.id) ?? 0)
        )
      : 0;
  };
  const receiptFor = (payment: PaymentRow) => {
    const receipt = payment.payment;
    printReceipt({
      gymName: settings?.gymName,
      logoUrl: settings?.logoUrl,
      address: settings?.address,
      contactPhone: settings?.contactPhone,
      businessDetails: settings?.businessDetails,
      receiptNumber: receipt.receiptNumber,
      memberName: payment.memberName,
      memberCode: payment.memberCode,
      amount: receipt.amount,
      mode: paymentModes[receipt.mode] ?? receipt.mode,
      recordedAt: receipt.recordedAt,
      notes: receipt.notes,
    });
  };
  const showReceipt = (payment: PaymentRow) => {
    setSelectedPayment(payment);
    setModal("receipt");
  };

  const attendanceToday = attendance.filter(
    row => row.item.checkInDate === today
  );
  const attendanceForDate = attendance.filter(
    row => row.item.checkInDate === attendanceDate
  );
  const lastVisitByMember = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of attendance)
      if (
        !map.has(row.item.memberId) ||
        row.item.checkInDate > map.get(row.item.memberId)!
      )
        map.set(row.item.memberId, row.item.checkInDate);
    return map;
  }, [attendance]);
  const registrationsThisMonth = data?.stats.registrationsThisMonth ?? 0;
  const filteredMembers = members.filter(member =>
    `${member.name} ${member.phone} ${member.memberCode}`
      .toLowerCase()
      .includes(memberSearch.toLowerCase())
  );
  const filteredPayments = payments.filter(row =>
    `${row.memberName} ${row.memberCode} ${row.payment.receiptNumber}`
      .toLowerCase()
      .includes(paymentSearch.toLowerCase())
  );
  const report = reportQuery.data;

  const chooseMember = (member: Member, mode: ModalState = "member") => {
    setSelectedMember(member);
    setModal(mode);
  };
  const doCheckIn = async (
    lookup: string,
    method: "manual" | "qr" = "manual"
  ) => {
    if (!lookup.trim()) return;
    try {
      const result = await checkIn.mutateAsync({
        lookup: lookup.trim(),
        method,
        override: checkInOverride,
      });
      if (result.allowed) {
        setLastCheckin({
          name: result.member.name,
          code: result.member.memberCode,
          time: new Intl.DateTimeFormat("en-IN", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date()),
        });
        setCheckInOverride(false);
        setAttendanceLookup("");
        toast.success(`${result.member.name} checked in`);
        refresh();
      } else toast.warning(result.warning);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not check in"
      );
    }
  };
  const doCheckOut = (attendanceId: number) =>
    checkOut.mutate(
      { attendanceId },
      {
        onSuccess: () => {
          toast.success("Checked out. Your visit is closed.");
          refresh();
        },
        onError: error => toast.error(error.message),
      }
    );

  if (auth.isLoading)
    return (
      <div className="auth-screen">
        <LoaderCircle className="spin" size={32} />
        <p>Opening Fit Crush…</p>
      </div>
    );
  if (!user)
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="brand-symbol login-symbol" aria-hidden="true">
            <Zap size={26} strokeWidth={2.4} />
          </div>
          <p className="eyebrow">GYM MANAGEMENT SOFTWARE</p>
          <h1>
            Good operations
            <br />
            <em>start at the desk.</em>
          </h1>
          <p className="login-copy">
            Memberships, check-ins and daily collections—together in one clear
            view.
          </p>
          <button
            className="button button-primary button-wide"
            onClick={() => startLogin()}
          >
            <LogIn size={17} />
            Sign in with Manus
          </button>
          <p className="login-note">
            Secure account sign-in · Role access is managed by your gym
            administrator.
          </p>
          {window.__MANUS_CONFIG__?.devLogin && (
            <form className="dev-login" method="post" action="/api/dev/login">
              <p className="eyebrow">LOCAL DEV LOGIN · SAMPLE DATA ONLY</p>
              <div className="dev-login-roles">
                <button className="button button-secondary" name="as" value="owner">Owner</button>
                <button className="button button-secondary" name="as" value="frontdesk">Front desk</button>
                <button className="button button-secondary" name="as" value="trainer">Trainer</button>
                <button className="button button-secondary" name="as" value="member">Member</button>
              </div>
            </form>
          )}
        </div>
        <span className="login-side-note">
          FIT CRUSH · GYM MANAGEMENT SOFTWARE
        </span>
      </div>
    );
  if (!user.active)
    return (
      <div className="auth-screen">
        <ShieldCheck size={34} />
        <h1>Account inactive</h1>
        <p>
          Your gym account is paused. Contact the gym owner or administrator to
          restore access.
        </p>
        <button
          className="button button-secondary"
          onClick={() => {
            setLogoutBusy(true);
            logout.mutate();
          }}
          disabled={logoutBusy}
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    );
  if (role === "user")
    return (
      <div className="auth-screen">
        <ShieldCheck size={34} />
        <h1>Access is being set up</h1>
        <p>
          Your sign-in succeeded, but a gym role has not been assigned. Ask the
          owner to add your email under Team &amp; access, then sign in again.
        </p>
        <button
          className="button button-secondary"
          onClick={() => {
            setLogoutBusy(true);
            logout.mutate();
          }}
          disabled={logoutBusy}
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    );
  if (dataQuery.isLoading || !data)
    return (
      <div className="auth-screen">
        <LoaderCircle className="spin" size={32} />
        <p>Loading your gym workspace…</p>
        {dataQuery.error && (
          <p className="error-copy">{dataQuery.error.message}</p>
        )}
      </div>
    );

  const openNewMember = () => {
    setSelectedMember(null);
    setModal("member");
  };
  const openRenew = (member: Member) => {
    setSelectedMember(member);
    setModal("renew");
  };
  const startLogout = () => {
    setLogoutBusy(true);
    logout.mutate();
  };
  const openReceipt = (payment: PaymentRow) => showReceipt(payment);
  const makeReportRows = () => {
    if (!report) return [];
    return [
      ...report.payments
        .filter(row => row.payment.status === "posted")
        .map(row => ({
          recordType: "Collection",
          date: prettyDate(row.payment.recordedAt),
          member: row.memberName,
          memberId: row.memberCode,
          category: "",
          detail: paymentModes[row.payment.mode],
          reference: row.payment.receiptNumber,
          amountInINR: row.payment.amount,
        })),
      ...report.expenses.map(row => ({
        recordType: "Expense",
        date: prettyDate(row.expenseDate),
        member: "",
        memberId: "",
        category: row.category,
        detail: row.description ?? "",
        reference: "",
        amountInINR: -row.amount,
      })),
      ...report.attendance.map(row => ({
        recordType: "Attendance",
        date: prettyDate(row.attendance.checkInDate),
        member: row.memberName,
        memberId: row.memberCode,
        category: "",
        detail: row.attendance.method,
        reference: "",
        amountInINR: 0,
      })),
      ...report.registrations.map(row => ({
        recordType: "Registration",
        date: prettyDate(row.joiningDate),
        member: row.name,
        memberId: row.memberCode,
        category: "",
        detail: row.phone,
        reference: "",
        amountInINR: 0,
      })),
      ...report.memberships.map(row => ({
        recordType: "Membership started",
        date: prettyDate(row.startDate),
        member: row.memberName,
        memberId: row.memberCode,
        category: row.planName,
        detail: `Through ${prettyDate(row.endDate)}`,
        reference: String(row.id),
        amountInINR: row.planPrice - row.discount,
      })),
      ...report.dues.map(row => ({
        recordType: "Current outstanding due",
        date: "Current balance",
        member: row.memberName,
        memberId: row.memberCode,
        category: row.planName,
        detail: `Through ${prettyDate(row.endDate)}`,
        reference: String(row.membershipId),
        amountInINR: row.amountDue,
      })),
    ];
  };

  return (
    <GymShell
      role={role}
      gymName={settings?.gymName ?? "Fit Crush"}
      userName={user.name ?? user.email ?? "Gym staff"}
      active={view}
      onNavigate={setView}
      onLogout={startLogout}
    >
      {data.limitsExceeded.length > 0 && (
        <div className="overflow-warning" role="alert">
          <strong>Some lists may be incomplete.</strong>
          <span>
            View limits were reached for: {data.limitsExceeded.join(", ")}. Do
            not use these capped lists as complete history or reconciliation;
            confirm expected gym volume and expand/paginate them before relying
            on omitted records.
          </span>
        </div>
      )}
      {view === "dashboard" && (
        <>
          <HeaderTitle
            kicker="DAILY OPERATIONS · OVERVIEW"
            title={
              role === "trainer" ? "Your training floor." : "The floor is live."
            }
            description={`${new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${today}T12:00:00+05:30`))} · Here’s what needs your attention.`}
            actions={
              role !== "trainer" ? (
                <button
                  className="button button-primary"
                  onClick={openNewMember}
                >
                  <UserPlus size={16} />
                  Add member
                </button>
              ) : undefined
            }
          />
          <div className="stats-grid">
            <StatCard
              label="MEMBERS ON FILE"
              value={String(data.stats.members)}
              note={`${data.stats.activeMemberships} active · ${data.stats.expiredMemberships} expired`}
              icon={Users}
              tone="burgundy"
            />
            <StatCard
              label="CHECK-INS TODAY"
              value={String(data.stats.todayVisits)}
              note="Unique visits recorded"
              icon={Activity}
              tone="mint"
            />
            {isAdmin && (
              <StatCard
                label="COLLECTED TODAY"
                value={currency(data.stats.revenue?.todayCollected ?? 0)}
                note="Posted payments only"
                icon={Wallet}
                tone="amber"
              />
            )}
            {isAdmin && (
              <StatCard
                label="PENDING DUES"
                value={currency(data.stats.revenue?.pendingDues ?? 0)}
                note="Across recorded memberships"
                icon={CircleDollarSign}
                tone="lilac"
              />
            )}
            {isAdmin && (
              <StatCard
                label="NEW THIS MONTH"
                value={String(registrationsThisMonth)}
                note="Member registrations"
                icon={UserPlus}
                tone="blue"
              />
            )}
            {!isAdmin && (
              <StatCard
                label="EXPIRING SOON"
                value={expiringCountLabel}
                note={`Within ${settings?.expiryAlertDays ?? 7} days`}
                icon={Bell}
                tone="amber"
              />
            )}
          </div>
          <div className="dashboard-grid">
            {role !== "trainer" && (
              <section className="panel checkin-panel">
                <div className="panel-topline">
                  <div>
                    <p className="eyebrow">QUICK CHECK-IN</p>
                    <h2>Scan or search a member</h2>
                    <p>Membership validity is checked before every visit.</p>
                  </div>
                  <span className="panel-icon burgundy-icon">
                    <QrCode size={20} />
                  </span>
                </div>
                <form
                  className="checkin-input-row"
                  onSubmit={event => {
                    event.preventDefault();
                    void doCheckIn(attendanceLookup, "manual");
                  }}
                >
                  <Search size={17} />
                  <input
                    value={attendanceLookup}
                    onChange={event => setAttendanceLookup(event.target.value)}
                    placeholder="Enter member ID, name, or full phone"
                  />
                  <button
                    className="button button-primary"
                    type="submit"
                    disabled={checkIn.isPending}
                  >
                    {checkIn.isPending ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <ArrowRight size={16} />
                    )}
                    Check in
                  </button>
                </form>
                <div className="checkin-options">
                  <button
                    className="text-button"
                    onClick={() => setScanMode(!scanMode)}
                  >
                    <Camera size={15} />
                    {scanMode ? "Hide QR scanner" : "Open camera scanner"}
                  </button>
                  {isAdmin && (
                    <label className="override-toggle">
                      <input
                        type="checkbox"
                        checked={checkInOverride}
                        onChange={event =>
                          setCheckInOverride(event.target.checked)
                        }
                      />
                      Admin override
                    </label>
                  )}
                </div>
                <QrScanner
                  enabled={scanMode}
                  onScan={code => {
                    setScanMode(false);
                    void doCheckIn(code, "qr");
                  }}
                />
                {lastCheckin && (
                  <div className="last-checkin">
                    <span className="last-check-icon">
                      <Check size={15} />
                    </span>
                    <div>
                      <strong>{lastCheckin.name}</strong>
                      <small>
                        {lastCheckin.code} · {lastCheckin.time} IST
                      </small>
                    </div>
                    <Badge tone="green">Checked in</Badge>
                  </div>
                )}
              </section>
            )}
            <section className="panel expiring-panel">
              <SectionHeading
                title="Memberships at a glance"
                detail={`Expiring within ${settings?.expiryAlertDays ?? 7} days`}
                action={
                  <button
                    className="text-button"
                    onClick={() => setView("retention")}
                  >
                    View all <ChevronRight size={14} />
                  </button>
                }
              />
              {expiringRows.length ? (
                <div className="compact-list">
                  {expiringRows.slice(0, 4).map(({ membership, member }) => (
                    <div className="compact-row" key={membership.id}>
                      <span className="member-avatar burgundy-avatar">
                        {member.name.slice(0, 1)}
                      </span>
                      <div className="compact-main">
                        <strong>{member.name}</strong>
                        <small>
                          {member.memberCode} · {membership.planName}
                        </small>
                      </div>
                      <span className="due-tag">
                        {daysBetween(today, membership.endDate) === 0
                          ? "Today"
                          : `${daysBetween(today, membership.endDate)}d`}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Clear for now"
                  message="No membership expiry alerts in the configured window."
                  action={
                    <button
                      className="text-button"
                      onClick={() => setView("plans")}
                    >
                      Manage plans <ArrowRight size={14} />
                    </button>
                  }
                />
              )}
              <div className="panel-divider" />
              <div className="mini-metric">
                <div>
                  <small>MONTH COLLECTION</small>
                  <strong>
                    {isAdmin
                      ? currency(data.stats.revenue?.monthCollected ?? 0)
                      : "Staff view"}
                  </strong>
                </div>
                <span className="mini-metric-icon">
                  <ArrowUpRight size={16} />
                </span>
              </div>
              {isAdmin && (
                <div className="mini-metric mini-metric-secondary">
                  <div>
                    <small>
                      MONTH EXPENSES · NET{" "}
                      {currency(data.stats.revenue?.monthNet ?? 0)}
                    </small>
                    <strong>
                      {currency(data.stats.revenue?.monthExpenses ?? 0)}
                    </strong>
                  </div>
                  <span className="mini-metric-icon mini-expense-icon">
                    <ArrowDownRight size={16} />
                  </span>
                </div>
              )}
            </section>
          </div>
          <div className="dashboard-grid bottom-grid">
            <section className="panel">
              <SectionHeading
                title="Latest check-ins"
                detail="A live log of today's visits"
                action={
                  <button
                    className="text-button"
                    onClick={() => setView("attendance")}
                  >
                    Attendance log <ArrowRight size={14} />
                  </button>
                }
              />
              {attendanceToday.length ? (
                <div className="activity-list">
                  {attendanceToday.slice(0, 6).map(row => (
                    <div className="activity-row" key={row.item.id}>
                      <span className="activity-time">
                        {new Intl.DateTimeFormat("en-IN", {
                          timeZone: "Asia/Kolkata",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(row.item.checkedInAt)}
                      </span>
                      <span className="activity-dot" />
                      <div>
                        <strong>{row.memberName}</strong>
                        <small>
                          {row.memberCode} ·{" "}
                          {row.item.method === "qr"
                            ? "QR scan"
                            : row.item.method === "biometric"
                              ? "Fingerprint"
                              : "Manual check-in"}
                        </small>
                      </div>
                      <CheckCircle2 className="activity-check" size={16} />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No visits recorded yet"
                  message="Your first validated check-in will appear here."
                  action={
                    <button
                      className="text-button"
                      onClick={() =>
                        document
                          .querySelector<HTMLInputElement>(
                            ".checkin-input-row input"
                          )
                          ?.focus()
                      }
                    >
                      Start a check-in <ArrowRight size={14} />
                    </button>
                  }
                />
              )}
            </section>
            <section className="panel retention-card">
              <div className="retention-header">
                <span className="retention-badge">
                  <HeartPulse size={18} />
                </span>
                <span className="eyebrow">MEMBER RETENTION</span>
              </div>
              <h2>
                Keep momentum
                <br />
                going.
              </h2>
              <p>
                {inactiveRows.length
                  ? `${inactiveCountLabel} member${inactiveRows.length === 1 && !data.limitsExceeded.includes("inactive members") ? "" : "s"} without a recent visit.`
                  : "Your visit cadence looks healthy. Follow up before a quiet week becomes a quiet month."}
              </p>
              <button
                className="button button-light"
                onClick={() => setView("retention")}
              >
                Review follow-ups <ArrowRight size={15} />
              </button>
              <div className="retention-watermark">S</div>
            </section>
          </div>
        </>
      )}

      {view === "members" && (
        <>
          <HeaderTitle
            kicker="MEMBER DIRECTORY"
            title="People make the place."
            description="Member profiles, validity and visit history—ready for the front desk."
            actions={
              role !== "trainer" ? (
                <button
                  className="button button-primary"
                  onClick={openNewMember}
                >
                  <Plus size={16} />
                  New member
                </button>
              ) : undefined
            }
          />
          <section className="panel directory-panel">
            <div className="table-toolbar">
              <div className="search-box">
                <Search size={16} />
                <input
                  value={memberSearch}
                  onChange={event => setMemberSearch(event.target.value)}
                  placeholder="Search name, phone or ID"
                />
              </div>
              <span className="result-count">
                {filteredMembers.length} MEMBERS
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>MEMBER</th>
                    <th>MEMBER ID</th>
                    <th>PHONE</th>
                    <th>MEMBERSHIP</th>
                    <th>VALID THROUGH</th>
                    <th>STATUS</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.length ? (
                    filteredMembers.slice(0, 250).map(member => {
                      const current = liveMembership(member.id);
                      const latest = current ?? latestMembership(member.id);
                      const label =
                        member.status === "inactive"
                          ? "Inactive"
                          : member.status === "frozen"
                            ? "Frozen"
                            : current
                              ? "Active"
                              : "Expired";
                      const tone =
                        label === "Active"
                          ? "green"
                          : label === "Expired"
                            ? "red"
                            : "amber";
                      return (
                        <tr key={member.id}>
                          <td>
                            <div className="member-cell">
                              <span className="member-avatar">
                                {member.photoUrl ? (
                                  <img src={member.photoUrl} alt="" />
                                ) : (
                                  member.name.slice(0, 1)
                                )}
                              </span>
                              <div>
                                <strong>{member.name}</strong>
                                <small>
                                  {member.email ?? "No email added"}
                                </small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="mono-text">
                              {member.memberCode}
                            </span>
                          </td>
                          <td>{member.phone}</td>
                          <td>
                            {latest?.planName ?? (
                              <span className="muted-inline">
                                No plan assigned
                              </span>
                            )}
                          </td>
                          <td>{latest ? prettyDate(latest.endDate) : "—"}</td>
                          <td>
                            <Badge tone={tone}>{label}</Badge>
                          </td>
                          <td>
                            <div className="row-actions">
                              <button
                                className="text-button"
                                onClick={() => chooseMember(member, "qr")}
                                title="Show member QR"
                              >
                                <QrCode size={15} />
                              </button>
                              {role !== "trainer" && (
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    chooseMember(member, "fingerprint")
                                  }
                                  title="Fingerprint access"
                                >
                                  <Fingerprint size={15} />
                                </button>
                              )}
                              {role !== "trainer" && (
                                <button
                                  className="text-button"
                                  onClick={() => chooseMember(member)}
                                  title="Edit member"
                                >
                                  <MoreHorizontal size={17} />
                                </button>
                              )}
                              {role !== "trainer" && (
                                <button
                                  className="table-renew"
                                  onClick={() => openRenew(member)}
                                >
                                  {current ? "Renew" : "Assign plan"}
                                </button>
                              )}
                              {isAdmin && current && (
                                <button
                                  className="text-button danger-link"
                                  onClick={() => chooseMember(member, "freeze")}
                                  title="Freeze membership"
                                >
                                  Freeze
                                </button>
                              )}
                              {isAdmin && latest?.status === "frozen" && (
                                <button
                                  className="table-renew"
                                  onClick={() =>
                                    chooseMember(member, "reactivate")
                                  }
                                >
                                  Reactivate
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <EmptyRows
                      colSpan={7}
                      text="No matching members. Add a profile to begin the directory."
                    />
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {view === "plans" && (
        <>
          <HeaderTitle
            kicker="MEMBERSHIP CATALOGUE"
            title="Plans & renewals."
            description="Build the offers your members can choose from. Price and freeze rules remain configurable."
            actions={
              isAdmin ? (
                <button
                  className="button button-primary"
                  onClick={() => setModal("plan")}
                >
                  <Plus size={16} />
                  Create plan
                </button>
              ) : undefined
            }
          />
          {plans.length ? (
            <div className="plans-grid">
              {plans.map((plan, index) => (
                <article
                  className={`plan-card${index === 0 ? " plan-featured" : ""}`}
                  key={plan.id}
                >
                  <div className="plan-card-top">
                    <span className="plan-mark">0{index + 1}</span>
                    <Badge tone={plan.active ? "green" : "neutral"}>
                      {plan.active ? "Available" : "Paused"}
                    </Badge>
                  </div>
                  <p className="eyebrow">
                    {planPeriodLabels[plan.period] ?? "Membership"} ·{" "}
                    {plan.durationDays} DAYS
                  </p>
                  <h2>{plan.name}</h2>
                  <strong className="plan-price">
                    {currency(plan.price)}
                    <small> / term</small>
                  </strong>
                  <p className="plan-description">
                    {plan.description || "Membership access at your gym."}
                  </p>
                  {isAdmin && (
                    <button
                      className="button button-secondary"
                      onClick={() => {
                        setSelectedPlan(plan);
                        setModal("plan");
                      }}
                    >
                      Edit plan <Settings2 size={15} />
                    </button>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <section className="panel">
              <EmptyState
                title="No plans created yet"
                message="Create the first membership option. Choose your actual gym pricing rather than relying on sample rates."
                action={
                  isAdmin ? (
                    <button
                      className="button button-primary"
                      onClick={() => setModal("plan")}
                    >
                      <Plus size={15} />
                      Create first plan
                    </button>
                  ) : undefined
                }
              />
            </section>
          )}
          {isFrontDesk && (
            <section className="panel renewal-queue-panel">
              <SectionHeading
                title="Member renewal requests"
                detail="Review portal requests and complete the membership with the usual manual payment workflow."
              />
              {renewalRequests.filter(item => item.request.status === "pending")
                .length ? (
                <div className="renewal-request-list">
                  {renewalRequests
                    .filter(item => item.request.status === "pending")
                    .map(item => (
                      <article
                        className="renewal-request-row"
                        key={item.request.id}
                      >
                        <div className="renewal-request-member">
                          <span className="workout-icon">
                            <UserPlus size={17} />
                          </span>
                          <div>
                            <strong>{item.member.name}</strong>
                            <small>
                              {item.member.memberCode} · {item.member.phone}
                            </small>
                          </div>
                        </div>
                        <div className="renewal-request-plan">
                          <strong>
                            {item.plan?.name ?? "Unavailable plan"}
                          </strong>
                          <small>
                            {item.plan?.active
                              ? `${currency(item.plan.price)} · ${item.plan.durationDays} days`
                              : "This plan is inactive. Close the request so the member can choose another active plan."}
                          </small>
                        </div>
                        <small className="renewal-request-date">
                          Requested {prettyDate(item.request.requestedAt)}
                        </small>
                        {item.plan?.active ? (
                          <button
                            className="button button-secondary"
                            onClick={() => {
                              setSelectedMember(item.member);
                              setSelectedPlan(item.plan);
                              setSelectedRenewalRequestId(item.request.id);
                              setModal("renew");
                            }}
                          >
                            Process request <ChevronRight size={15} />
                          </button>
                        ) : (
                          <button
                            className="button button-secondary"
                            disabled={closeUnavailableRenewalRequest.isPending}
                            onClick={() =>
                              closeUnavailableRenewalRequest.mutate(
                                { requestId: item.request.id },
                                {
                                  onSuccess: () => {
                                    toast.success(
                                      "Request closed. The member can now choose an active plan and submit a new request."
                                    );
                                    refresh();
                                  },
                                  onError: error => toast.error(error.message),
                                }
                              )
                            }
                          >
                            Close request
                          </button>
                        )}
                      </article>
                    ))}
                </div>
              ) : (
                <EmptyState
                  title="No pending requests"
                  message="Member portal renewal requests will appear here."
                />
              )}
            </section>
          )}
          <section className="info-strip">
            <Sparkles size={16} />
            <span>
              Validity is stored with each membership, so plan price changes
              won’t rewrite historical receipts or member terms.
            </span>
          </section>
        </>
      )}

      {view === "attendance" && (
        <>
          <HeaderTitle
            kicker="VISIT MANAGEMENT"
            title="A good day starts here."
            description="Membership is checked before a visit is recorded. One check-in per member, per day."
            actions={
              <button
                className="button button-secondary"
                onClick={() => setScanMode(!scanMode)}
              >
                <Camera size={16} />
                {scanMode ? "Close camera" : "Scan QR code"}
              </button>
            }
          />
          <div className="occupancy-banner">
            <Users size={18} />
            <strong>{liveStatusQuery.data?.liveCount ?? "—"}</strong>
            <span>members currently in the gym · updates automatically</span>
          </div>
          <div className="attendance-layout">
            <section className="panel">
              <div className="checkin-large">
                <p className="eyebrow">TODAY · {prettyDate(today)}</p>
                <h2>Check in a member</h2>
                <p>
                  Search by member code or enter a phone number. You can also
                  scan the member’s QR badge.
                </p>
                <form
                  className="checkin-input-row big-checkin"
                  onSubmit={event => {
                    event.preventDefault();
                    void doCheckIn(attendanceLookup, "manual");
                  }}
                >
                  <Search size={18} />
                  <input
                    value={attendanceLookup}
                    onChange={event => setAttendanceLookup(event.target.value)}
                    placeholder="Member ID, name, or full phone number"
                  />
                  <button
                    className="button button-primary"
                    disabled={checkIn.isPending}
                  >
                    {checkIn.isPending ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Check size={15} />
                    )}
                    Check in
                  </button>
                </form>
                <QrScanner
                  enabled={scanMode}
                  onScan={code => {
                    setScanMode(false);
                    void doCheckIn(code, "qr");
                  }}
                />
                {isAdmin && (
                  <label className="override-toggle">
                    <input
                      type="checkbox"
                      checked={checkInOverride}
                      onChange={event =>
                        setCheckInOverride(event.target.checked)
                      }
                    />
                    Allow an expired-member override (audited)
                  </label>
                )}
                {lastCheckin && (
                  <div className="last-checkin">
                    <span className="last-check-icon">
                      <Check size={15} />
                    </span>
                    <div>
                      <strong>{lastCheckin.name}</strong>
                      <small>
                        {lastCheckin.code} · {lastCheckin.time} IST
                      </small>
                    </div>
                    <Badge tone="green">Checked in</Badge>
                  </div>
                )}
              </div>
            </section>
            <section className="panel">
              <SectionHeading
                title="Daily attendance history"
                detail={`${attendanceForDate.length} recorded · ${prettyDate(attendanceDate)}`}
                action={
                  <input
                    className="history-date"
                    aria-label="Attendance history date"
                    type="date"
                    value={attendanceDate}
                    max={today}
                    onChange={event => setAttendanceDate(event.target.value)}
                  />
                }
              />
              {attendanceForDate.length ? (
                <div className="activity-list attendance-log">
                  {attendanceForDate.map(row => (
                    <div className="activity-row" key={row.item.id}>
                      <span className="activity-time">
                        {new Intl.DateTimeFormat("en-IN", {
                          timeZone: "Asia/Kolkata",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(row.item.checkedInAt)}
                      </span>
                      <span className="activity-dot" />
                      <div>
                        <strong>{row.memberName}</strong>
                        <small>
                          {row.memberCode} ·{" "}
                          {row.item.method === "qr"
                            ? "QR scan"
                            : row.item.method === "biometric"
                              ? "Fingerprint"
                              : "Manual"}
                        </small>
                      </div>
                      {row.item.checkInDate === today &&
                      !row.item.checkedOutAt ? (
                        <div className="attendance-row-actions">
                          <Badge tone="amber">In gym</Badge>
                          <button
                            className="text-button"
                            disabled={checkOut.isPending}
                            onClick={() => doCheckOut(row.item.id)}
                          >
                            <LogOut size={14} />
                            Check out
                          </button>
                        </div>
                      ) : (
                        <Badge tone="green">Visited</Badge>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No visits on this date"
                  message="Choose another date or record a check-in to add the first visit."
                />
              )}
            </section>
          </div>
        </>
      )}

      {view === "machine" && isFrontDesk && <MachineView />}

      {view === "alerts" && isFrontDesk && <AlertsView />}

      {view === "billing" && (
        <>
          <HeaderTitle
            kicker="MANUAL BILLING · INR"
            title="Collections, accounted for."
            description="Record cash, UPI or bank payments, issue a sequential receipt, and track each balance."
            actions={
              <button
                className="button button-primary"
                onClick={() => {
                  setSelectedMember(null);
                  setModal("payment");
                }}
              >
                <Plus size={16} />
                Record payment
              </button>
            }
          />
          <div className="stats-grid three-stats">
            <StatCard
              label="COLLECTED TODAY"
              value={currency(data.stats.revenue?.todayCollected ?? 0)}
              note="Posted receipts · IST"
              icon={Wallet}
              tone="burgundy"
            />
            <StatCard
              label="COLLECTED THIS MONTH"
              value={currency(data.stats.revenue?.monthCollected ?? 0)}
              note="Across recorded payments"
              icon={ArrowUpRight}
              tone="mint"
            />
            <StatCard
              label="OUTSTANDING DUES"
              value={currency(data.stats.revenue?.pendingDues ?? 0)}
              note="Membership balance remaining"
              icon={CircleDollarSign}
              tone="amber"
            />
          </div>
          <section className="panel directory-panel">
            <div className="table-toolbar">
              <div className="search-box">
                <Search size={16} />
                <input
                  value={paymentSearch}
                  onChange={event => setPaymentSearch(event.target.value)}
                  placeholder="Search member or receipt"
                />
              </div>
              <span className="result-count">RECENT RECEIPTS</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>RECEIPT</th>
                    <th>MEMBER</th>
                    <th>DATE</th>
                    <th>MODE</th>
                    <th>AMOUNT</th>
                    <th>STATUS</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.length ? (
                    filteredPayments.slice(0, 150).map(row => (
                      <tr key={row.payment.id}>
                        <td>
                          <button
                            className="mono-link"
                            onClick={() => showReceipt(row)}
                          >
                            {row.payment.receiptNumber}
                          </button>
                        </td>
                        <td>
                          <div className="member-cell">
                            <span className="member-avatar">
                              {row.memberName.slice(0, 1)}
                            </span>
                            <div>
                              <strong>{row.memberName}</strong>
                              <small>{row.memberCode}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          {new Intl.DateTimeFormat("en-IN", {
                            timeZone: "Asia/Kolkata",
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          }).format(row.payment.recordedAt)}
                        </td>
                        <td>
                          <span className="mode-text">
                            {paymentModes[row.payment.mode]}
                          </span>
                        </td>
                        <td className="amount-cell">
                          {currency(row.payment.amount)}
                        </td>
                        <td>
                          <Badge
                            tone={
                              row.payment.status === "posted" ? "green" : "red"
                            }
                          >
                            {row.payment.status === "posted"
                              ? "Posted"
                              : "Reversed"}
                          </Badge>
                        </td>
                        <td>
                          <button
                            className="text-button"
                            title="Print receipt"
                            onClick={() => receiptFor(row)}
                          >
                            <Printer size={15} />
                          </button>
                          {isAdmin && row.payment.status === "posted" && (
                            <button
                              className="text-button danger-link"
                              title="Correct payment"
                              onClick={() => {
                                const reason = window.prompt(
                                  "Enter a reason for reversing this payment. This action is audited and cannot be undone."
                                );
                                if (reason?.trim())
                                  correctPayment.mutate(
                                    {
                                      paymentId: row.payment.id,
                                      reason: reason.trim(),
                                    },
                                    notify("Payment correction recorded")
                                  );
                              }}
                            >
                              <X size={15} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <EmptyRows
                      colSpan={7}
                      text="No receipts yet. Record a manual payment to create the first receipt."
                    />
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <div className="info-strip">
            <ShieldCheck size={16} />
            <span>
              Payments are never silently deleted. Admin corrections are
              recorded as a reversal with the reason and operator.
            </span>
          </div>
        </>
      )}

      {view === "training" && (
        <>
          <HeaderTitle
            kicker="TRAINER WORKSPACE"
            title="Train with intent."
            description="Assigned-member plans, session notes and progress history. Not medical advice."
            actions={
              <>
                <button
                  className="button button-secondary"
                  onClick={() => setModal("progress")}
                >
                  <Activity size={15} />
                  Log progress
                </button>
                <button
                  className="button button-primary"
                  onClick={() => setModal("workout")}
                >
                  <Plus size={15} />
                  Assign workout
                </button>
              </>
            }
          />
          <div className="training-grid">
            <section className="panel">
              <SectionHeading
                title="Assigned members"
                detail={`${members.length} in your coaching list`}
              />
              {members.length ? (
                <div className="compact-list">
                  {members.map(member => {
                    const current = liveMembership(member.id);
                    const last = lastVisitByMember.get(member.id);
                    return (
                      <div className="compact-row" key={member.id}>
                        <span className="member-avatar mint-avatar">
                          {member.name.slice(0, 1)}
                        </span>
                        <div className="compact-main">
                          <strong>{member.name}</strong>
                          <small>
                            {member.memberCode} ·{" "}
                            {current?.planName ?? "No active plan"}
                          </small>
                        </div>
                        <div className="coaching-date">
                          <small>LAST VISIT</small>
                          <b>{last ? prettyDate(last) : "—"}</b>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  title="No assigned members"
                  message="An admin can assign a trainer to a member profile."
                />
              )}
            </section>
            <section className="panel">
              <SectionHeading
                title="Upcoming sessions"
                detail="Planned and assigned workouts"
              />
              {data.workouts.length ? (
                <div className="compact-list">
                  {data.workouts.slice(0, 8).map(workout => (
                    <div className="compact-row" key={workout.id}>
                      <span className="workout-icon">
                        <Dumbbell size={17} />
                      </span>
                      <div className="compact-main">
                        <strong>{workout.title}</strong>
                        <small>
                          {members.find(
                            member => member.id === workout.memberId
                          )?.name ?? "Member"}{" "}
                          · {prettyDate(workout.workoutDate)}
                        </small>
                      </div>
                      <ChevronRight size={16} className="muted-icon" />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No workouts scheduled"
                  message="Assign a simple schedule for one of your members."
                  action={
                    <button
                      className="text-button"
                      onClick={() => setModal("workout")}
                    >
                      Create workout <ArrowRight size={14} />
                    </button>
                  }
                />
              )}
            </section>
          </div>
          <section className="panel directory-panel">
            <SectionHeading
              title="Progress log"
              detail="Weight and coaching notes"
            />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>MEMBER</th>
                    <th>DATE</th>
                    <th>WEIGHT</th>
                    <th>BMI*</th>
                    <th>NOTES</th>
                  </tr>
                </thead>
                <tbody>
                  {data.progress.length ? (
                    data.progress.slice(0, 100).map(entry => {
                      const member = members.find(
                        item => item.id === entry.memberId
                      );
                      const heightM = Number(member?.heightCm ?? 0) / 100;
                      const bmi =
                        heightM > 0
                          ? (
                              Number(entry.weightKg) /
                              (heightM * heightM)
                            ).toFixed(1)
                          : "—";
                      return (
                        <tr key={entry.id}>
                          <td>{member?.name ?? "Member"}</td>
                          <td>{prettyDate(entry.entryDate)}</td>
                          <td className="amount-cell">{entry.weightKg} kg</td>
                          <td>{bmi}</td>
                          <td>{entry.notes || "—"}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <EmptyRows
                      colSpan={5}
                      text="No progress updates recorded yet."
                    />
                  )}
                </tbody>
              </table>
            </div>
            <p className="field-hint progress-disclaimer">
              *BMI is a simple height/weight reference only; it is not medical
              advice or a diagnosis.
            </p>
          </section>
        </>
      )}

      {view === "reports" && isAdmin && (
        <>
          <HeaderTitle
            kicker="OWNER REPORTING"
            title="A clear month-end."
            description="Collections, dues, attendance and operating expenses in one filterable report."
            actions={
              <button
                className="button button-secondary"
                onClick={() => window.print()}
                disabled={!report || report.truncated || reportQuery.isFetching}
              >
                <Download size={16} />
                Export PDF
              </button>
            }
          />
          <section className="panel report-filter">
            <div className="filter-label">
              <Filter size={16} />
              <span>REPORT PERIOD</span>
            </div>
            <FormField label="From">
              <input
                type="date"
                value={reportFrom}
                onChange={event => setReportFrom(event.target.value)}
              />
            </FormField>
            <FormField label="To">
              <input
                type="date"
                value={reportTo}
                onChange={event => setReportTo(event.target.value)}
              />
            </FormField>
            <button
              className="button button-primary"
              onClick={() => void reportQuery.refetch()}
            >
              <CalendarDays size={15} />
              Apply dates
            </button>
            <button
              className="button button-secondary"
              disabled={!report || report.truncated || reportQuery.isFetching}
              onClick={() => {
                if (!report) return;
                const rows = makeReportRows();
                csvExport(
                  `fitcrush-collections-${reportFrom}-${reportTo}.csv`,
                  rows
                );
              }}
            >
              <Download size={15} />
              CSV / Excel
            </button>
          </section>
          {report?.truncated && (
            <div className="overflow-warning" role="alert">
              <strong>Report exceeds the export row limit.</strong>
              <span>
                Incomplete sections: {report.truncatedSections.join(", ")}.
                Narrow the date range and apply it again. CSV and PDF exports
                remain disabled until the result is complete.
              </span>
            </div>
          )}
          <div className="stats-grid three-stats four-stats">
            <StatCard
              label="COLLECTIONS"
              value={currency(report?.totals.collected ?? 0)}
              note={`${report?.payments.filter(row => row.payment.status === "posted").length ?? 0} receipts in range`}
              icon={Wallet}
              tone="burgundy"
            />
            <StatCard
              label="EXPENSES"
              value={currency(report?.totals.expenses ?? 0)}
              note="Recorded operating costs"
              icon={ArrowDownRight}
              tone="amber"
            />
            <StatCard
              label="VISITS & SIGN-UPS"
              value={`${report?.totals.visits ?? 0} / ${report?.totals.registrations ?? 0}`}
              note="Visits / registrations"
              icon={Activity}
              tone="mint"
            />
            <StatCard
              label="CURRENT DUES"
              value={currency(report?.totals.dues ?? 0)}
              note={`${report?.dues.length ?? 0} unpaid membership balances`}
              icon={CircleDollarSign}
              tone="lilac"
            />
          </div>
          <div className="report-split">
            <section className="panel">
              <SectionHeading
                title="Collections"
                detail="Posted payment receipts"
              />
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>RECEIPT</th>
                      <th>MEMBER</th>
                      <th>DATE</th>
                      <th>AMOUNT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report?.payments
                      .filter(row => row.payment.status === "posted")
                      .map(row => (
                        <tr key={row.payment.id}>
                          <td className="mono-text">
                            {row.payment.receiptNumber}
                          </td>
                          <td>{row.memberName}</td>
                          <td>{prettyDate(row.payment.recordedAt)}</td>
                          <td className="amount-cell">
                            {currency(row.payment.amount)}
                          </td>
                        </tr>
                      )) ?? <EmptyRows colSpan={4} text="Loading report…" />}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="panel">
              <div className="expense-head">
                <SectionHeading
                  title="Expenses"
                  detail="Track operating costs"
                />
                <button
                  className="button button-primary button-sm"
                  onClick={() => setModal("expense")}
                >
                  <Plus size={14} />
                  Add expense
                </button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>DATE</th>
                      <th>CATEGORY</th>
                      <th>AMOUNT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report?.expenses ?? []).map(expense => (
                      <tr key={expense.id}>
                        <td>{prettyDate(expense.expenseDate)}</td>
                        <td>{expense.category}</td>
                        <td className="amount-cell">
                          {currency(expense.amount)}
                        </td>
                      </tr>
                    ))}
                    {report && !report.expenses.length && (
                      <EmptyRows
                        colSpan={3}
                        text="No expenses in this date range."
                      />
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
          <div className="report-split">
            <section className="panel">
              <SectionHeading
                title="Current outstanding dues"
                detail="Snapshot across all non-cancelled memberships; not limited by the report date range."
              />
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>MEMBER</th>
                      <th>PLAN</th>
                      <th>VALID THROUGH</th>
                      <th>AMOUNT DUE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report?.dues ?? []).map(row => (
                      <tr key={row.membershipId}>
                        <td>
                          <div className="member-cell">
                            <span className="member-avatar">
                              {row.memberName.slice(0, 1)}
                            </span>
                            <div>
                              <strong>{row.memberName}</strong>
                              <small>{row.memberCode}</small>
                            </div>
                          </div>
                        </td>
                        <td>{row.planName}</td>
                        <td>{prettyDate(row.endDate)}</td>
                        <td className="amount-cell">
                          {currency(row.amountDue)}
                        </td>
                      </tr>
                    ))}
                    {report && !report.dues.length && (
                      <EmptyRows
                        colSpan={4}
                        text="No outstanding membership balances."
                      />
                    )}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="panel">
              <SectionHeading
                title="Attendance in range"
                detail={`${report?.attendance.length ?? 0} validated visits`}
              />
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>DATE</th>
                      <th>MEMBER</th>
                      <th>METHOD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report?.attendance ?? []).map(row => (
                      <tr key={row.attendance.id}>
                        <td>{prettyDate(row.attendance.checkInDate)}</td>
                        <td>
                          {row.memberName}{" "}
                          <small className="muted-inline">
                            {row.memberCode}
                          </small>
                        </td>
                        <td>
                          {row.attendance.method === "qr" ? "QR" : "Manual"}
                        </td>
                      </tr>
                    ))}
                    {report && !report.attendance.length && (
                      <EmptyRows
                        colSpan={3}
                        text="No visits in this date range."
                      />
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
          <section className="panel directory-panel">
            <SectionHeading
              title="Memberships started in range"
              detail={`${report?.memberships.length ?? 0} membership records; renewal history is preserved.`}
            />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>MEMBER</th>
                    <th>PLAN</th>
                    <th>START</th>
                    <th>END</th>
                    <th>LIST PRICE</th>
                  </tr>
                </thead>
                <tbody>
                  {(report?.memberships ?? []).map(row => (
                    <tr key={row.id}>
                      <td>
                        {row.memberName}{" "}
                        <small className="muted-inline">{row.memberCode}</small>
                      </td>
                      <td>{row.planName}</td>
                      <td>{prettyDate(row.startDate)}</td>
                      <td>{prettyDate(row.endDate)}</td>
                      <td className="amount-cell">
                        {currency(row.planPrice - row.discount)}
                      </td>
                    </tr>
                  ))}
                  {report && !report.memberships.length && (
                    <EmptyRows
                      colSpan={5}
                      text="No memberships started in this date range."
                    />
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <div className="info-strip">
            <ShieldCheck size={16} />
            <span>
              Financial reports are visible to owner/admin only. CSV exports
              open in Excel; choose Print / Save as PDF for a PDF snapshot.
            </span>
          </div>
        </>
      )}

      {view === "retention" && (
        <>
          <HeaderTitle
            kicker="MEMBER RETENTION"
            title="The next visit starts here."
            description="Spot upcoming membership expiries and quiet attendance, then record a manual follow-up."
          />
          <div className="stats-grid three-stats">
            <StatCard
              label="EXPIRING SOON"
              value={expiringCountLabel}
              note={`Within ${settings?.expiryAlertDays ?? 7} days`}
              icon={Bell}
              tone="amber"
            />
            <StatCard
              label="QUIET MEMBERS"
              value={inactiveCountLabel}
              note={`No visit in ${settings?.inactiveVisitDays ?? 14} days`}
              icon={Clock3}
              tone="burgundy"
            />
            <StatCard
              label="FOLLOW-UPS RECORDED"
              value={String(data.followUps.length)}
              note="Contact and next step status"
              icon={CheckCircle2}
              tone="mint"
            />
          </div>
          <div className="retention-grid">
            <section className="panel">
              <SectionHeading
                title="Expiring memberships"
                detail="Current terms ending inside the alert window"
              />
              {expiringRows.length ? (
                <div className="retention-list">
                  {expiringRows.map(({ membership, member }) => (
                    <FollowupRow
                      key={`expiring-${membership.id}`}
                      member={member}
                      title={membership.planName}
                      trigger="expiring"
                      endDate={membership.endDate}
                      follow={data.followUps.find(
                        item =>
                          item.memberId === member.id &&
                          item.trigger === "expiring"
                      )}
                      status={followStatus[`expiring-${member.id}`]}
                      note={followText[`expiring-${member.id}`]}
                      onStatus={value =>
                        setFollowStatus(prev => ({
                          ...prev,
                          [`expiring-${member.id}`]: value,
                        }))
                      }
                      onNote={value =>
                        setFollowText(prev => ({
                          ...prev,
                          [`expiring-${member.id}`]: value,
                        }))
                      }
                      onSave={() =>
                        updateFollowUp.mutate(
                          {
                            memberId: member.id,
                            trigger: "expiring",
                            status:
                              followStatus[`expiring-${member.id}`] ??
                              data.followUps.find(
                                item =>
                                  item.memberId === member.id &&
                                  item.trigger === "expiring"
                              )?.status ??
                              "pending",
                            notes:
                              followText[`expiring-${member.id}`] ??
                              data.followUps.find(
                                item =>
                                  item.memberId === member.id &&
                                  item.trigger === "expiring"
                              )?.notes ??
                              "",
                          },
                          notify("Follow-up saved")
                        )
                      }
                      onRenew={() => openRenew(member)}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No one nearing expiry"
                  message="The expiry window is clear for now."
                />
              )}
            </section>
            <section className="panel">
              <SectionHeading
                title="Missed visits"
                detail="Active members with no recent check-in"
              />
              {inactiveRows.length ? (
                <div className="retention-list">
                  {inactiveRows.map(({ member, lastVisit }) => (
                    <FollowupRow
                      key={`inactive-${member.id}`}
                      member={member}
                      title={
                        lastVisit
                          ? `Last visit ${prettyDate(lastVisit)}`
                          : "No visits recorded"
                      }
                      trigger="inactive"
                      follow={data.followUps.find(
                        item =>
                          item.memberId === member.id &&
                          item.trigger === "inactive"
                      )}
                      status={followStatus[`inactive-${member.id}`]}
                      note={followText[`inactive-${member.id}`]}
                      onStatus={value =>
                        setFollowStatus(prev => ({
                          ...prev,
                          [`inactive-${member.id}`]: value,
                        }))
                      }
                      onNote={value =>
                        setFollowText(prev => ({
                          ...prev,
                          [`inactive-${member.id}`]: value,
                        }))
                      }
                      onSave={() =>
                        updateFollowUp.mutate(
                          {
                            memberId: member.id,
                            trigger: "inactive",
                            status:
                              followStatus[`inactive-${member.id}`] ??
                              data.followUps.find(
                                item =>
                                  item.memberId === member.id &&
                                  item.trigger === "inactive"
                              )?.status ??
                              "pending",
                            notes:
                              followText[`inactive-${member.id}`] ??
                              data.followUps.find(
                                item =>
                                  item.memberId === member.id &&
                                  item.trigger === "inactive"
                              )?.notes ??
                              "",
                          },
                          notify("Follow-up saved")
                        )
                      }
                      onRenew={() => openRenew(member)}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Visit cadence is steady"
                  message="No member meets the current inactivity threshold."
                />
              )}
            </section>
          </div>
        </>
      )}

      {view === "team" && isAdmin && (
        <>
          <HeaderTitle
            kicker="STAFF & PERMISSIONS"
            title="A team that knows its lane."
            description="Assign application roles, link member logins and pause access when needed."
            actions={
              <button
                className="button button-primary"
                onClick={() => setModal("invite")}
              >
                <UserPlus size={16} />
                Add staff
              </button>
            }
          />
          <div className="info-strip">
            <ShieldCheck size={16} />
            <span>
              Staff use secure Manus account sign-in. Password resets are
              managed by the identity provider; this app controls gym roles and
              active status.
            </span>
          </div>
          <section className="panel directory-panel">
            <SectionHeading
              title="Active accounts"
              detail={`${data.staff.length} signed-in accounts`}
            />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ACCOUNT</th>
                    <th>ROLE</th>
                    <th>STATUS</th>
                    <th>LAST SIGN-IN</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.staff.map(staff => (
                    <tr key={staff.id}>
                      <td>
                        <div className="member-cell">
                          <span className="member-avatar burgundy-avatar">
                            {(staff.name ?? staff.email ?? "?").slice(0, 1)}
                          </span>
                          <div>
                            <strong>{staff.name ?? "Unnamed account"}</strong>
                            <small>{staff.email}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <select
                          className="inline-select"
                          value={staff.role === "owner" ? "admin" : staff.role}
                          onChange={event =>
                            updateStaff.mutate(
                              {
                                userId: staff.id,
                                role: event.target.value as
                                  | "receptionist"
                                  | "trainer"
                                  | "member"
                                  | "admin",
                                active: staff.active,
                                linkedMemberId: staff.linkedMemberId,
                              },
                              notify("Role updated")
                            )
                          }
                        >
                          <option value="admin">Admin</option>
                          <option value="receptionist">Receptionist</option>
                          <option value="trainer">Trainer</option>
                          <option value="member">Member</option>
                          <option value="user" disabled>
                            Unassigned
                          </option>
                        </select>
                      </td>
                      <td>
                        <Badge tone={staff.active ? "green" : "red"}>
                          {staff.active ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td>
                        {staff.lastSignedIn
                          ? new Intl.DateTimeFormat("en-IN", {
                              timeZone: "Asia/Kolkata",
                              dateStyle: "medium",
                            }).format(staff.lastSignedIn)
                          : "Never"}
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() =>
                            updateStaff.mutate(
                              {
                                userId: staff.id,
                                role:
                                  staff.role === "owner"
                                    ? "admin"
                                    : (staff.role as
                                        | "receptionist"
                                        | "trainer"
                                        | "member"
                                        | "admin"),
                                active: !staff.active,
                                linkedMemberId: staff.linkedMemberId,
                              },
                              notify(
                                staff.active
                                  ? "Account deactivated"
                                  : "Account activated"
                              )
                            )
                          }
                        >
                          {staff.active ? "Deactivate" : "Activate"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!data.staff.length && (
                    <EmptyRows
                      colSpan={5}
                      text="No user accounts yet. Sign in first, then assign gym access here—or add an email invitation."
                    />
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel directory-panel">
            <SectionHeading
              title="Pending invitations"
              detail="Role assignment is applied when the invited email signs in"
            />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>EMAIL</th>
                    <th>NAME</th>
                    <th>ROLE</th>
                    <th>LINKED MEMBER</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.invites
                    .filter(item => !item.acceptedAt)
                    .map(item => (
                      <tr key={item.id}>
                        <td>{item.email}</td>
                        <td>{item.name || "—"}</td>
                        <td>{roleLabels[item.role]}</td>
                        <td>
                          {members.find(
                            member => member.id === item.linkedMemberId
                          )?.name ?? "—"}
                        </td>
                        <td>
                          <button
                            className="text-button danger-link"
                            onClick={() =>
                              cancelInvite.mutate(
                                { inviteId: item.id },
                                notify("Invitation removed")
                              )
                            }
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  {!data.invites.some(item => !item.acceptedAt) && (
                    <EmptyRows colSpan={5} text="No pending invitations." />
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {view === "settings" && isAdmin && (
        <>
          <HeaderTitle
            kicker="GYM CONFIGURATION"
            title="Set the terms of the desk."
            description="Identity, receipt details and retention windows. Final business rules should be confirmed before launch."
          />
          <div className="settings-grid">
            <form
              className="panel settings-form"
              onSubmit={event => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                saveSettings.mutate(
                  {
                    gymName: String(form.get("gymName")),
                    logoUrl: String(form.get("logoUrl") || ""),
                    address: String(form.get("address") || ""),
                    contactPhone: String(form.get("contactPhone") || ""),
                    contactEmail: String(form.get("contactEmail") || ""),
                    businessDetails: String(form.get("businessDetails") || ""),
                    expiryAlertDays: Number(form.get("expiryAlertDays")),
                    inactiveVisitDays: Number(form.get("inactiveVisitDays")),
                    planDefaults: JSON.stringify({
                      period: String(form.get("defaultPlanPeriod")),
                      durationDays: Number(form.get("defaultPlanDurationDays")),
                    }),
                  },
                  notify("Gym settings saved")
                );
              }}
            >
              <SectionHeading
                title="Gym & receipt identity"
                detail="Used in the member desk and printed receipts"
              />
              <div className="form-grid">
                <Field label="Gym name">
                  <input
                    name="gymName"
                    defaultValue={settings?.gymName ?? "Fit Crush"}
                    required
                  />
                </Field>
                <Field label="Logo URL (optional)">
                  <input
                    type="url"
                    name="logoUrl"
                    defaultValue={settings?.logoUrl ?? ""}
                    placeholder="https://…"
                  />
                </Field>
                <Field label="Address">
                  <input
                    name="address"
                    defaultValue={settings?.address ?? ""}
                  />
                </Field>
                <Field label="Contact phone">
                  <input
                    name="contactPhone"
                    defaultValue={settings?.contactPhone ?? ""}
                  />
                </Field>
                <Field label="Contact email">
                  <input
                    type="email"
                    name="contactEmail"
                    defaultValue={settings?.contactEmail ?? ""}
                  />
                </Field>
                <Field label="Receipt tax / business details">
                  <input
                    name="businessDetails"
                    defaultValue={settings?.businessDetails ?? ""}
                    placeholder="Tax ID or registered details, if applicable"
                  />
                </Field>
              </div>
              <div className="form-divider" />
              <SectionHeading
                title="Retention defaults"
                detail="Tune dashboard alerts for your usual follow-up cadence"
              />
              <div className="form-grid two-fields">
                <Field label="Expiry reminder (days)">
                  <input
                    type="number"
                    name="expiryAlertDays"
                    min="1"
                    max="90"
                    defaultValue={settings?.expiryAlertDays ?? 7}
                  />
                </Field>
                <Field label="No-visit reminder (days)">
                  <input
                    type="number"
                    name="inactiveVisitDays"
                    min="1"
                    max="365"
                    defaultValue={settings?.inactiveVisitDays ?? 14}
                  />
                </Field>
              </div>
              <div className="form-divider" />
              <SectionHeading
                title="New plan defaults"
                detail="Starting values only; each plan can set its own term and price."
              />
              <div className="form-grid two-fields">
                <Field label="Default plan period">
                  <select
                    name="defaultPlanPeriod"
                    defaultValue={planDefaults.period}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="half_yearly">Half-yearly</option>
                    <option value="yearly">Yearly</option>
                    <option value="custom">Custom</option>
                  </select>
                </Field>
                <Field label="Default duration (days)">
                  <input
                    type="number"
                    name="defaultPlanDurationDays"
                    min="1"
                    max="3650"
                    defaultValue={planDefaults.durationDays}
                  />
                </Field>
              </div>
              <div className="form-divider" />
              <div className="setting-defaults">
                <span>TIME ZONE</span>
                <strong>{settings?.timeZone ?? "Asia/Kolkata"}</strong>
                <span>CURRENCY</span>
                <strong>{settings?.currency ?? "INR"} · Indian rupee</strong>
              </div>
              <p className="field-hint">
                This deployment is fixed to Asia/Kolkata and INR, as specified
                in the PRD. Confirm these business defaults before launch.
              </p>
              <div className="form-actions">
                <button
                  className="button button-primary"
                  disabled={saveSettings.isPending}
                >
                  {saveSettings.isPending ? "Saving…" : "Save settings"}
                </button>
              </div>
            </form>
            <aside className="settings-side">
              <div className="panel settings-note">
                <span className="retention-badge">
                  <ShieldCheck size={19} />
                </span>
                <h3>Configured for one branch.</h3>
                <p>
                  Role permissions, dates and receipts are designed for a single
                  gym location. Multi-branch workflows are outside this MVP.
                </p>
              </div>
              <div className="panel settings-note">
                <span className="retention-badge amber-note">
                  <CircleDollarSign size={19} />
                </span>
                <h3>Manual payments only.</h3>
                <p>
                  Cash, UPI and bank receipts are recorded by staff. No online
                  gateway is connected.
                </p>
              </div>
              <button
                className="button button-secondary"
                onClick={() => setView("team")}
              >
                <ShieldCheck size={16} />
                Review staff permissions
              </button>
            </aside>
          </div>
        </>
      )}

      {view === "portal" && role === "member" && (
        <>
          <HeaderTitle
            kicker="MEMBER PORTAL"
            title={`Your training story, ${user.name?.split(" ")[0] ?? "member"}.`}
            description="Your plan, attendance and training history—private to your account."
          />
          {portalExpirySoon && (
            <section className="portal-expiry-notice" role="status">
              <Bell size={19} />
              <div>
                <strong>Membership expiring soon — renew now</strong>
                <span>
                  Your plan ends {prettyDate(portalMembership?.endDate)}. Choose
                  an active plan below to request renewal.
                </span>
              </div>
              <button
                className="button button-primary"
                onClick={() =>
                  document
                    .getElementById("portal-renewal-options")
                    ?.scrollIntoView({ behavior: "smooth", block: "center" })
                }
              >
                Renew now <ChevronRight size={15} />
              </button>
            </section>
          )}
          <div className="portal-layout">
            <section className="panel member-card-large">
              <div className="member-card-top">
                <div>
                  <p className="eyebrow">FIT CRUSH · MEMBER CARD</p>
                  <h2>{members[0]?.name ?? user.name}</h2>
                  <span className="mono-text">
                    {members[0]?.memberCode ?? "MEMBER"}
                  </span>
                </div>
                <span className="qr-seal">
                  <QrCode size={28} />
                </span>
              </div>
              {members[0] && (
                <div className="portal-qr">
                  <QRCodeSVG
                    value={`FITCRUSH|${members[0].memberCode}`}
                    size={116}
                    includeMargin
                    bgColor="#ffffff"
                    fgColor="#15161b"
                  />
                  <small>MEMBER CHECK-IN QR</small>
                </div>
              )}
              <div className="member-card-bottom">
                <span>Membership</span>
                <strong>
                  {portalMembership?.planName ?? "No membership on record"}
                </strong>
                <span>Plan starts</span>
                <strong>
                  {portalMembership
                    ? prettyDate(portalMembership.startDate)
                    : "—"}
                </strong>
                <span>Plan ends</span>
                <strong>
                  {portalMembership
                    ? prettyDate(portalMembership.endDate)
                    : "—"}
                </strong>
                <span>Days left</span>
                <strong>
                  {portalDaysLeft === null
                    ? "—"
                    : portalDaysLeft >= 0
                      ? `${portalDaysLeft} day${portalDaysLeft === 1 ? "" : "s"} left`
                      : `Expired ${Math.abs(portalDaysLeft)} day${Math.abs(portalDaysLeft) === 1 ? "" : "s"} ago`}
                </strong>
                <span>Plan status</span>
                <strong>{portalMembership?.status ?? "No plan"}</strong>
              </div>
            </section>
            <section className="panel portal-attendance">
              <SectionHeading title="Your visits" detail="Latest check-ins" />
              {attendance.length ? (
                <div className="activity-list">
                  {attendance.slice(0, 8).map(row => (
                    <div className="activity-row" key={row.item.id}>
                      <span className="activity-time">
                        {prettyDate(row.item.checkInDate)}
                      </span>
                      <span className="activity-dot" />
                      <div>
                        <strong>
                          {row.item.method === "qr"
                            ? "QR check-in"
                            : "Gym visit"}
                        </strong>
                        <small>
                          {new Intl.DateTimeFormat("en-IN", {
                            timeZone: "Asia/Kolkata",
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(row.item.checkedInAt)}
                        </small>
                        {row.item.checkedOutAt && (
                          <small>
                            Checked out{" "}
                            {new Intl.DateTimeFormat("en-IN", {
                              timeZone: "Asia/Kolkata",
                              hour: "2-digit",
                              minute: "2-digit",
                            }).format(row.item.checkedOutAt)}
                          </small>
                        )}
                      </div>
                      {row.item.checkInDate === today &&
                      !row.item.checkedOutAt ? (
                        <Badge tone="amber">In gym</Badge>
                      ) : (
                        <CheckCircle2 size={16} className="activity-check" />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No visits recorded"
                  message="Your first gym visit will show up here."
                />
              )}
            </section>
          </div>
          <section className="panel portal-live-card">
            <div className="portal-live-count">
              <p className="eyebrow">LIVE GYM FLOOR</p>
              <strong>{liveStatusQuery.data?.liveCount ?? "—"}</strong>
              <span>members currently in the gym</span>
            </div>
            <div className="portal-live-action">
              <span className="live-status-dot" />
              {liveStatusQuery.data?.ownVisit ? (
                <>
                  <div>
                    <strong>You’re checked in</strong>
                    <small>
                      Since{" "}
                      {new Intl.DateTimeFormat("en-IN", {
                        timeZone: "Asia/Kolkata",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(liveStatusQuery.data.ownVisit.checkedInAt)}
                    </small>
                  </div>
                  <button
                    className="button button-secondary"
                    disabled={checkOut.isPending}
                    onClick={() =>
                      liveStatusQuery.data?.ownVisit &&
                      doCheckOut(liveStatusQuery.data.ownVisit.id)
                    }
                  >
                    <LogOut size={15} />
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <strong>Ready to train?</strong>
                    <small>
                      {members[0] && liveMembership(members[0].id)
                        ? "Sign in when you enter the gym."
                        : "An active membership is required to sign in."}
                    </small>
                  </div>
                  <button
                    className="button button-primary"
                    disabled={
                      checkIn.isPending ||
                      !members[0] ||
                      members[0].status !== "active" ||
                      !liveMembership(members[0].id)
                    }
                    onClick={() =>
                      members[0] && void doCheckIn(members[0].memberCode)
                    }
                  >
                    {checkIn.isPending ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <LogIn size={15} />
                    )}
                    Sign in
                  </button>
                </>
              )}
            </div>
            <small className="portal-live-footnote">
              Occupancy is an aggregate count only; other members’ identities
              stay private. This panel refreshes automatically.
            </small>
          </section>
          <section
            id="portal-renewal-options"
            className="panel portal-renewal-panel"
          >
            <SectionHeading
              title="Renew your membership"
              detail="Choose an active plan and send a request to the gym."
            />
            {!pendingRenewalRequest &&
              latestRenewalRequest?.request.status === "cancelled" && (
                <div className="renewal-pending-callout" role="status">
                  <Clock3 size={18} />
                  <div>
                    <strong>Previous request closed — choose an active plan</strong>
                    <span>
                      The plan you requested is no longer active. The gym closed
                      that request; choose a current plan below to submit a new
                      one.
                    </span>
                  </div>
                </div>
              )}
            {pendingRenewalRequest ? (
              <div className="renewal-pending-callout" role="status">
                <Clock3 size={18} />
                <div>
                  <strong>Renewal request awaiting the gym</strong>
                  <span>
                    {pendingRenewalRequest.plan?.name ?? "Selected plan"} ·{" "}
                    {currency(pendingRenewalRequest.plan?.price ?? 0)} · sent{" "}
                    {prettyDate(pendingRenewalRequest.request.requestedAt)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="portal-plan-options">
                {plans
                  .filter(plan => plan.active)
                  .map(plan => (
                    <article className="portal-plan-option" key={plan.id}>
                      <div>
                        <strong>{plan.name}</strong>
                        <span>
                          {planPeriodLabels[plan.period] ?? "Membership"} ·{" "}
                          {plan.durationDays} days
                        </span>
                      </div>
                      <strong className="portal-plan-price">
                        {currency(plan.price)}
                      </strong>
                      <button
                        className="button button-secondary"
                        disabled={requestRenewal.isPending}
                        onClick={() =>
                          requestRenewal.mutate(
                            { planId: plan.id },
                            {
                              onSuccess: () => {
                                toast.success(
                                  "Renewal request sent. The gym will review it and process any manual payment or agreed due."
                                );
                                refresh();
                              },
                              onError: error => toast.error(error.message),
                            }
                          )
                        }
                      >
                        {requestRenewal.isPending ? "Sending…" : "Request plan"}
                      </button>
                    </article>
                  ))}
                {!plans.some(plan => plan.active) && (
                  <EmptyState
                    title="No active plans available"
                    message="Contact the gym for renewal options."
                  />
                )}
              </div>
            )}
            <p className="field-hint">
              Payments are recorded manually by the gym. A request does not
              charge you or activate a new term. Staff review it and record any
              agreed manual payment or due when processing the renewal.
            </p>
            {renewalRequests.some(
              item => item.request.status === "fulfilled"
            ) && (
              <div className="portal-renewal-history">
                <strong>Recent renewal requests</strong>
                {renewalRequests
                  .filter(item => item.request.status === "fulfilled")
                  .slice(0, 3)
                  .map(item => (
                    <span key={item.request.id}>
                      {item.plan?.name ?? "Membership"} · processed{" "}
                      {prettyDate(item.request.handledAt)}
                    </span>
                  ))}
              </div>
            )}
          </section>
          <section className="panel directory-panel">
            <SectionHeading title="Your receipts" detail="Payment history" />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>RECEIPT</th>
                    <th>DATE</th>
                    <th>MODE</th>
                    <th>AMOUNT</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {payments
                    .filter(row => row.payment.status === "posted")
                    .map(row => (
                      <tr key={row.payment.id}>
                        <td className="mono-text">
                          {row.payment.receiptNumber}
                        </td>
                        <td>{prettyDate(row.payment.recordedAt)}</td>
                        <td>{paymentModes[row.payment.mode]}</td>
                        <td className="amount-cell">
                          {currency(row.payment.amount)}
                        </td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => receiptFor(row)}
                          >
                            <Download size={15} />
                            Receipt
                          </button>
                        </td>
                      </tr>
                    ))}
                  {!payments.some(row => row.payment.status === "posted") && (
                    <EmptyRows colSpan={5} text="No payments on record." />
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <div className="info-strip">
            <ShieldCheck size={16} />
            <span>
              Privacy notice: your profile, visits, receipts and
              fitness/coaching notes are used to manage membership and training.
              Access is limited to authorized gym staff; this portal shows only
              your linked account. For a correction or privacy question, contact{" "}
              {settings?.contactEmail || settings?.contactPhone || "the gym"}.
              The gym must confirm its retention policy before launch.
            </span>
          </div>
          <div className="training-grid">
            <section className="panel">
              <SectionHeading
                title="Assigned workouts"
                detail="Your current training schedule"
              />
              {data.workouts.length ? (
                data.workouts.map(workout => (
                  <article className="portal-workout" key={workout.id}>
                    <span className="workout-icon">
                      <Dumbbell size={17} />
                    </span>
                    <div>
                      <strong>{workout.title}</strong>
                      <small>{prettyDate(workout.workoutDate)}</small>
                      <p>{workout.exercises}</p>
                      {workout.dietNotes && (
                        <small>Coach notes: {workout.dietNotes}</small>
                      )}
                    </div>
                  </article>
                ))
              ) : (
                <EmptyState
                  title="No workout assigned yet"
                  message="Your trainer will add a plan when it is ready."
                />
              )}
            </section>
            <section className="panel">
              <SectionHeading
                title="Progress history"
                detail="Entries shared by your trainer"
              />
              {data.progress.length ? (
                data.progress.map(item => (
                  <div className="compact-row" key={item.id}>
                    <span className="workout-icon">
                      <Activity size={17} />
                    </span>
                    <div className="compact-main">
                      <strong>
                        {item.weightKg} kg · BMI{" "}
                        {(() => {
                          const heightM =
                            Number(members[0]?.heightCm ?? 0) / 100;
                          return heightM > 0
                            ? (
                                Number(item.weightKg) /
                                (heightM * heightM)
                              ).toFixed(1)
                            : "—";
                        })()}
                      </strong>
                      <small>
                        {prettyDate(item.entryDate)} ·{" "}
                        {item.notes || "Progress entry"}
                      </small>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState
                  title="Nothing to chart yet"
                  message="Progress entries from your trainer will appear here."
                />
              )}
              <p className="field-hint progress-disclaimer">
                BMI is a basic height/weight reference only, not medical advice
                or a diagnosis.
              </p>
            </section>
          </div>
        </>
      )}

      {modal === "member" && (
        <Modal
          open
          title={selectedMember ? "Edit member profile" : "Register a member"}
          description="Capture the essentials. A duplicate phone is flagged for review, never auto-merged."
          onClose={() => setModal(null)}
          wide
        >
          <form
            className="form-grid"
            onSubmit={async event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const payload = {
                name: String(form.get("name")),
                phone: String(form.get("phone")),
                email: String(form.get("email") || ""),
                joiningDate: String(form.get("joiningDate")),
                dateOfBirth: String(form.get("dateOfBirth") || ""),
                emergencyContact: String(form.get("emergencyContact") || ""),
                fitnessGoal: String(form.get("fitnessGoal") || ""),
                heightCm: form.get("heightCm")
                  ? Number(form.get("heightCm"))
                  : undefined,
                photoUrl: String(form.get("photoUrl") || ""),
                status: String(form.get("status") || "active") as
                  | "active"
                  | "inactive"
                  | "frozen",
                trainerId: form.get("trainerId")
                  ? Number(form.get("trainerId"))
                  : null,
              };
              try {
                if (selectedMember) {
                  const saved = await saveMember.mutateAsync({
                    ...payload,
                    id: selectedMember.id,
                  });
                  if (saved.duplicatePhones.length)
                    toast.warning(
                      `Phone number matches ${saved.duplicatePhones.map(item => item.name).join(", ")}. Review before continuing.`
                    );
                  setModal(null);
                  toast.success("Member profile updated");
                  refresh();
                  return;
                }

                const planId = form.get("planId")
                  ? Number(form.get("planId"))
                  : undefined;
                const firstPayment = Number(form.get("firstPayment") || 0);
                const mode = String(form.get("mode") || "cash") as
                  | "cash"
                  | "upi"
                  | "bank";
                const notes = "Registration payment";
                const registration = await registerMember.mutateAsync({
                  ...payload,
                  status: payload.status === "inactive" ? "inactive" : "active",
                  planId,
                  discount: Number(form.get("discount") || 0),
                  firstPayment,
                  mode,
                  notes,
                });
                if (registration.duplicatePhones.length)
                  toast.warning(
                    `Phone number matches ${registration.duplicatePhones.map(item => item.name).join(", ")}. Review before continuing.`
                  );
                if (registration.receipt && registration.membershipId) {
                  setSelectedPayment({
                    payment: {
                      id: registration.receipt.id,
                      receiptNumber: registration.receipt.receiptNumber,
                      memberId: registration.id,
                      membershipId: registration.membershipId,
                      amount: firstPayment,
                      mode,
                      notes,
                      status: "posted",
                      correctionReason: null,
                      correctedBy: null,
                      correctedAt: null,
                      recordedBy: user!.id,
                      recordedAt: registration.receipt.recordedAt,
                    },
                    memberName: payload.name,
                    memberCode: registration.memberCode,
                  } as PaymentRow);
                  setModal("receipt");
                } else setModal(null);
                toast.success("Member registered");
                refresh();
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Could not save member"
                );
              }
            }}
          >
            <Field label="Full name">
              <input
                name="name"
                defaultValue={selectedMember?.name ?? ""}
                required
                autoFocus
              />
            </Field>
            <Field label="Mobile number">
              <input
                name="phone"
                defaultValue={selectedMember?.phone ?? ""}
                required
                inputMode="tel"
              />
            </Field>
            <Field label="Email (optional)">
              <input
                name="email"
                type="email"
                defaultValue={selectedMember?.email ?? ""}
              />
            </Field>
            <Field label="Joining date">
              <input
                type="date"
                name="joiningDate"
                defaultValue={selectedMember?.joiningDate ?? today}
                required
              />
            </Field>
            <Field label="Date of birth (optional)">
              <input
                type="date"
                name="dateOfBirth"
                defaultValue={selectedMember?.dateOfBirth ?? ""}
              />
            </Field>
            <Field label="Emergency contact">
              <input
                name="emergencyContact"
                defaultValue={selectedMember?.emergencyContact ?? ""}
                placeholder="Name · phone"
              />
            </Field>
            <Field label="Fitness goal">
              <input
                name="fitnessGoal"
                defaultValue={selectedMember?.fitnessGoal ?? ""}
                placeholder="Strength, consistency…"
              />
            </Field>
            <Field label="Height (cm)">
              <input
                type="number"
                name="heightCm"
                min="50"
                max="260"
                step="0.1"
                defaultValue={selectedMember?.heightCm ?? ""}
              />
            </Field>
            <Field label="Trainer">
              <select
                name="trainerId"
                defaultValue={selectedMember?.trainerId ?? ""}
              >
                <option value="">Not assigned</option>
                {data.staff
                  .filter(item => item.role === "trainer" && item.active)
                  .map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name ?? item.email}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Profile photo URL (optional)">
              <input
                name="photoUrl"
                type="url"
                defaultValue={selectedMember?.photoUrl ?? ""}
                placeholder="https://…"
              />
            </Field>
            <Field label="Status">
              <select
                name="status"
                defaultValue={selectedMember?.status ?? "active"}
                disabled={selectedMember?.status === "frozen"}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                {selectedMember?.status === "frozen" && (
                  <option value="frozen">Frozen</option>
                )}
              </select>
            </Field>
            {!selectedMember && (
              <div className="form-section-span registration-plan">
                <div className="form-section-title">
                  <span>02</span>
                  <div>
                    <strong>Membership & first payment</strong>
                    <small>
                      Select a plan to activate the new member now. Payment can
                      be partial.
                    </small>
                  </div>
                </div>
                {plans.filter(plan => plan.active).length ? (
                  <div className="form-grid">
                    <Field label="Membership plan">
                      <select name="planId" defaultValue="">
                        <option value="">Add membership later</option>
                        {plans
                          .filter(plan => plan.active)
                          .map(plan => (
                            <option key={plan.id} value={plan.id}>
                              {plan.name} · {currency(plan.price)} ·{" "}
                              {plan.durationDays} days
                            </option>
                          ))}
                      </select>
                    </Field>
                    {isAdmin && (
                      <Field label="Discount (₹)">
                        <input
                          type="number"
                          name="discount"
                          min="0"
                          defaultValue="0"
                        />
                      </Field>
                    )}
                    <Field label="First payment (₹)">
                      <input
                        type="number"
                        name="firstPayment"
                        min="0"
                        defaultValue="0"
                      />
                    </Field>
                    <Field label="Payment mode">
                      <select name="mode">
                        <option value="cash">Cash</option>
                        <option value="upi">UPI</option>
                        <option value="bank">Bank transfer</option>
                      </select>
                    </Field>
                  </div>
                ) : (
                  <p className="empty-inline">
                    Create a plan first. You can still save this member and
                    assign a plan later.
                  </p>
                )}
              </div>
            )}
            <div className="form-actions form-section-span">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                disabled={
                  saveMember.isPending ||
                  registerMember.isPending ||
                  assignMembership.isPending
                }
              >
                {saveMember.isPending ||
                registerMember.isPending ||
                assignMembership.isPending ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Check size={15} />
                )}
                {selectedMember ? "Save profile" : "Register member"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "plan" && (
        <Modal
          open
          title={
            selectedPlan ? "Edit membership plan" : "Create a membership plan"
          }
          description="Plan durations and pricing are gym-defined. Existing memberships retain their saved terms."
          onClose={() => {
            setModal(null);
            setSelectedPlan(null);
          }}
        >
          <form
            className="form-grid"
            onSubmit={event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              savePlan.mutate(
                {
                  ...(selectedPlan ? { id: selectedPlan.id } : {}),
                  name: String(form.get("name")),
                  period: String(form.get("period")) as
                    | "monthly"
                    | "quarterly"
                    | "half_yearly"
                    | "yearly"
                    | "custom",
                  durationDays: Number(form.get("durationDays")),
                  price: Number(form.get("price")),
                  description: String(form.get("description") || ""),
                  active: form.get("active") === "on",
                },
                {
                  ...notify(selectedPlan ? "Plan updated" : "Plan created"),
                  onSuccess: () => {
                    toast.success(
                      selectedPlan ? "Plan updated" : "Plan created"
                    );
                    refresh();
                    setModal(null);
                    setSelectedPlan(null);
                  },
                }
              );
            }}
          >
            <Field label="Plan name">
              <input
                name="name"
                defaultValue={selectedPlan?.name ?? ""}
                required
                autoFocus
              />
            </Field>
            <Field label="Plan type">
              <select
                name="period"
                defaultValue={selectedPlan?.period ?? planDefaults.period}
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="half_yearly">Half-yearly</option>
                <option value="yearly">Yearly</option>
                <option value="custom">Custom</option>
              </select>
            </Field>
            <Field label="Duration (days)">
              <input
                type="number"
                name="durationDays"
                min="1"
                max="3650"
                defaultValue={
                  selectedPlan?.durationDays ?? planDefaults.durationDays
                }
                required
              />
            </Field>
            <Field label="Price (₹)">
              <input
                type="number"
                name="price"
                min="0"
                defaultValue={selectedPlan?.price ?? ""}
                required
              />
            </Field>
            <Field label="Description">
              <textarea
                name="description"
                rows={3}
                defaultValue={selectedPlan?.description ?? ""}
              />
            </Field>
            <label className="checkbox-row form-section-span">
              <input
                name="active"
                type="checkbox"
                defaultChecked={selectedPlan?.active ?? true}
              />
              Make this plan available for new memberships
            </label>
            <div className="form-actions form-section-span">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                disabled={savePlan.isPending}
              >
                <Check size={15} />
                Save plan
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "renew" && selectedMember && (
        <Modal
          open
          title="Assign or renew a plan"
          description={`${selectedMember.name} · ${selectedMember.memberCode} · previous membership history stays intact.${selectedRenewalRequestId ? " Complete the portal request and record any manual payment here." : ""}`}
          onClose={() => {
            setModal(null);
            setSelectedRenewalRequestId(null);
            setSelectedPlan(null);
          }}
        >
          <form
            className="form-grid"
            onSubmit={event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              assignMembership.mutate(
                {
                  memberId: selectedMember.id,
                  planId: Number(form.get("planId")),
                  ...(selectedRenewalRequestId
                    ? { renewalRequestId: selectedRenewalRequestId }
                    : {}),
                  startDate: String(form.get("startDate")),
                  discount: Number(form.get("discount") || 0),
                  firstPayment: Number(form.get("firstPayment") || 0),
                  mode: String(form.get("mode")) as "cash" | "upi" | "bank",
                  notes: String(form.get("notes") || ""),
                },
                {
                  onSuccess: result => {
                    toast.success(
                      `Membership saved through ${prettyDate(result.endDate)}`
                    );
                    refresh();
                    setModal(null);
                    setSelectedRenewalRequestId(null);
                    setSelectedPlan(null);
                  },
                  onError: error => toast.error(error.message),
                }
              );
            }}
          >
            <Field label="Membership plan">
              <select
                name="planId"
                required
                defaultValue={selectedPlan?.id ?? ""}
              >
                <option value="" disabled>
                  Select a plan
                </option>
                {plans
                  .filter(plan => plan.active)
                  .map(plan => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} · {currency(plan.price)}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Start date">
              <input
                name="startDate"
                type="date"
                defaultValue={(() => {
                  const current = liveMembership(selectedMember.id);
                  return current ? addDate(current.endDate, 1) : today;
                })()}
                required
              />
            </Field>
            {isAdmin && (
              <Field label="Discount (₹)">
                <input type="number" name="discount" min="0" defaultValue="0" />
              </Field>
            )}
            <Field label="Amount paid now (₹)">
              <input
                type="number"
                name="firstPayment"
                min="0"
                defaultValue="0"
              />
            </Field>
            <Field label="Payment mode">
              <select name="mode">
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="bank">Bank transfer</option>
              </select>
            </Field>
            <Field label="Note">
              <input name="notes" placeholder="Optional receipt note" />
            </Field>
            <p className="field-hint form-section-span">
              If the current validity overlaps this start date, only an admin
              can override it.
            </p>
            <div className="form-actions form-section-span">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                disabled={assignMembership.isPending}
              >
                <Check size={15} />
                {selectedRenewalRequestId
                  ? "Complete renewal request"
                  : "Save membership"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "payment" && (
        <Modal
          open
          title="Record a payment"
          description="Manual collection · Cash, UPI or bank · A sequential receipt will be created."
          onClose={() => setModal(null)}
        >
          <form
            className="form-grid"
            onSubmit={event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              savePayment.mutate(
                {
                  memberId: Number(form.get("memberId")),
                  membershipId: form.get("membershipId")
                    ? Number(form.get("membershipId"))
                    : undefined,
                  amount: Number(form.get("amount")),
                  mode: String(form.get("mode")) as "cash" | "upi" | "bank",
                  notes: String(form.get("notes") || ""),
                },
                {
                  onSuccess: result => {
                    toast.success(`Receipt ${result.receiptNumber} issued`);
                    refresh();
                    setModal(null);
                    const member = members.find(
                      item => item.id === Number(form.get("memberId"))
                    );
                    if (member) {
                      setSelectedPayment({
                        payment: {
                          ...result,
                          memberId: member.id,
                          membershipId:
                            Number(form.get("membershipId")) || null,
                          amount: Number(form.get("amount")),
                          mode: String(form.get("mode")) as
                            | "cash"
                            | "upi"
                            | "bank",
                          notes: String(form.get("notes") || "") || null,
                          status: "posted",
                          correctionReason: null,
                          correctedBy: null,
                          correctedAt: null,
                          recordedBy: user.id,
                        },
                        memberName: member.name,
                        memberCode: member.memberCode,
                      } as PaymentRow);
                      setModal("receipt");
                    }
                  },
                  onError: error => toast.error(error.message),
                }
              );
            }}
          >
            <Field label="Member">
              <select
                name="memberId"
                required
                defaultValue={selectedMember?.id ?? ""}
                onChange={event => {
                  const m = members.find(
                    member => member.id === Number(event.target.value)
                  );
                  setSelectedMember(m ?? null);
                }}
              >
                <option value="" disabled>
                  Choose member
                </option>
                {members.map(member => (
                  <option key={member.id} value={member.id}>
                    {member.name} · {member.memberCode}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Apply to membership">
              <select
                name="membershipId"
                defaultValue={
                  liveMembership(selectedMember?.id ?? -1)?.id ?? ""
                }
              >
                <option value="">General payment / no due link</option>
                {memberships
                  .filter(
                    item =>
                      item.memberId === selectedMember?.id &&
                      item.status !== "cancelled"
                  )
                  .map(item => (
                    <option key={item.id} value={item.id}>
                      {item.planName} · due {currency(duesFor(item.id))}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Amount received (₹)">
              <input type="number" name="amount" min="1" required />
            </Field>
            <Field label="Payment mode">
              <select name="mode">
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="bank">Bank transfer</option>
              </select>
            </Field>
            <Field label="Receipt note">
              <input name="notes" placeholder="Optional" />
            </Field>
            <div className="form-actions form-section-span">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                disabled={savePayment.isPending}
              >
                <ReceiptIcon />
                Record & issue receipt
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "expense" && (
        <Modal
          open
          title="Record a gym expense"
          description="Owner-only finance record · INR."
          onClose={() => setModal(null)}
        >
          <form
            className="form-grid"
            onSubmit={event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              saveExpense.mutate(
                {
                  expenseDate: String(form.get("expenseDate")),
                  category: String(form.get("category")),
                  amount: Number(form.get("amount")),
                  description: String(form.get("description") || ""),
                },
                {
                  ...notify("Expense recorded"),
                  onSuccess: () => {
                    toast.success("Expense recorded");
                    refresh();
                    setModal(null);
                  },
                }
              );
            }}
          >
            <Field label="Expense date">
              <input type="date" name="expenseDate" defaultValue={today} />
            </Field>
            <Field label="Category">
              <select name="category">
                <option>Utilities</option>
                <option>Equipment</option>
                <option>Rent</option>
                <option>Payroll</option>
                <option>Repairs</option>
                <option>Supplies</option>
                <option>Other</option>
              </select>
            </Field>
            <Field label="Amount (₹)">
              <input type="number" name="amount" min="1" required />
            </Field>
            <Field label="Description">
              <input name="description" placeholder="Optional detail" />
            </Field>
            <div className="form-actions form-section-span">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button className="button button-primary">
                <Check size={15} />
                Save expense
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "workout" && (
        <Modal
          open
          title="Assign a workout"
          description="Simple training schedule and notes. Avoid medical claims or prescription language."
          onClose={() => setModal(null)}
          wide
        >
          <form
            className="form-grid"
            onSubmit={event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              saveWorkout.mutate(
                {
                  memberId: Number(form.get("memberId")),
                  workoutDate: String(form.get("workoutDate")),
                  title: String(form.get("title")),
                  exercises: String(form.get("exercises") || ""),
                  dietNotes: String(form.get("dietNotes") || ""),
                },
                {
                  ...notify("Workout assigned"),
                  onSuccess: () => {
                    toast.success("Workout assigned");
                    refresh();
                    setModal(null);
                  },
                }
              );
            }}
          >
            <Field label="Assigned member">
              <select
                name="memberId"
                required
                defaultValue={selectedMember?.id ?? ""}
              >
                <option value="" disabled>
                  Choose a member
                </option>
                {members.map(member => (
                  <option key={member.id} value={member.id}>
                    {member.name} · {member.memberCode}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Session date">
              <input
                type="date"
                name="workoutDate"
                defaultValue={today}
                required
              />
            </Field>
            <Field label="Workout title">
              <input name="title" placeholder="Strength · Day 1" required />
            </Field>
            <Field label="Exercises / schedule">
              <textarea
                name="exercises"
                rows={5}
                placeholder="Movement · sets × reps\nKeep notes simple and member-friendly."
              />
            </Field>
            <Field label="Diet / coaching notes">
              <textarea
                name="dietNotes"
                rows={4}
                placeholder="Optional supportive note. No medical advice."
              />
            </Field>
            <div className="form-actions form-section-span">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button className="button button-primary">
                <Dumbbell size={15} />
                Assign workout
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "progress" && (
        <Modal
          open
          title="Log member progress"
          description="Record weight and a non-medical coaching note."
          onClose={() => setModal(null)}
        >
          <form
            className="form-grid"
            onSubmit={event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              saveProgress.mutate(
                {
                  memberId: Number(form.get("memberId")),
                  entryDate: String(form.get("entryDate")),
                  weightKg: Number(form.get("weightKg")),
                  notes: String(form.get("notes") || ""),
                },
                {
                  ...notify("Progress entry saved"),
                  onSuccess: () => {
                    toast.success("Progress entry saved");
                    refresh();
                    setModal(null);
                  },
                }
              );
            }}
          >
            <Field label="Member">
              <select
                name="memberId"
                required
                defaultValue={selectedMember?.id ?? ""}
              >
                <option value="" disabled>
                  Choose a member
                </option>
                {members.map(member => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date">
              <input type="date" name="entryDate" defaultValue={today} />
            </Field>
            <Field label="Weight (kg)">
              <input
                type="number"
                name="weightKg"
                step="0.1"
                min="20"
                max="500"
                required
              />
            </Field>
            <Field label="Notes">
              <textarea
                name="notes"
                rows={3}
                placeholder="Optional coaching context"
              />
            </Field>
            <div className="form-actions form-section-span">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button className="button button-primary">
                <Activity size={15} />
                Save progress
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "invite" && (
        <Modal
          open
          title="Add a staff or member account"
          description="Assign a role to a signed-in account or pre-authorize an email for its first sign-in."
          onClose={() => setModal(null)}
        >
          <form
            className="form-grid"
            onSubmit={event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              inviteStaff.mutate(
                {
                  email: String(form.get("email")),
                  name: String(form.get("name") || ""),
                  role: String(form.get("role")) as
                    | "receptionist"
                    | "trainer"
                    | "member",
                  linkedMemberId: form.get("linkedMemberId")
                    ? Number(form.get("linkedMemberId"))
                    : null,
                },
                {
                  onSuccess: result => {
                    toast.success(
                      result.status === "assigned"
                        ? "Gym role assigned"
                        : "Invitation saved. Share the sign-in details with this person."
                    );
                    refresh();
                    setModal(null);
                  },
                  onError: error => toast.error(error.message),
                }
              );
            }}
          >
            <Field label="Email">
              <input type="email" name="email" required autoFocus />
            </Field>
            <Field label="Display name">
              <input name="name" />
            </Field>
            <Field label="Role">
              <select name="role">
                <option value="receptionist">Receptionist</option>
                <option value="trainer">Trainer</option>
                <option value="member">Member</option>
              </select>
            </Field>
            <Field label="Link member profile (for member role)">
              <select name="linkedMemberId">
                <option value="">No profile link</option>
                {members.map(member => (
                  <option value={member.id} key={member.id}>
                    {member.name} · {member.memberCode}
                  </option>
                ))}
              </select>
            </Field>
            <p className="field-hint form-section-span">
              No email or password is sent by this application. The account
              holder signs in with their Manus identity provider.
            </p>
            <div className="form-actions form-section-span">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button className="button button-primary">
                <UserPlus size={15} />
                Save role assignment
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "fingerprint" && selectedMember && (
        <FingerprintModal
          member={selectedMember}
          isAdmin={isAdmin}
          onClose={() => setModal(null)}
        />
      )}

      {modal === "qr" && selectedMember && (
        <Modal
          open
          title="Member check-in QR"
          description={`${selectedMember.name} · ${selectedMember.memberCode}`}
          onClose={() => setModal(null)}
        >
          <div className="qr-modal-content">
            <div className="qr-paper">
              <QRCodeSVG
                value={`FITCRUSH|${selectedMember.memberCode}`}
                size={220}
                includeMargin
                bgColor="#fff"
                fgColor="#14151a"
              />
            </div>
            <strong>{selectedMember.name}</strong>
            <span className="mono-text">{selectedMember.memberCode}</span>
            <p>
              Use the front-desk camera or search by member ID if scanning is
              unavailable.
            </p>
            <button
              className="button button-secondary"
              onClick={() => window.print()}
            >
              <Printer size={15} />
              Print QR card
            </button>
          </div>
        </Modal>
      )}

      {modal === "receipt" && selectedPayment && (
        <Modal
          open
          title="Receipt issued"
          description="A payment record and sequential receipt are saved."
          onClose={() => setModal(null)}
        >
          <div className="receipt-preview">
            {settings?.logoUrl?.toLowerCase().startsWith("https://") && (
              <img
                className="receipt-gym-logo"
                src={settings.logoUrl}
                alt=""
                referrerPolicy="no-referrer"
              />
            )}
            <div className="receipt-check">
              <Check size={19} />
            </div>
            <p className="eyebrow">PAYMENT RECEIVED</p>
            <strong>{selectedPayment.payment.receiptNumber}</strong>
            <b>{currency(selectedPayment.payment.amount)}</b>
            <span>
              {selectedPayment.memberName} · {selectedPayment.memberCode}
            </span>
            <small>
              {paymentModes[selectedPayment.payment.mode]} ·{" "}
              {prettyDate(selectedPayment.payment.recordedAt)}
            </small>
            <button
              className="button button-primary button-wide"
              onClick={() => receiptFor(selectedPayment)}
            >
              <Printer size={16} />
              Print / Save as PDF
            </button>
            <button className="text-button" onClick={() => setModal(null)}>
              Back to the desk
            </button>
          </div>
        </Modal>
      )}

      {modal === "freeze" && selectedMember && (
        <Modal
          open
          title="Freeze membership"
          description={`${selectedMember.name} · This change is audit logged.`}
          onClose={() => setModal(null)}
        >
          <form
            className="form-grid"
            onSubmit={event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const current =
                liveMembership(selectedMember.id) ??
                latestMembership(selectedMember.id);
              if (!current) {
                toast.error("No membership found to freeze");
                return;
              }
              freezeMutation.mutate(
                {
                  membershipId: current.id,
                  reason: String(form.get("reason")),
                },
                {
                  ...notify("Membership frozen"),
                  onSuccess: () => {
                    toast.success("Membership frozen");
                    refresh();
                    setModal(null);
                  },
                }
              );
            }}
          >
            <Field label="Reason">
              <textarea name="reason" rows={3} required minLength={3} />
            </Field>
            <div className="form-actions form-section-span">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button className="button button-primary">
                <Check size={15} />
                Freeze membership
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "reactivate" && selectedMember && (
        <Modal
          open
          title="Reactivate membership"
          description={`${selectedMember.name} · choose any extension only after confirming the gym's freeze rule.`}
          onClose={() => setModal(null)}
        >
          <form
            className="form-grid"
            onSubmit={event => {
              event.preventDefault();
              const membership = latestMembership(selectedMember.id);
              if (!membership || membership.status !== "frozen") {
                toast.error("No frozen membership found to reactivate");
                return;
              }
              const form = new FormData(event.currentTarget);
              reactivateMutation.mutate(
                {
                  membershipId: membership.id,
                  extensionDays: Number(form.get("extensionDays")),
                  reason: String(form.get("reason")),
                },
                {
                  onSuccess: result => {
                    toast.success(
                      `Membership updated through ${prettyDate(result.endDate)}`
                    );
                    refresh();
                    setModal(null);
                  },
                  onError: error => toast.error(error.message),
                }
              );
            }}
          >
            <Field label="Extension days (confirm gym policy)">
              <input
                type="number"
                name="extensionDays"
                min="0"
                max="365"
                defaultValue="0"
                required
              />
            </Field>
            <Field label="Reactivation reason">
              <textarea name="reason" rows={3} minLength={3} required />
            </Field>
            <p className="field-hint form-section-span">
              The new end date and reason are audit logged. An expired term
              remains expired if no extension brings it into validity.
            </p>
            <div className="form-actions form-section-span">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                disabled={reactivateMutation.isPending}
              >
                <Check size={15} />
                Reactivate
              </button>
            </div>
          </form>
        </Modal>
      )}

      <footer className="app-footer">
        <span>FIT CRUSH GYM MANAGEMENT SOFTWARE · SINGLE BRANCH</span>
        <span>India Standard Time · INR</span>
      </footer>
    </GymShell>
  );
}

function addDate(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
function ReceiptIcon() {
  return <FileText size={15} />;
}

function FollowupRow({
  member,
  title,
  trigger,
  endDate,
  follow,
  status,
  note,
  onStatus,
  onNote,
  onSave,
  onRenew,
}: {
  member: Member;
  title: string;
  trigger: "expiring" | "inactive";
  endDate?: string;
  follow?: Boot["followUps"][number];
  status?: "pending" | "contacted" | "follow_up";
  note?: string;
  onStatus: (status: "pending" | "contacted" | "follow_up") => void;
  onNote: (note: string) => void;
  onSave: () => void;
  onRenew: () => void;
}) {
  const selectedStatus = status ?? follow?.status ?? "pending";
  return (
    <article className="followup-row">
      <div className="followup-main">
        <span className="member-avatar amber-avatar">
          {member.name.slice(0, 1)}
        </span>
        <div className="followup-name">
          <strong>{member.name}</strong>
          <small>
            {member.memberCode} · {title}
            {endDate ? ` · ends ${prettyDate(endDate)}` : ""}
          </small>
        </div>
        <Badge
          tone={
            selectedStatus === "contacted"
              ? "green"
              : selectedStatus === "follow_up"
                ? "amber"
                : "neutral"
          }
        >
          {selectedStatus.replace("_", " ")}
        </Badge>
      </div>
      <div className="followup-controls">
        <select
          value={selectedStatus}
          onChange={event =>
            onStatus(
              event.target.value as "pending" | "contacted" | "follow_up"
            )
          }
        >
          <option value="pending">Pending</option>
          <option value="contacted">Contacted</option>
          <option value="follow_up">Follow-up needed</option>
        </select>
        <input
          value={note ?? follow?.notes ?? ""}
          onChange={event => onNote(event.target.value)}
          placeholder="Add a note for the next staff member"
        />
        <button className="button button-secondary button-sm" onClick={onSave}>
          <Check size={14} />
          Save
        </button>
        {trigger === "expiring" && (
          <button className="text-button" onClick={onRenew}>
            Renew
          </button>
        )}
      </div>
    </article>
  );
}
