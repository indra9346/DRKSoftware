// Fingerprint machine screens: machine management, WhatsApp alerts and the member fingerprint panel.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Ban,
  Check,
  Cpu,
  DoorOpen,
  Download,
  Fingerprint,
  LoaderCircle,
  MessageCircle,
  MonitorPlay,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { trpc } from "@/lib/trpc";
import { Field, Modal } from "./Modal";

type Out = inferRouterOutputs<AppRouter>["biometric"];
type Settings = Out["overview"]["settings"];
type Tone = "neutral" | "green" | "amber" | "red";

const ist = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", ...opts });
const fmtDateTime = (d: Date | string | null | undefined) =>
  d
    ? ist({
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(d))
    : "—";
const fmtTime = (d: Date | string | null | undefined) =>
  d ? ist({ hour: "2-digit", minute: "2-digit" }).format(new Date(d)) : "—";
const ago = (d: Date | string | null | undefined) => {
  if (!d) return "never";
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span className={`status-badge badge-${tone}`}>
      <i />
      {children}
    </span>
  );
}

function Heading({
  kicker,
  title,
  description,
  actions,
}: {
  kicker: string;
  title: string;
  description?: string;
  actions?: ReactNode;
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

function Section({
  title,
  detail,
  action,
  children,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          {detail && <p>{detail}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export const reasonTone = (
  allowed: boolean | null | undefined,
  reason?: string | null
): Tone =>
  allowed === null || allowed === undefined
    ? "neutral"
    : !allowed
      ? "red"
      : reason === "expiring" || reason === "ends_today"
        ? "amber"
        : "green";

const KIND_LABEL: Record<string, string> = {
  user_allow: "Allow member",
  user_block: "Block member",
  user_remove: "Remove member",
  finger_restore: "Restore fingerprint",
  finger_backup: "Back up fingerprint",
  enroll: "Enrol finger",
  message: "Screen message",
  info: "Read machine info",
  check: "Re-check settings",
  reboot: "Restart machine",
  unlock: "Open door",
  upload_all: "Upload users & fingerprints",
  upload_logs: "Upload last 7 days of punches",
};

const BLOCK_MODES = [
  {
    mode: "fingers",
    title: "Remove fingerprints (recommended)",
    text: "Member stays on the machine; fingerprints, card and keypad password are taken off and restored from the backup on renewal. Works on every ADMS machine.",
  },
  {
    mode: "remove",
    title: "Remove the member from the machine",
    text: "Deletes the user on the machine; restored with fingerprints on renewal.",
  },
  {
    mode: "group",
    title: "Blocked access group (test first)",
    text: "Keeps fingerprints; moves the member to an access group with no allowed time. Only if the firmware enforces groups.",
  },
] as const;

const FINGERS = [
  "Left little",
  "Left ring",
  "Left middle",
  "Left index",
  "Left thumb",
  "Right thumb",
  "Right index",
  "Right middle",
  "Right ring",
  "Right little",
];

// ---------------------------------------------------------------- machine view

export function MachineView() {
  const utils = trpc.useUtils();
  const q = trpc.biometric.overview.useQuery(undefined, {
    refetchInterval: 10_000,
  });
  const action = trpc.biometric.machineAction.useMutation();
  const [approve, setApprove] = useState<string | null>(null);
  const [linkSn, setLinkSn] = useState<string | null>(null);
  const run = async (
    input: Parameters<typeof action.mutateAsync>[0],
    ok: string
  ) => {
    try {
      const r = await action.mutateAsync(input);
      const q2 =
        r &&
        "result" in r &&
        r.result &&
        typeof r.result === "object" &&
        "queued" in r.result
          ? ` · ${r.result.queued} update(s) queued`
          : "";
      toast.success(ok + q2);
      await utils.biometric.invalidate();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  if (q.isLoading) return <p className="muted-inline">Loading…</p>;
  if (!q.data)
    return (
      <p className="muted-inline">
        {q.error?.message ?? "Could not load the machine page."}
      </p>
    );
  const d = q.data;

  return (
    <>
      <Heading
        kicker="FINGERPRINT MACHINE"
        title="The door knows who's paid."
        description="eSSL / ZKTeco machines connect over ADMS (Cloud Server). Thumb punches become check-ins within seconds; expired members are blocked at the door."
        actions={
          <a
            className="button button-secondary"
            href="/gate"
            target="_blank"
            rel="noreferrer"
          >
            <MonitorPlay size={16} /> Open gate screen
          </a>
        }
      />
      {!d.settings.machine.enforce && (
        <div className="occupancy-banner">
          <ShieldCheck size={18} />
          <strong>Monitor mode</strong>
          <span>
            The machine records every punch, but nobody is blocked by membership
            yet ({d.wouldBlock.length} would be). Link every member and check
            their plans, then switch on blocking below.
          </span>
        </div>
      )}

      <Section title="Connect the machine" detail="Do this once at the gym.">
        <ol className="bio-steps">
          <li>
            On the machine press <b>M/OK → Comm. → Cloud Server Setting</b>{" "}
            (older firmware: <b>ADMS</b> / <b>Web Server</b>).
          </li>
          <li>
            Turn on <b>Enable Domain Name</b>; Server Address{" "}
            <code>{d.server.host}</code>, Server Port{" "}
            <code>{d.server.port}</code>
            {d.server.https
              ? ", HTTPS on. If the machine has no HTTPS option, run the Fit Crush bridge on the front-desk PC and point the machine at that PC (docs/BIOMETRIC.md)."
              : ", HTTPS off."}
          </li>
          <li>
            Save and restart the machine. It appears below as{" "}
            <b>Waiting for approval</b>.
          </li>
          <li>
            After approval, link the machine's users to members under{" "}
            <b>Users on machine</b>.
          </li>
        </ol>
      </Section>

      {d.machines.length === 0 ? (
        <section className="panel">
          <div className="empty-state">
            <span className="empty-icon">
              <Cpu size={20} />
            </span>
            <h3>No machine yet</h3>
            <p>It appears here as soon as it contacts the software.</p>
          </div>
        </section>
      ) : (
        d.machines.map(m => {
          const online =
            m.lastSeenAt &&
            Date.now() - new Date(m.lastSeenAt).getTime() < 5 * 60_000;
          return (
            <Section
              key={m.sn}
              title={m.name}
              detail={`Serial ${m.sn} · last contact ${ago(m.lastSeenAt)}${m.lastIp ? ` from ${m.lastIp}` : ""}${m.info["firmware"] ? ` · firmware ${m.info["firmware"]}` : ""}`}
              action={
                m.status === "pending" ? (
                  d.canManage ? (
                    <button
                      className="button button-primary"
                      onClick={() => setApprove(m.sn)}
                    >
                      <Check size={15} /> Approve machine
                    </button>
                  ) : (
                    <Badge tone="amber">Waiting for approval</Badge>
                  )
                ) : m.status === "disabled" ? (
                  <Badge>Disabled</Badge>
                ) : online ? (
                  <Badge tone="green">Online</Badge>
                ) : (
                  <Badge tone="red">Offline</Badge>
                )
              }
            >
              <div className="stats-grid bio-mini">
                <Mini
                  label="Users on machine"
                  value={m.info["users"] ?? String(m.users)}
                />
                <Mini
                  label="Fingerprints on machine"
                  value={m.info["fingerprints"] ?? "—"}
                />
                <Mini label="Linked members" value={String(d.linkedMembers)} />
                <Mini
                  label="Updates waiting"
                  value={String(m.queued)}
                  note={m.failed ? `${m.failed} failed` : undefined}
                />
              </div>
              {d.canManage && m.status === "active" && (
                <div className="bio-actions">
                  <button
                    className="button button-secondary button-sm"
                    onClick={() => setLinkSn(m.sn)}
                  >
                    <Fingerprint size={14} /> Users on machine
                  </button>
                  <button
                    className="button button-secondary button-sm"
                    disabled={action.isPending}
                    onClick={() =>
                      run(
                        { action: "sync_all", sn: m.sn },
                        "Sent all members again"
                      )
                    }
                  >
                    <RefreshCw size={14} /> Send all members again
                  </button>
                  <button
                    className="button button-secondary button-sm"
                    disabled={action.isPending}
                    onClick={() =>
                      run(
                        { action: "command", sn: m.sn, kind: "upload_all" },
                        "Asked for all users and fingerprints"
                      )
                    }
                  >
                    <Download size={14} /> Fetch users & fingerprints
                  </button>
                  <button
                    className="button button-secondary button-sm"
                    disabled={action.isPending}
                    onClick={() =>
                      run(
                        { action: "command", sn: m.sn, kind: "upload_logs" },
                        "Asked for the last 7 days of punches"
                      )
                    }
                  >
                    Fetch punches (7 days)
                  </button>
                  <button
                    className="button button-secondary button-sm"
                    disabled={action.isPending}
                    onClick={() =>
                      run(
                        { action: "command", sn: m.sn, kind: "info" },
                        "Asked for machine info"
                      )
                    }
                  >
                    Machine info
                  </button>
                  {m.failed > 0 && (
                    <button
                      className="button button-secondary button-sm"
                      onClick={() =>
                        run(
                          { action: "retry_failed", sn: m.sn },
                          "Failed updates queued again"
                        )
                      }
                    >
                      Retry failed
                    </button>
                  )}
                  <button
                    className="text-button danger-link"
                    onClick={() =>
                      confirm(
                        "Stop using this machine? Its punches are refused until approved again."
                      ) &&
                      run({ action: "disable", sn: m.sn }, "Machine disabled")
                    }
                  >
                    Disable
                  </button>
                </div>
              )}
            </Section>
          );
        })
      )}

      {d.canManage && (
        <SettingsSection settings={d.settings} wouldBlock={d.wouldBlock} />
      )}

      <div className="bio-two">
        <Section title="Recent updates to the machine">
          {d.commands.length === 0 ? (
            <p className="muted-inline">Nothing sent yet.</p>
          ) : (
            <div className="activity-list">
              {d.commands.map(c => (
                <div className="activity-row" key={c.id}>
                  <span className="activity-time">{fmtTime(c.createdAt)}</span>
                  <span className="activity-dot" />
                  <div>
                    <strong>
                      {KIND_LABEL[c.kind] ?? c.kind}
                      {c.memberName ? ` · ${c.memberName}` : ""}
                    </strong>
                    <small className="mono-text">
                      {c.command
                        .replace(/TMP=\S+/, "TMP=…")
                        .replace(/\t/g, " ")}
                    </small>
                  </div>
                  <Badge
                    tone={
                      c.status === "done"
                        ? "green"
                        : c.status === "failed"
                          ? "red"
                          : c.status === "cancelled"
                            ? "neutral"
                            : "amber"
                    }
                  >
                    {c.status === "failed"
                      ? c.result
                      : c.status === "sent"
                        ? "waiting"
                        : c.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Section>
        <Section
          title="Connection log"
          detail="Latest requests from the machine."
        >
          {d.log.length === 0 ? (
            <p className="muted-inline">No traffic yet.</p>
          ) : (
            <div className="bio-log">
              {d.log.map(l => (
                <div key={l.id}>
                  <small>
                    {fmtDateTime(l.at)} · {l.method} {l.path}?{l.query}
                  </small>
                  {l.body && <code>↑ {l.body}</code>}
                  <code>↓ {l.response}</code>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {approve && (
        <ApproveModal sn={approve} onClose={() => setApprove(null)} />
      )}
      {linkSn && <LinkUsersModal sn={linkSn} onClose={() => setLinkSn(null)} />}
    </>
  );
}

function Mini({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string | undefined;
}) {
  return (
    <article className="stat-card stat-ink">
      <div className="stat-top">
        <span>{label}</span>
      </div>
      <strong className="stat-value">{value}</strong>
      {note && (
        <div className="stat-foot">
          <span>{note}</span>
        </div>
      )}
    </article>
  );
}

function ApproveModal({ sn, onClose }: { sn: string; onClose: () => void }) {
  const utils = trpc.useUtils();
  const action = trpc.biometric.machineAction.useMutation();
  const [name, setName] = useState("Entrance");
  return (
    <Modal
      open
      title="Approve machine"
      description={`Serial ${sn}. Only approve the gym's own machine.`}
      onClose={onClose}
    >
      <form
        className="form-grid"
        onSubmit={async e => {
          e.preventDefault();
          try {
            await action.mutateAsync({ action: "approve", sn, name });
            toast.success(
              "Approved. The machine now uploads its users and fingerprints."
            );
            await utils.biometric.invalidate();
            onClose();
          } catch (err) {
            toast.error(errText(err));
          }
        }}
      >
        <Field label="Name">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            required
          />
        </Field>
        <div className="form-actions form-section-span">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button-primary" disabled={action.isPending}>
            {action.isPending && <LoaderCircle className="spin" size={15} />}{" "}
            Approve
          </button>
        </div>
      </form>
    </Modal>
  );
}

function LinkUsersModal({ sn, onClose }: { sn: string; onClose: () => void }) {
  const utils = trpc.useUtils();
  const q = trpc.biometric.machineUsers.useQuery({ sn });
  const link = trpc.biometric.linkUsers.useMutation();
  const [pick, setPick] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!q.data) return;
    setPick(
      Object.fromEntries(
        q.data.users
          .filter(u => !u.linkedMemberId && u.suggestedMemberId)
          .map(u => [u.pin, String(u.suggestedMemberId)])
      )
    );
  }, [q.data]);
  const chosen = Object.entries(pick).filter(([, v]) => v);
  return (
    <Modal
      open
      wide
      title="Users on the machine"
      description="Link each machine User ID to the member it belongs to. Unlinked users (trainers, the owner, old members) are never changed by the software."
      onClose={onClose}
    >
      {!q.data ? (
        <p className="muted-inline">Loading…</p>
      ) : q.data.users.length === 0 ? (
        <p className="muted-inline">
          The machine has not uploaded any users yet. Use "Fetch users &
          fingerprints" and check again in a minute.
        </p>
      ) : (
        <div className="table-wrap bio-scroll">
          <table>
            <thead>
              <tr>
                <th>User ID</th>
                <th>Name on machine</th>
                <th>Fingers</th>
                <th>Member in software</th>
              </tr>
            </thead>
            <tbody>
              {q.data.users.map(u => (
                <tr key={u.pin}>
                  <td className="mono-text">
                    {u.pin}{" "}
                    {u.privilege > 0 && (
                      <Badge tone="amber">Machine admin</Badge>
                    )}
                  </td>
                  <td>{u.name || "—"}</td>
                  <td>{u.fingerprints}</td>
                  <td>
                    {u.linkedMemberId ? (
                      <Badge tone="green">{u.linkedName}</Badge>
                    ) : (
                      <select
                        className="bio-select"
                        value={pick[u.pin] ?? ""}
                        onChange={e =>
                          setPick({ ...pick, [u.pin]: e.target.value })
                        }
                      >
                        <option value="">Not linked</option>
                        {q.data.members.map(m => (
                          <option key={m.id} value={m.id}>
                            {m.name} · {m.memberCode}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="form-actions form-section-span">
        <button className="button button-secondary" onClick={onClose}>
          Close
        </button>
        <button
          className="button button-primary"
          disabled={!chosen.length || link.isPending}
          onClick={async () => {
            try {
              const r = await link.mutateAsync({
                links: chosen.map(([pin, memberId]) => ({
                  pin,
                  memberId: Number(memberId),
                })),
              });
              toast.success(`Linked ${r.linked} member(s)`);
              await utils.biometric.invalidate();
              onClose();
            } catch (err) {
              toast.error(errText(err));
            }
          }}
        >
          {link.isPending && <LoaderCircle className="spin" size={15} />} Link{" "}
          {chosen.length} member(s)
        </button>
      </div>
    </Modal>
  );
}

const days = (l: number[]) => l.join(", ");
const parseDays = (s: string) =>
  s
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number)
    .filter(n => Number.isInteger(n) && n >= 0);

function SettingsSection({
  settings,
  wouldBlock,
}: {
  settings: Settings;
  wouldBlock: Out["overview"]["wouldBlock"];
}) {
  const utils = trpc.useUtils();
  const save = trpc.biometric.saveSettings.useMutation();
  const [s, setS] = useState<Settings>(settings);
  const [lists, setLists] = useState({
    reminder: days(settings.alerts.reminderDays),
    dues: days(settings.alerts.duesReminderDays),
    winback: days(settings.alerts.winbackDays),
  });
  const m = s.machine;
  const setM = (patch: Partial<Settings["machine"]>) =>
    setS({ ...s, machine: { ...m, ...patch } });
  const turningOn = !settings.machine.enforce && m.enforce;
  const kinds =
    trpc.biometric.alerts.useQuery({ status: "pending" }).data?.kinds ?? [];
  const num = (v: string) => Number(v.replace(/\D/g, "") || 0);

  return (
    <Section
      title="Access & alert settings"
      detail="Admins only."
      action={
        <button
          className="button button-primary"
          disabled={save.isPending}
          onClick={async () => {
            if (
              turningOn &&
              wouldBlock.length &&
              !confirm(
                `${wouldBlock.length} member(s) will be blocked on the machine right away. Continue?`
              )
            )
              return;
            try {
              const r = await save.mutateAsync({
                ...s,
                alerts: {
                  ...s.alerts,
                  reminderDays: parseDays(lists.reminder),
                  duesReminderDays: parseDays(lists.dues),
                  winbackDays: parseDays(lists.winback),
                },
              });
              toast.success(
                `Saved${r.queued ? ` · ${r.queued} update(s) sent to the machine` : ""}`
              );
              await utils.biometric.invalidate();
            } catch (e) {
              toast.error(errText(e));
            }
          }}
        >
          {save.isPending ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <Save size={15} />
          )}{" "}
          Save
        </button>
      }
    >
      <div className="bio-two">
        <div className="bio-stack">
          <label className="override-toggle">
            <input
              type="checkbox"
              checked={m.enforce}
              onChange={e => setM({ enforce: e.target.checked })}
            />
            Block expired members on the machine
          </label>
          {turningOn && (
            <div className="bio-warning">
              <b>
                {wouldBlock.length} member(s) will be blocked as soon as you
                save:
              </b>
              <ul>
                {wouldBlock.slice(0, 50).map(w => (
                  <li key={w.memberId}>
                    {w.name} (ID {w.pin}): {w.headline}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label className="override-toggle">
            <input
              type="checkbox"
              checked={m.showMessages}
              onChange={e => setM({ showMessages: e.target.checked })}
            />
            Show days-left messages on the machine screen (firmware with
            personal SMS)
          </label>
          <div className="form-grid">
            <Field label="Repeat punches within (min)" hint="Same visit">
              <input
                inputMode="numeric"
                value={m.duplicateMinutes}
                onChange={e => setM({ duplicateMinutes: num(e.target.value) })}
              />
            </Field>
            <Field label="Next punch checks out after (min)" hint="0 = never">
              <input
                inputMode="numeric"
                value={m.checkoutAfterMinutes}
                onChange={e =>
                  setM({ checkoutAfterMinutes: num(e.target.value) })
                }
              />
            </Field>
            <Field label="Machine checks every (sec)">
              <input
                inputMode="numeric"
                value={m.pollSeconds}
                onChange={e => setM({ pollSeconds: num(e.target.value) })}
              />
            </Field>
            {m.blockMode === "group" && (
              <Field label="Blocked group number">
                <input
                  inputMode="numeric"
                  value={m.blockedGroup}
                  onChange={e =>
                    setM({ blockedGroup: num(e.target.value) || 2 })
                  }
                />
              </Field>
            )}
          </div>
        </div>
        <div className="bio-stack">
          <span className="field-label">How a blocked member is stopped</span>
          {BLOCK_MODES.map(b => (
            <label
              key={b.mode}
              className={`bio-choice${m.blockMode === b.mode ? " bio-choice-on" : ""}`}
            >
              <input
                type="radio"
                name="blockMode"
                checked={m.blockMode === b.mode}
                onChange={() => setM({ blockMode: b.mode })}
              />
              <span>
                <b>{b.title}</b>
                <small>{b.text}</small>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="panel-divider" />
      <h3 className="bio-h3">WhatsApp alerts</h3>
      <div className="form-grid">
        <Field label="Expiry reminders (days left)">
          <input
            value={lists.reminder}
            onChange={e => setLists({ ...lists, reminder: e.target.value })}
          />
        </Field>
        <Field label="Dues reminders (days after)">
          <input
            value={lists.dues}
            onChange={e => setLists({ ...lists, dues: e.target.value })}
          />
        </Field>
        <Field label="'We miss you' after (days)">
          <input
            inputMode="numeric"
            value={s.alerts.absentDays}
            onChange={e =>
              setS({
                ...s,
                alerts: { ...s.alerts, absentDays: num(e.target.value) },
              })
            }
          />
        </Field>
        <Field label="Win-back (days after expiry)">
          <input
            value={lists.winback}
            onChange={e => setLists({ ...lists, winback: e.target.value })}
          />
        </Field>
      </div>
      <div className="bio-templates">
        {kinds.map(k => (
          <div key={k.kind} className="bio-template">
            <label className="override-toggle">
              <input
                type="checkbox"
                checked={s.alerts.enabled[k.kind]}
                onChange={e =>
                  setS({
                    ...s,
                    alerts: {
                      ...s.alerts,
                      enabled: {
                        ...s.alerts.enabled,
                        [k.kind]: e.target.checked,
                      },
                    },
                  })
                }
              />
              <b>{k.label}</b> <small>{k.when}</small>
            </label>
            <textarea
              value={s.alerts.templates[k.kind]}
              onChange={e =>
                setS({
                  ...s,
                  alerts: {
                    ...s.alerts,
                    templates: {
                      ...s.alerts.templates,
                      [k.kind]: e.target.value,
                    },
                  },
                })
              }
            />
          </div>
        ))}
      </div>
      <p className="field-hint">
        Placeholders:{" "}
        {
          "{name} {fullName} {code} {gym} {plan} {start} {validUntil} {expiredOn} {days} {balance} {amount} {mode} {receipt} {status} {absentDays}"
        }
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------- alerts view

const TABS = ["pending", "sent", "skipped", "failed", "all"] as const;

export function AlertsView() {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<(typeof TABS)[number]>("pending");
  const q = trpc.biometric.alerts.useQuery({ status });
  const mark = trpc.biometric.markAlert.useMutation({
    onSuccess: () => utils.biometric.alerts.invalidate(),
  });
  const runChecks = trpc.biometric.runChecks.useMutation();
  const label = useMemo(
    () => Object.fromEntries((q.data?.kinds ?? []).map(k => [k.kind, k.label])),
    [q.data]
  );
  return (
    <>
      <Heading
        kicker="MEMBER ALERTS"
        title="Remind before it lapses."
        description={
          q.data?.mode === "cloud_api"
            ? "Sent automatically through the WhatsApp Business API."
            : "Tap Send: WhatsApp opens with the message ready. Press send there, and the alert is marked as sent."
        }
        actions={
          <button
            className="button button-secondary"
            disabled={runChecks.isPending}
            onClick={async () => {
              try {
                const r = await runChecks.mutateAsync();
                toast.success(
                  r.ran
                    ? `${r.alerts} new alert(s) · ${r.sync.queued} machine update(s)`
                    : "Checked"
                );
                await utils.biometric.invalidate();
              } catch (e) {
                toast.error(errText(e));
              }
            }}
          >
            {runChecks.isPending ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <RefreshCw size={15} />
            )}{" "}
            Run today's checks
          </button>
        }
      />
      <div className="bio-tabs">
        {TABS.map(t => (
          <button
            key={t}
            className={`bio-tab${status === t ? " bio-tab-on" : ""}`}
            onClick={() => setStatus(t)}
          >
            {t}{" "}
            {t !== "all" && q.data?.counts[t] ? `(${q.data.counts[t]})` : ""}
          </button>
        ))}
      </div>
      {!q.data ? (
        <p className="muted-inline">Loading…</p>
      ) : q.data.rows.length === 0 ? (
        <section className="panel">
          <div className="empty-state">
            <span className="empty-icon">
              <MessageCircle size={20} />
            </span>
            <h3>
              {status === "pending" ? "Nothing to send" : "No alerts here"}
            </h3>
            <p>
              Reminders, renewals, receipts and blocked-at-door messages appear
              here.
            </p>
          </div>
        </section>
      ) : (
        <div className="bio-alert-grid">
          {q.data.rows.map(a => {
            const link = a.phone
              ? `https://wa.me/${a.phone}?text=${encodeURIComponent(a.message)}`
              : null;
            return (
              <article className="panel bio-alert" key={a.id}>
                <div className="bio-alert-head">
                  <strong>{a.name}</strong>
                  <small className="mono-text">{a.memberCode}</small>
                  <Badge>{label[a.kind] ?? a.kind}</Badge>
                  <Badge
                    tone={
                      a.status === "sent"
                        ? "green"
                        : a.status === "pending"
                          ? "amber"
                          : a.status === "failed"
                            ? "red"
                            : "neutral"
                    }
                  >
                    {a.status}
                  </Badge>
                </div>
                <p className="bio-bubble">{a.message}</p>
                {a.error && <small className="danger-text">{a.error}</small>}
                <div className="bio-alert-foot">
                  <small>{fmtDateTime(a.createdAt)}</small>
                  {a.status !== "sent" && link && (
                    <a
                      className="button button-primary button-sm"
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => mark.mutate({ id: a.id, status: "sent" })}
                    >
                      <MessageCircle size={14} /> Send
                    </a>
                  )}
                  {a.status === "pending" && (
                    <button
                      className="text-button"
                      onClick={() =>
                        mark.mutate({ id: a.id, status: "skipped" })
                      }
                    >
                      Skip
                    </button>
                  )}
                  {(a.status === "skipped" || a.status === "failed") &&
                    a.phone && (
                      <button
                        className="text-button"
                        onClick={() =>
                          mark.mutate({ id: a.id, status: "pending" })
                        }
                      >
                        Back to pending
                      </button>
                    )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- member fingerprint panel

export function FingerprintModal({
  member,
  isAdmin,
  onClose,
}: {
  member: { id: number; name: string; memberCode: string };
  isAdmin: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const q = trpc.biometric.member.useQuery(
    { memberId: member.id },
    { refetchInterval: 5000 }
  );
  const act = trpc.biometric.memberAction.useMutation();
  const [pin, setPin] = useState("");
  const [sn, setSn] = useState("");
  const [finger, setFinger] = useState("6");
  useEffect(() => {
    if (q.data && !pin) setPin(String(q.data.suggestedPin));
    if (q.data && !sn && q.data.machines[0]) setSn(q.data.machines[0].sn);
  }, [q.data, pin, sn]);
  const run = async (
    input: Parameters<typeof act.mutateAsync>[0],
    ok: string
  ) => {
    try {
      await act.mutateAsync(input);
      toast.success(ok);
      await utils.biometric.invalidate();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const d = q.data;
  return (
    <Modal
      open
      wide
      title="Fingerprint access"
      description={`${member.name} · ${member.memberCode}`}
      onClose={onClose}
    >
      {!d ? (
        <p className="muted-inline">Loading…</p>
      ) : (
        <div className="bio-stack">
          <div
            className={`bio-status bio-status-${reasonTone(d.state.allowed, d.state.reason)}`}
          >
            {d.state.allowed ? <DoorOpen size={22} /> : <Ban size={22} />}
            <div>
              <strong>{d.state.allowed ? "Door opens" : "Door blocked"}</strong>
              <span>{d.state.headline}</span>
            </div>
          </div>

          {d.pin === null ? (
            <form
              className="form-grid"
              onSubmit={e => {
                e.preventDefault();
                void run(
                  { action: "link", memberId: member.id, pin: Number(pin) },
                  `Linked to machine User ID ${pin}`
                );
              }}
            >
              <Field
                label="Machine User ID"
                hint="The member's number on the fingerprint machine. Use their existing ID if they are already enrolled."
              >
                <input
                  inputMode="numeric"
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, ""))}
                  required
                />
              </Field>
              <div className="form-actions form-section-span">
                <button
                  className="button button-primary"
                  disabled={act.isPending || !pin}
                >
                  <Fingerprint size={15} /> Link to machine
                </button>
              </div>
            </form>
          ) : (
            <>
              <p>
                Machine User ID <b className="mono-text">{d.pin}</b> ·{" "}
                {d.backupFingers} fingerprint(s) backed up
                {d.onMachines
                  .map(o => ` · ${o.fingerprints} on ${o.sn}`)
                  .join("")}
                {d.pending
                  ? ` · ${d.pending} update(s) waiting for the machine`
                  : ""}
              </p>
              {d.machines.length > 0 ? (
                <div className="form-grid">
                  <Field label="Machine">
                    <select value={sn} onChange={e => setSn(e.target.value)}>
                      {d.machines.map(m => (
                        <option key={m.sn} value={m.sn}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Finger">
                    <select
                      value={finger}
                      onChange={e => setFinger(e.target.value)}
                    >
                      {FINGERS.map((f, i) => (
                        <option key={f} value={i}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              ) : (
                <p className="muted-inline">
                  Connect and approve the machine to enrol fingers from here.
                </p>
              )}
              <div className="bio-actions">
                <button
                  className="button button-primary"
                  disabled={act.isPending || !sn}
                  onClick={() =>
                    run(
                      {
                        action: "enroll",
                        memberId: member.id,
                        sn,
                        finger: Number(finger),
                      },
                      "Sent. The machine asks for the finger in a few seconds."
                    )
                  }
                >
                  <Fingerprint size={15} /> Enrol finger
                </button>
                <button
                  className="button button-secondary"
                  disabled={act.isPending}
                  onClick={() =>
                    run(
                      { action: "resync", memberId: member.id },
                      "Sent to the machine again"
                    )
                  }
                >
                  <RefreshCw size={15} /> Re-send
                </button>
              </div>
              {isAdmin && (
                <div className="bio-owner">
                  <span className="field-label">Owner controls</span>
                  <div className="bio-actions">
                    {(["allow", "block", null] as const).map(o => (
                      <button
                        key={String(o)}
                        className={`bio-tab${d.override === o ? " bio-tab-on" : ""}`}
                        disabled={act.isPending || d.override === o}
                        onClick={() =>
                          run(
                            {
                              action: "override",
                              memberId: member.id,
                              override: o,
                            },
                            "Access updated"
                          )
                        }
                      >
                        {o === "allow"
                          ? "Always allow"
                          : o === "block"
                            ? "Always block"
                            : "Follow membership"}
                      </button>
                    ))}
                    <button
                      className="text-button danger-link"
                      onClick={() =>
                        confirm(
                          "Unlink this member from the machine? The machine user is left as it is."
                        ) &&
                        run(
                          { action: "unlink", memberId: member.id },
                          "Unlinked"
                        )
                      }
                    >
                      Unlink
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {d.punches.length > 0 && (
            <div>
              <span className="field-label">Recent punches</span>
              <div className="activity-list">
                {d.punches.slice(0, 8).map(p => (
                  <div className="activity-row" key={p.id}>
                    <span className="activity-time">
                      {fmtDateTime(p.punchedAt)}
                    </span>
                    <span className="activity-dot" />
                    <div>
                      <strong>{p.headline}</strong>
                    </div>
                    <Badge tone={reasonTone(p.allowed, p.reason)}>
                      {p.allowed ? "Allowed" : "Blocked"}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
