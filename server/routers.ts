import { COOKIE_NAME } from "@shared/const";
import { isAdminRole } from "@shared/gym";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { staffInvites, users } from "../drizzle/schema";
import { getSessionCookieOptions } from "./_core/cookies";
import { localAuthEnabled } from "./_core/env";
import {
  findCredentialByOpenId,
  issueSessionCookie,
  normalizeEmail,
  passwordProblem,
  setPassword,
  verifyPassword,
} from "./_core/localAuth";
import { systemRouter } from "./_core/systemRouter";
import {
  adminProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "./_core/trpc";
import { biometricRouter } from "./biometric/router";
import { getDb, getGymSettings } from "./db";
import { gymRouter } from "./gymRouter";

const requireLocalAuth = () => {
  if (!localAuthEnabled())
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Passwords are managed by the sign-in provider on this install.",
    });
};
const badPassword = (password: string) => {
  const problem = passwordProblem(password);
  if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
};

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    // Self-hosted installs only (AUTH_MODE=local).
    changePassword: protectedProcedure
      .input(
        z.object({
          currentPassword: z.string().max(200),
          newPassword: z.string().max(200),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireLocalAuth();
        const credential = await findCredentialByOpenId(ctx.user.openId);
        if (!credential)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "This account has no password to change.",
          });
        if (
          !(await verifyPassword(
            input.currentPassword,
            credential.passwordHash
          ))
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Your current password is not correct.",
          });
        badPassword(input.newPassword);
        await setPassword(credential.email, input.newPassword, ctx.user.id);
        // Other devices are signed out by the change; keep this one signed in.
        await issueSessionCookie(
          ctx.req,
          ctx.res,
          ctx.user.openId,
          ctx.user.name ?? ""
        );
        return { success: true } as const;
      }),
    // An admin sets or resets the password of a staff or member login.
    setPasswordFor: adminProcedure
      .input(
        z.object({
          email: z.string().trim().email().max(320),
          password: z.string().max(200),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireLocalAuth();
        badPassword(input.password);
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Gym database is unavailable.",
          });
        const email = normalizeEmail(input.email);
        if (ctx.user.email && normalizeEmail(ctx.user.email) === email)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Use Change password for your own login.",
          });
        const account = (
          await db.select().from(users).where(eq(users.email, email)).limit(1)
        )[0];
        const invite = (
          await db
            .select()
            .from(staffInvites)
            .where(eq(staffInvites.email, email))
            .limit(1)
        )[0];
        if (!account && !invite?.active)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Add this person under Add staff first.",
          });
        const ownerOpenId = (await getGymSettings())?.ownerOpenId;
        const actorIsOwner = ctx.user.openId === ownerOpenId;
        if (
          account &&
          !actorIsOwner &&
          (account.openId === ownerOpenId || isAdminRole(account.role))
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only the owner can reset an admin's password.",
          });
        const { created } = await setPassword(
          email,
          input.password,
          ctx.user.id
        );
        return { created };
      }),
  }),
  gym: gymRouter,
  biometric: biometricRouter,
});

export type AppRouter = typeof appRouter;
