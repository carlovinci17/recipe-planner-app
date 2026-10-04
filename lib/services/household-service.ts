import "server-only";
import { cache } from "react";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { households, householdInvites, householdMembers, profiles } from "@/lib/db/schema";
import { runInUserTx } from "./user-tx";
import type { Tables } from "@/types/database.types";

export type HouseholdMembership = {
  household: Tables<"households">;
  role: "owner" | "member";
};

export type HouseholdMemberRow = {
  role: "owner" | "member";
  joined_at: string;
  profile: {
    id: string;
    email: string;
    display_name: string | null;
    avatar_url: string | null;
  };
};

const listForCurrentUser = cache(async function listForCurrentUser(): Promise<
  HouseholdMembership[]
> {
  return runInUserTx(async (tx) => {
    const rows = await tx
      .select({
        role: householdMembers.role,
        id: households.id,
        name: households.name,
        created_by: households.createdBy,
        created_at: households.createdAt,
        updated_at: households.updatedAt,
      })
      .from(householdMembers)
      .innerJoin(households, eq(households.id, householdMembers.householdId))
      .orderBy(asc(householdMembers.joinedAt));
    return rows.map((r) => ({
      role: r.role,
      household: {
        id: r.id,
        name: r.name,
        created_by: r.created_by,
        created_at: r.created_at,
        updated_at: r.updated_at,
      },
    }));
  });
});

export const householdService = {
  listForCurrentUser,

  async getActive(householdId: string): Promise<Tables<"households"> | null> {
    return runInUserTx(async (tx) => {
      const rows = await tx
        .select({
          id: households.id,
          name: households.name,
          created_by: households.createdBy,
          created_at: households.createdAt,
          updated_at: households.updatedAt,
        })
        .from(households)
        .where(eq(households.id, householdId))
        .limit(1);
      return rows[0] ?? null;
    });
  },

  async create(name: string): Promise<string> {
    return runInUserTx(async (tx) => {
      const rows = (await tx.execute(
        sql`select public.create_household_with_owner(${name}) as id`,
      )) as unknown as Array<{ id: string }>;
      const id = rows[0]?.id;
      if (!id) throw new Error("Failed to create household");
      return id;
    });
  },

  async members(householdId: string): Promise<HouseholdMemberRow[]> {
    return runInUserTx(async (tx) => {
      const rows = await tx
        .select({
          role: householdMembers.role,
          joined_at: householdMembers.joinedAt,
          profile_id: profiles.id,
          profile_email: profiles.email,
          profile_display_name: profiles.displayName,
          profile_avatar_url: profiles.avatarUrl,
        })
        .from(householdMembers)
        .innerJoin(profiles, eq(profiles.id, householdMembers.userId))
        .where(eq(householdMembers.householdId, householdId));
      return rows.map((r) => ({
        role: r.role,
        joined_at: r.joined_at,
        profile: {
          id: r.profile_id,
          email: r.profile_email,
          display_name: r.profile_display_name,
          avatar_url: r.profile_avatar_url,
        },
      }));
    });
  },

  async invite(args: {
    householdId: string;
    email: string;
    role?: "owner" | "member";
  }): Promise<Tables<"household_invites">> {
    return runInUserTx(async (tx, userId) => {
      const rows = await tx
        .insert(householdInvites)
        .values({
          householdId: args.householdId,
          email: args.email.toLowerCase(),
          role: args.role ?? "member",
          invitedBy: userId,
        })
        .returning({
          id: householdInvites.id,
          household_id: householdInvites.householdId,
          email: householdInvites.email,
          role: householdInvites.role,
          token: householdInvites.token,
          invited_by: householdInvites.invitedBy,
          expires_at: householdInvites.expiresAt,
          accepted_at: householdInvites.acceptedAt,
          created_at: householdInvites.createdAt,
        });
      const row = rows[0];
      if (!row) throw new Error("Invite failed");
      return row;
    });
  },

  /**
   * Public lookup of a pending invite by its (secret) token — used by the invite
   * landing page to show who it's for and steer sign-in to the right email.
   * Token-scoped and admin/service-role (the invitee isn't authenticated yet);
   * the random token is the capability. Returns null if not found/expired/used.
   */
  async getInviteByToken(token: string): Promise<{ email: string; householdName: string } | null> {
    const rows = (await db.execute(
      sql`select i.email::text as email, h.name as household_name
            from public.household_invites i
            join public.households h on h.id = i.household_id
           where i.token = ${token} and i.accepted_at is null and i.expires_at > now()
           limit 1`,
    )) as unknown as Array<{ email: string; household_name: string }>;
    const r = rows[0];
    return r ? { email: r.email, householdName: r.household_name } : null;
  },

  async acceptInvite(token: string): Promise<string> {
    return runInUserTx(async (tx) => {
      const rows = (await tx.execute(
        sql`select public.accept_household_invite(${token}) as id`,
      )) as unknown as Array<{ id: string }>;
      const id = rows[0]?.id;
      if (!id) throw new Error("Invite acceptance failed");
      return id;
    });
  },
};
