// tRPC procedures for the fingerprint machine, the gate screen and WhatsApp alerts.

import { isAdminRole } from "@shared/gym";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  auditLogs,
  biometricMembers,
  biometricPunches,
  deviceCommands,
  deviceLog,
  devices,
  deviceUsers,
  fingerprintTemplates,
  memberAlerts,
  memberDeviceState,
  members,
} from "../../drizzle/schema";
import { adminProcedure, roleProcedure, router } from "../_core/trpc";
import { describeReturn } from "./adms";
import {
  getBiometricSettings,
  linkMember,
  loadMemberEntries,
  nextFreePin,
  queueDeviceCommand,
  queueEnroll,
  reconcileDevices,
  requireDb,
  runAlerts,
  runDailyJobs,
  saveBiometricSettings,
  setOverride,
  syncMember,
  unlinkMember,
  whatsappMode,
} from "./engine";
import {
  ALERT_KINDS,
  mergeBiometricSettings,
  todayIST,
  type BiometricSettings,
} from "./rules";

const frontDesk = roleProcedure("owner", "admin", "receptionist");

async function db() {
  try {
    return await requireDb();
  } catch {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Gym database is unavailable.",
    });
  }
}

function fail(e: unknown): never {
  if (e instanceof TRPCError) throw e;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: e instanceof Error ? e.message : String(e),
  });
}

const parseInfo = (info: string | null): Record<string, string> => {
  try {
    return info ? JSON.parse(info) : {};
  } catch {
    return {};
  }
};

