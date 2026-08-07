import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  adminClient,
  authedClientFor,
  createTestUser,
  deleteTestUser,
  seedHousehold,
  type SeededUser,
} from "./helpers";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { householdService } from "@/lib/services/household-service";

/**
 * CHARACTERIZATION — the create_household_with_owner RPC: atomically creates a
 * household and adds the caller as owner.
 */
describe("householdService.create — current behaviour (RPC)", () => {
  let user: SeededUser;
  let householdId: string | undefined;

  beforeAll(async () => {
    user = await createTestUser();
    const authed = await authedClientFor(user);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authed as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
  }, 30_000);

  afterAll(async () => {
    if (householdId) await adminClient().from("households").delete().eq("id", householdId);
    if (user) await deleteTestUser(user.id);
  });

  it("creates a household and adds the caller as owner", async () => {
    householdId = await householdService.create("My Home");
    const admin = adminClient();
    const { data: hh } = await admin
      .from("households")
      .select("name, created_by")
      .eq("id", householdId)
      .single();
    expect(hh?.name).toBe("My Home");
    expect(hh?.created_by).toBe(user.id);

    const { data: member } = await admin
      .from("household_members")
      .select("role")
      .eq("household_id", householdId)
      .eq("user_id", user.id)
      .single();
    expect(member?.role).toBe("owner");
  });
});

/**
 * CHARACTERIZATION — the accept_household_invite RPC: an invited user, running
 * as themselves, joins the household the token points to.
 */
describe("householdService.acceptInvite — current behaviour (RPC)", () => {
  let owner: SeededUser;
  let invitee: SeededUser;
  let householdId: string;
  let inviteToken: string;

  beforeAll(async () => {
    owner = await createTestUser();
    const authedOwner = await authedClientFor(owner);
    householdId = await seedHousehold(authedOwner, "Shared Home");

    invitee = await createTestUser();

    // Owner creates an invite for the invitee's email (token auto-generated).
    const { data: invite, error } = await authedOwner
      .from("household_invites")
      .insert({
        household_id: householdId,
        email: invitee.email,
        role: "member",
        invited_by: owner.id,
      })
      .select("token")
      .single();
    if (error || !invite) throw error ?? new Error("invite seed failed");
    inviteToken = invite.token;

    // Run the service AS the invitee.
    const authedInvitee = await authedClientFor(invitee);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authedInvitee as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
  }, 30_000);

  afterAll(async () => {
    if (householdId) await adminClient().from("households").delete().eq("id", householdId);
    if (owner) await deleteTestUser(owner.id);
    if (invitee) await deleteTestUser(invitee.id);
  });

  it("adds the invitee as a member and returns the household id", async () => {
    const returned = await householdService.acceptInvite(inviteToken);
    expect(returned).toBe(householdId);

    const { data: member } = await adminClient()
      .from("household_members")
      .select("role")
      .eq("household_id", householdId)
      .eq("user_id", invitee.id)
      .maybeSingle();
    expect(member?.role).toBe("member");
  });
});
