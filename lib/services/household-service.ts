import "server-only";
import { cache } from "react";
import { asc, eq, sql } from "drizzle-orm";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { households, householdInvites, householdMembers, profiles } from "@/lib/db/schema";
import { env } from "@/lib/env";
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

const listForCurrentUser = cache(async function listForCurrentUser(): Promise<HouseholdMembership[]> {
  if (env.DATABASE_URL) {
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
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("household_members")
    .select("role, household:households(*)")
    .order("joined_at", { ascending: true });
  if (error) throw error;
  // Embedded `households(*)` select isn't statically typed because we don't
  // declare FK Relationships in the hand-authored Database type. Cast through
  // unknown — runtime shape matches Tables<"households">.
  type Row = { role: "owner" | "member"; household: Tables<"households"> | null };
  const rows = (data ?? []) as unknown as Row[];
  return rows
    .filter((row): row is Row & { household: Tables<"households"> } => !!row.household)
    .map((row) => ({ household: row.household, role: row.role }));
});

export const householdService = {
  listForCurrentUser,

  async getActive(householdId: string): Promise<Tables<"households"> | null> {
    if (env.DATABASE_URL) {
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
    }
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("households")
      .select("*")
      .eq("id", householdId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async create(name: string): Promise<string> {
    if (env.DATABASE_URL) {
      return runInUserTx(async (tx) => {
        const rows = (await tx.execute(
          sql`select public.create_household_with_owner(${name}) as id`,
        )) as unknown as Array<{ id: string }>;
        const id = rows[0]?.id;
        if (!id) throw new Error("Failed to create household");
        return id;
      });
    }
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("create_household_with_owner", { _name: name });
    if (error || !data) throw error ?? new Error("Failed to create household");
    return data;
  },

  async members(householdId: string): Promise<HouseholdMemberRow[]> {
    if (env.DATABASE_URL) {
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
    }
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("household_members")
      .select("role, joined_at, profile:profiles(id, email, display_name, avatar_url)")
      .eq("household_id", householdId);
    if (error) throw error;
    // Embedded profiles(...) isn't statically typed (no declared FK Relationships
    // in the hand-authored Database type); runtime shape matches HouseholdMemberRow.
    return (data ?? []) as unknown as HouseholdMemberRow[];
  },

  async invite(args: {
    householdId: string;
    email: string;
    role?: "owner" | "member";
  }): Promise<Tables<"household_invites">> {
    if (env.DATABASE_URL) {
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
    }
    const supabase = await createSupabaseServerClient();
    const { error: profErr } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", args.email.toLowerCase())
      .maybeSingle();
    if (profErr) throw profErr;
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) throw userErr ?? new Error("Not authenticated");

    const { data, error } = await supabase
      .from("household_invites")
      .insert({
        household_id: args.householdId,
        email: args.email.toLowerCase(),
        role: args.role ?? "member",
        invited_by: user.id,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async acceptInvite(token: string): Promise<string> {
    if (env.DATABASE_URL) {
      return runInUserTx(async (tx) => {
        const rows = (await tx.execute(
          sql`select public.accept_household_invite(${token}) as id`,
        )) as unknown as Array<{ id: string }>;
        const id = rows[0]?.id;
        if (!id) throw new Error("Invite acceptance failed");
        return id;
      });
    }
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("accept_household_invite", { _token: token });
    if (error || !data) throw error ?? new Error("Invite acceptance failed");
    return data;
  },
};
