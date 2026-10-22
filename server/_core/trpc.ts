import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { isAdminRole, type GymRole } from "@shared/gym";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({ transformer: superjson });
export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user)
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  if (!ctx.user.active)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This gym account is inactive. Contact the gym administrator.",
    });
  if (ctx.user.role === "user")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your gym account has not been assigned a role yet.",
    });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const protectedProcedure = t.procedure.use(requireUser);
export const adminProcedure = t.procedure.use(
  t.middleware(async ({ ctx, next }) => {
    if (!ctx.user || !ctx.user.active || !isAdminRole(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  })
);

export const roleProcedure = (...roles: GymRole[]) =>
  protectedProcedure.use(
    t.middleware(({ ctx, next }) => {
      const currentUser = ctx.user;
      if (!currentUser || !roles.includes(currentUser.role as GymRole))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this gym operation.",
        });
      return next({ ctx: { ...ctx, user: currentUser } });
    })
  );
