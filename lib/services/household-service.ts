import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";

export type HouseholdMembership = {
  household: Tables<"households">;
  role: "owner" | "member";
};

const listForCurrentUser = cache(async function listForCurrentUser(): Promise<HouseholdMembership[]> {
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
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("create_household_with_owner", { _name: name });
    if (error || !data) throw error ?? new Error("Failed to create household");
    return data;
  },

  async members(householdId: string) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("household_members")
      .select("role, joined_at, profile:profiles(id, email, display_name, avatar_url)")
      .eq("household_id", householdId);
    if (error) throw error;
    return data ?? [];
  },

  async invite(args: {
    householdId: string;
    email: string;
    role?: "owner" | "member";
  }): Promise<Tables<"household_invites">> {
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
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("accept_household_invite", { _token: token });
    if (error || !data) throw error ?? new Error("Invite acceptance failed");
    return data;
  },
};
