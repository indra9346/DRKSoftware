// Reception screen: a TV or tablet at the entrance shows every fingerprint punch the moment the
// machine sends it: green (welcome), amber (renew soon) or red (blocked: renew & pay).

import { useEffect, useRef, useState } from "react";
import { BRAND } from "@shared/brand";
import { DoorOpen, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { reasonTone } from "@/components/gym/Biometric";

type Feed = inferRouterOutputs<AppRouter>["biometric"]["gateFeed"];
type Punch = Feed["rows"][number];

const SHOW_MS = 12_000;
const time = (d: Date | string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(d));

function beep(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 880 : 220;
    o.type = ok ? "sine" : "square";
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.15 : 0.6));
  } catch {
    // audio is blocked until the first click on the page
  }
}

export default function Gate() {
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const openDoor = trpc.biometric.openDoor.useMutation();
  const [rows, setRows] = useState<Punch[]>([]);
  const [meta, setMeta] = useState<Omit<Feed, "rows"> | null>(null);
  const [offline, setOffline] = useState(false);
  const [sound, setSound] = useState(true);
  const [now, setNow] = useState(Date.now());
  const lastId = useRef(0);
  const first = useRef(true);
  const busy = useRef(false);
  const allowed =
    me.data && ["owner", "admin", "receptionist"].includes(me.data.role);

  useEffect(() => {
    if (!allowed) return;
    let stop = false;
    const tick = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const f = await utils.biometric.gateFeed.fetch(
          { afterId: lastId.current },
          { staleTime: 0 }
        );
        if (stop) return;
        setOffline(false);
        setMeta({
          stats: f.stats,
          machines: f.machines,
          serverTime: f.serverTime,
        });
        const fresh = f.rows.filter(r => r.id > lastId.current);
        if (fresh.length) {
          lastId.current = Math.max(...fresh.map(r => r.id));
          setRows(old => {
            const seen = new Set(old.map(r => r.id));
            return [...fresh.filter(r => !seen.has(r.id)), ...old].slice(0, 40);
          });
          if (!first.current && sound) beep(fresh[0]!.allowed !== false);
        }
        first.current = false;
      } catch {
        if (!stop) setOffline(true);
      } finally {
        busy.current = false;
      }
    };
    void tick();
    const t = setInterval(tick, 2000);
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop = true;
      clearInterval(t);
      clearInterval(c);
    };
  }, [allowed, sound, utils]);

  if (me.isLoading) return <div className="bio-gate" />;
  if (!allowed)
    return (
      <div className="bio-gate bio-gate-center">
        <p>Front-desk sign-in needed for the gate screen.</p>
        <button className="button button-primary" onClick={() => startLogin()}>
          Sign in
        </button>
      </div>
    );

  const latest = rows[0];
  const fresh = latest && now - new Date(latest.punchedAt).getTime() < SHOW_MS;
  const tone = latest ? reasonTone(latest.allowed, latest.reason) : "neutral";
  const online = meta?.machines.some(
    m => m.lastSeenAt && now - new Date(m.lastSeenAt).getTime() < 5 * 60_000
  );

  return (
    <div className="bio-gate">
      <header className="bio-gate-top">
        <div className="bio-gate-brand">
          <span className="brand-symbol" aria-hidden="true">
            <img src={BRAND.mark} alt="" />
          </span>
          <strong>{BRAND.shortName}</strong>
          <small>ENTRANCE</small>
        </div>
        <div className="bio-gate-meta">
          <b>
            {new Date(now).toLocaleTimeString("en-IN", {
              timeZone: "Asia/Kolkata",
              hour: "numeric",
              minute: "2-digit",
            })}
          </b>
          <span
            className={`status-badge badge-${offline ? "red" : online ? "green" : "amber"}`}
          >
            <i />
            {offline
              ? "Software offline"
              : online
                ? "Machine online"
                : "Machine not connected"}
          </span>
          <button
            className="icon-button"
            onClick={() => setSound(!sound)}
            aria-label="Sound"
          >
            {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button
            className="button button-secondary"
            disabled={openDoor.isPending}
            onClick={async () => {
              try {
                const r = await openDoor.mutateAsync();
                toast.success(
                  r.machines ? "Open-door command sent" : "No machine connected"
                );
              } catch (e) {
                toast.error(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            <DoorOpen size={16} /> Open door
          </button>
        </div>
      </header>
      <main className="bio-gate-main">
        <section className={`bio-gate-hero${fresh ? ` bio-gate-${tone}` : ""}`}>
          {fresh && latest ? (
            <>
              <div className="bio-gate-avatar">
                {latest.photoUrl ? (
                  <img src={latest.photoUrl} alt="" />
                ) : (
                  (latest.name ?? "?").slice(0, 1)
                )}
              </div>
              <h1>{latest.name ?? `Machine user ${latest.pin}`}</h1>
              <p className="mono-text">
                {latest.memberCode ?? `User ID ${latest.pin}`}
              </p>
              <div className="bio-gate-verdict">
                {latest.allowed === false
                  ? "ACCESS BLOCKED"
                  : latest.allowed === null
                    ? "NOT REGISTERED"
                    : "WELCOME!"}
              </div>
              <p className="bio-gate-line">{latest.headline}</p>
              {latest.allowed === false &&
                !/pay/i.test(latest.headline ?? "") && (
                  <p>Please meet the front desk.</p>
                )}
            </>
          ) : (
            <>
              <h1 className="bio-gate-idle">{BRAND.tagline}</h1>
              <p>Place your finger on the machine.</p>
            </>
          )}
        </section>
        <aside className="panel bio-gate-side">
          <div className="bio-gate-stats">
            <div>
              <b>{meta?.stats.came ?? 0}</b>
              <small>came in today</small>
            </div>
            <div className="bio-gate-stat-bad">
              <b>{meta?.stats.blocked ?? 0}</b>
              <small>blocked</small>
            </div>
          </div>
          <div className="activity-list">
            {rows.map(r => (
              <div className="activity-row" key={r.id}>
                <span className="activity-time">{time(r.punchedAt)}</span>
                <span
                  className={`bio-dot bio-dot-${reasonTone(r.allowed, r.reason)}`}
                />
                <div>
                  <strong>{r.name ?? `User ${r.pin}`}</strong>
                  <small>{r.headline}</small>
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <p className="muted-inline">No one yet today.</p>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