export const biometricRouter = router({
  /** Machine page: machines, recent commands, connection log, settings. */
  overview: frontDesk.query(async ({ ctx }) => {
    const d = await db();
    const machines = await d.select().from(devices).orderBy(devices.createdAt);
    const counts = (
      await d.execute<{
        sn: string;
        queued: number;
        failed: number;
        users: number;
        withFingers: number;
      }>(sql`
        select d.sn,
          (select count(*)::int from gym_device_commands c where c."deviceSn" = d.sn and c.status in ('queued', 'sent')) as queued,
          (select count(*)::int from gym_device_commands c where c."deviceSn" = d.sn and c.status = 'failed' and c."createdAt" > now() - interval '7 days') as failed,
          (select count(*)::int from gym_device_users u where u."deviceSn" = d.sn) as users,
          (select count(*)::int from gym_device_users u where u."deviceSn" = d.sn and u.fingerprints > 0) as "withFingers"
        from gym_devices d`)
    ).rows;
    const countBy = new Map(counts.map(c => [c.sn, c]));
    const commands = await d
      .select({
        id: deviceCommands.id,
        deviceSn: deviceCommands.deviceSn,
        kind: deviceCommands.kind,
        command: sql<string>`left(${deviceCommands.command}, 160)`,
        status: deviceCommands.status,
        returnCode: deviceCommands.returnCode,
        createdAt: deviceCommands.createdAt,
        memberName: members.name,
      })
      .from(deviceCommands)
      .leftJoin(members, eq(members.id, deviceCommands.memberId))
      .orderBy(desc(deviceCommands.id))
      .limit(60);
    const log = await d
      .select()
      .from(deviceLog)
      .orderBy(desc(deviceLog.id))
      .limit(40);
    const settings = await getBiometricSettings(d);
    const linked = await d
      .select({ n: sql<number>`count(*)::int` })
      .from(biometricMembers);
    const entries = await loadMemberEntries(d, { linkedOnly: true });
    const host = ctx.req.get("x-forwarded-host") ?? ctx.req.get("host") ?? "";
    const proto = (
      ctx.req.get("x-forwarded-proto") ??
      ctx.req.protocol ??
      "https"
    ).split(",")[0]!;
    return {
      machines: machines.map(m => ({
        ...m,
        info: parseInfo(m.info),
        queued: Number(countBy.get(m.sn)?.queued ?? 0),
        failed: Number(countBy.get(m.sn)?.failed ?? 0),
        users: Number(countBy.get(m.sn)?.users ?? 0),
        withFingers: Number(countBy.get(m.sn)?.withFingers ?? 0),
      })),
      commands: commands.map(c => ({
        ...c,
        result:
          c.status === "failed" ? describeReturn(c.returnCode, c.kind) : "",
      })),
      log,
      settings,
      linkedMembers: Number(linked[0]?.n ?? 0),
      wouldBlock: entries
        .filter(e => !e.state.allowed)
        .map(e => ({
          memberId: e.memberId,
          name: e.name,
          pin: e.pin,
          headline: e.state.headline,
        })),
      server: {
        host: host.split(":")[0] ?? host,
        port: host.includes(":")
          ? host.split(":")[1]
          : proto === "https"
            ? "443"
            : "80",
        https: proto === "https",
      },
      whatsappMode: whatsappMode(),
      canManage: isAdminRole(ctx.user.role),
    };
  }),

  machineAction: adminProcedure
    .input(
      z.discriminatedUnion("action", [
        z.object({
          action: z.literal("approve"),
          sn: z.string().min(1),
          name: z.string().trim().min(1).max(60),
        }),
        z.object({
          action: z.literal("rename"),
          sn: z.string().min(1),
          name: z.string().trim().min(1).max(60),
        }),
        z.object({ action: z.literal("disable"), sn: z.string().min(1) }),
        z.object({
          action: z.literal("command"),
          sn: z.string().min(1),
          kind: z.enum([
            "info",
            "check",
            "reboot",
            "unlock",
            "upload_all",
            "upload_logs",
          ]),
        }),
        z.object({ action: z.literal("sync_all"), sn: z.string().min(1) }),
        z.object({ action: z.literal("retry_failed"), sn: z.string().min(1) }),
      ])
    )
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      try {
        switch (input.action) {
          case "approve":
            await d
              .update(devices)
              .set({ status: "active", name: input.name })
              .where(eq(devices.sn, input.sn));
            await d
              .insert(auditLogs)
              .values({
                actorId: ctx.user.id,
                action: "biometric.approve",
                entityType: "device",
                reason: input.sn,
              });
            // The machine uploads its users, fingerprints and punches; member updates wait 2 minutes
            // so its cards, keypad passwords and admin rights are known before anything is sent.
            await queueDeviceCommand(d, input.sn, "info");
            await queueDeviceCommand(d, input.sn, "upload_all");
            return {
              result: await reconcileDevices(d, {
                sn: input.sn,
                delaySeconds: 120,
                reason: "machine approved",
              }),
            };
          case "rename":
            await d
              .update(devices)
              .set({ name: input.name })
              .where(eq(devices.sn, input.sn));
            return { result: null };
          case "disable":
            await d
              .update(devices)
              .set({ status: "disabled" })
              .where(eq(devices.sn, input.sn));
            await d
              .insert(auditLogs)
              .values({
                actorId: ctx.user.id,
                action: "biometric.disable",
                entityType: "device",
                reason: input.sn,
              });
            return { result: null };
          case "command":
            await queueDeviceCommand(d, input.sn, input.kind);
            return { result: null };
          case "sync_all":
            return {
              result: await reconcileDevices(d, {
                sn: input.sn,
                force: true,
                reason: "manual full sync",
              }),
            };
          case "retry_failed":
            await d
              .update(deviceCommands)
              .set({ status: "queued" })
              .where(
                and(
                  eq(deviceCommands.deviceSn, input.sn),
                  eq(deviceCommands.status, "failed")
                )
              );
            return { result: null };
        }
      } catch (e) {
        fail(e);
      }
    }),

  /** Users on a machine, with the member each is linked to (or a suggested match by name). */
  machineUsers: adminProcedure
    .input(z.object({ sn: z.string().min(1) }))
    .query(async ({ input }) => {
      const d = await db();
      const users = await d
        .select()
        .from(deviceUsers)
        .where(eq(deviceUsers.deviceSn, input.sn));
      const links = await d
        .select({
          pin: biometricMembers.pin,
          memberId: biometricMembers.memberId,
          name: members.name,
        })
        .from(biometricMembers)
        .innerJoin(members, eq(members.id, biometricMembers.memberId));
      const byPin = new Map(links.map(l => [String(l.pin), l]));
      const all = await d
        .select({
          id: members.id,
          name: members.name,
          memberCode: members.memberCode,
          phone: members.phone,
        })
        .from(members)
        .orderBy(members.name)
        .limit(5000);
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
      return {
        users: users
          .map(u => {
            const link = byPin.get(u.pin);
            const suggestion =
              !link && u.name
                ? all.find(
                    m =>
                      norm(m.name) === norm(u.name!) &&
                      !links.some(l => l.memberId === m.id)
                  )
                : undefined;
            return {
              pin: u.pin,
              name: u.name,
              privilege: u.privilege ?? 0,
              fingerprints: u.fingerprints,
              linkedMemberId: link?.memberId ?? null,
              linkedName: link?.name ?? null,
              suggestedMemberId: suggestion?.id ?? null,
            };
          })
          .sort((a, b) => Number(a.pin) - Number(b.pin)),
        members: all,
      };
    }),

  linkUsers: adminProcedure
    .input(
      z.object({
        links: z
          .array(
            z.object({
              pin: z.string().regex(/^\d{1,9}$/),
              memberId: z.number().int().positive(),
            })
          )
          .max(5000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      let linked = 0;
      for (const l of input.links) {
        try {
          await linkMember(d, l.memberId, Number(l.pin), ctx.user.id);
          linked++;
        } catch (e) {
          fail(e);
        }
      }
      return { linked };
    }),

  /** Fingerprint panel on a member's profile. */
  member: frontDesk
    .input(z.object({ memberId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const d = await db();
      const [entry] = await loadMemberEntries(d, {
        memberIds: [input.memberId],
      });
      if (!entry)
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      const pin = entry.pin === null ? null : String(entry.pin);
      const machines = await d
        .select({ sn: devices.sn, name: devices.name, status: devices.status })
        .from(devices);
      const [backup] = pin
        ? await d
            .select({ n: sql<number>`count(*)::int` })
            .from(fingerprintTemplates)
            .where(eq(fingerprintTemplates.pin, pin))
        : [];
      const onMachines = pin
        ? await d.select().from(deviceUsers).where(eq(deviceUsers.pin, pin))
        : [];
      const state = await d
        .select()
        .from(memberDeviceState)
        .where(eq(memberDeviceState.memberId, input.memberId));
      const pending = await d
        .select({
          id: deviceCommands.id,
          kind: deviceCommands.kind,
          status: deviceCommands.status,
        })
        .from(deviceCommands)
        .where(
          and(
            eq(deviceCommands.memberId, input.memberId),
            inArray(deviceCommands.status, ["queued", "sent"])
          )
        );
      const punches = await d
        .select()
        .from(biometricPunches)
        .where(eq(biometricPunches.memberId, input.memberId))
        .orderBy(desc(biometricPunches.id))
        .limit(20);
      const alerts = await d
        .select()
        .from(memberAlerts)
        .where(eq(memberAlerts.memberId, input.memberId))
        .orderBy(desc(memberAlerts.id))
        .limit(20);
      return {
        pin: entry.pin,
        override: entry.override,
        state: entry.state,
        backupFingers: Number(backup?.n ?? 0),
        onMachines: onMachines.map(u => ({
          sn: u.deviceSn,
          fingerprints: u.fingerprints,
          privilege: u.privilege ?? 0,
        })),
        machineState: state,
        pending: pending.length,
        machines: machines.filter(m => m.status === "active"),
        suggestedPin: entry.pin ?? (await nextFreePin(d)),
        punches,
        alerts,
      };
    }),

  memberAction: frontDesk
    .input(
      z.discriminatedUnion("action", [
        z.object({
          action: z.literal("link"),
          memberId: z.number().int().positive(),
          pin: z.number().int().positive().max(999999999),
        }),
        z.object({
          action: z.literal("unlink"),
          memberId: z.number().int().positive(),
        }),
        z.object({
          action: z.literal("enroll"),
          memberId: z.number().int().positive(),
          sn: z.string().min(1),
          finger: z.number().int().min(0).max(9),
        }),
        z.object({
          action: z.literal("resync"),
          memberId: z.number().int().positive(),
        }),
        z.object({
          action: z.literal("override"),
          memberId: z.number().int().positive(),
          override: z.enum(["allow", "block"]).nullable(),
        }),
      ])
    )
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const ownerOnly =
        input.action === "unlink" || input.action === "override";
      if (ownerOnly && !isAdminRole(ctx.user.role))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only an admin can do this.",
        });
      try {
        switch (input.action) {
          case "link":
            await linkMember(d, input.memberId, input.pin, ctx.user.id);
            return { pin: input.pin };
          case "unlink":
            await unlinkMember(d, input.memberId, ctx.user.id);
            return { pin: null };
          case "enroll":
            return {
              pin: await queueEnroll(
                d,
                input.sn,
                input.memberId,
                input.finger,
                ctx.user.id
              ),
            };
          case "resync":
            await syncMember(d, input.memberId, true);
            return { pin: null };
          case "override":
            await setOverride(d, input.memberId, input.override, ctx.user.id);
            return { pin: null };
        }
      } catch (e) {
        fail(e);
      }
    }),

  /** Live punches for the reception screen: every attempt shows; repeats are only not counted. */
  gateFeed: frontDesk
    .input(z.object({ afterId: z.number().int().min(0) }))
    .query(async ({ input }) => {
      const d = await db();
      const today = todayIST();
      const rows = await d
        .select({
          id: biometricPunches.id,
          punchedAt: biometricPunches.punchedAt,
          pin: biometricPunches.pin,
          memberId: biometricPunches.memberId,
          name: members.name,
          memberCode: members.memberCode,
          photoUrl: members.photoUrl,
          allowed: biometricPunches.allowed,
          reason: biometricPunches.reason,
          headline: biometricPunches.headline,
        })
        .from(biometricPunches)
        .leftJoin(members, eq(members.id, biometricPunches.memberId))
        .where(
          and(
            eq(biometricPunches.punchDate, today),
            sql`${biometricPunches.id} > ${input.afterId}`
          )
        )
        .orderBy(desc(biometricPunches.id))
        .limit(30);
      const [stats] = (
        await d.execute<{ came: number; blocked: number | null }>(
          sql`select count(distinct case when allowed then "memberId" end)::int as came,
            sum(case when allowed = false and duplicate = false then 1 else 0 end)::int as blocked
          from gym_biometric_punches where "punchDate" = ${today}`
        )
      ).rows;
      const machines = await d
        .select({ name: devices.name, lastSeenAt: devices.lastSeenAt })
        .from(devices)
        .where(eq(devices.status, "active"));
      return {
        rows,
        stats: {
          came: Number(stats?.came ?? 0),
          blocked: Number(stats?.blocked ?? 0),
        },
        machines,
        serverTime: new Date().toISOString(),
      };
    }),

  openDoor: frontDesk.mutation(async ({ ctx }) => {
    const d = await db();
    const machines = await d
      .select({ sn: devices.sn })
      .from(devices)
      .where(eq(devices.status, "active"));
    for (const m of machines) await queueDeviceCommand(d, m.sn, "unlock");
    await d
      .insert(auditLogs)
      .values({
        actorId: ctx.user.id,
        action: "biometric.open_door",
        entityType: "device",
        reason: `${machines.length} machine(s)`,
      });
    return { machines: machines.length };
  }),

  alerts: frontDesk
    .input(
      z.object({
        status: z.enum(["pending", "sent", "failed", "skipped", "all"]),
      })
    )
    .query(async ({ input }) => {
      const d = await db();
      // Creating today's alerts is idempotent, so opening the page always shows what is due.
      await runAlerts(d).catch(e =>
        console.error("[biometric] alerts failed", e)
      );
      const rows = await d
        .select({
          id: memberAlerts.id,
          memberId: memberAlerts.memberId,
          name: members.name,
          memberCode: members.memberCode,
          kind: memberAlerts.kind,
          phone: memberAlerts.phone,
          message: memberAlerts.message,
          status: memberAlerts.status,
          error: memberAlerts.error,
          createdAt: memberAlerts.createdAt,
          sentAt: memberAlerts.sentAt,
        })
        .from(memberAlerts)
        .innerJoin(members, eq(members.id, memberAlerts.memberId))
        .where(
          input.status === "all"
            ? undefined
            : eq(memberAlerts.status, input.status)
        )
        .orderBy(desc(memberAlerts.id))
        .limit(300);
      const counts = await d
        .select({ status: memberAlerts.status, n: sql<number>`count(*)::int` })
        .from(memberAlerts)
        .groupBy(memberAlerts.status);
      return {
        rows,
        counts: Object.fromEntries(counts.map(c => [c.status, Number(c.n)])),
        mode: whatsappMode(),
        kinds: ALERT_KINDS,
      };
    }),

  markAlert: frontDesk
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(["sent", "skipped", "pending"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      await d
        .update(memberAlerts)
        .set({
          status: input.status,
          sentAt: input.status === "sent" ? new Date() : null,
          sentBy: input.status === "sent" ? ctx.user.id : null,
        })
        .where(eq(memberAlerts.id, input.id));
      return { ok: true };
    }),

  runChecks: frontDesk.mutation(async () => {
    const d = await db();
    return runDailyJobs(d, true);
  }),

  saveSettings: adminProcedure
    .input(z.custom<BiometricSettings>())
    .mutation(async ({ ctx, input }) => {
      const d = await db();
      const next = mergeBiometricSettings(input);
      const m = next.machine;
      if (!["fingers", "remove", "group"].includes(m.blockMode))
        fail(new Error("Unknown block method"));
      if (m.pollSeconds < 5 || m.pollSeconds > 300)
        fail(new Error("Machine check interval must be 5-300 seconds"));
      for (const list of [
        next.alerts.reminderDays,
        next.alerts.duesReminderDays,
        next.alerts.winbackDays,
      ])
        if (
          !Array.isArray(list) ||
          list.some(n => !Number.isInteger(n) || n < 0 || n > 365)
        )
          fail(new Error("Alert days must be whole numbers 0-365"));
      const before = await getBiometricSettings(d);
      await saveBiometricSettings(d, next);
      await d
        .insert(auditLogs)
        .values({
          actorId: ctx.user.id,
          action: "biometric.settings",
          entityType: "settings",
          reason: `enforce=${m.enforce} mode=${m.blockMode}`,
        });
      const changed =
        JSON.stringify(before.machine) !== JSON.stringify(next.machine);
      const machines = await d
        .select({ sn: devices.sn })
        .from(devices)
        .where(eq(devices.status, "active"));
      let queued = 0;
      if (changed)
        for (const x of machines)
          queued += (
            await reconcileDevices(d, { sn: x.sn, reason: "settings changed" })
          ).queued;
      return { queued };
    }),
});
