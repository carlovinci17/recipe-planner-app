import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type RecipeRating = {
  rating: number;
  user_id: string;
  updated_at: string;
  user: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    email: string;
  } | null;
};

export const ratingService = {
  /**
   * Fetch all per-user ratings for a recipe, joined with profile metadata
   * for avatar / display-name rendering. RLS scopes by household membership.
   *
   * Returns [] (instead of throwing) if the underlying table is missing —
   * useful while the recipe_ratings migration is still pending so existing
   * recipe pages don't crash.
   */
  async listForRecipe(recipeId: string): Promise<RecipeRating[]> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("recipe_ratings")
      .select(
        "rating, user_id, updated_at, user:profiles(id, display_name, avatar_url, email)",
      )
      .eq("recipe_id", recipeId)
      .order("updated_at", { ascending: false });
    if (error) {
      // Postgres 42P01 = relation does not exist; PGRST205 = same via PostgREST.
      if (error.code === "42P01" || error.code === "PGRST205") {
        return [];
      }
      throw error;
    }
    return (data ?? []) as unknown as RecipeRating[];
  },

  /**
   * Set the current user's rating. 1–5; pass 0 (or call `clear`) to remove.
   */
  async setMyRating(args: { recipeId: string; rating: number }) {
    if (args.rating < 1 || args.rating > 5) {
      throw new Error("Rating must be between 1 and 5");
    }
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { error } = await supabase
      .from("recipe_ratings")
      .upsert(
        {
          recipe_id: args.recipeId,
          user_id: user.id,
          rating: args.rating,
        },
        { onConflict: "recipe_id,user_id" },
      );
    if (error) throw error;
  },

  /**
   * Average rating + count per recipe across the given id list. Used by the
   * recipes listing page to show "★ 4.3 (12)" on each card without N+1
   * queries. Returns a Map keyed by recipe id; recipes with no ratings are
   * absent from the map (callers should treat missing as "no ratings yet").
   *
   * Gracefully returns an empty Map if the recipe_ratings table doesn't
   * exist yet — same fall-through behavior as listForRecipe.
   */
  async getAggregatesForRecipes(
    recipeIds: string[],
  ): Promise<Map<string, { avg: number; count: number }>> {
    if (recipeIds.length === 0) return new Map();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("recipe_ratings")
      .select("recipe_id, rating")
      .in("recipe_id", recipeIds);
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") {
        return new Map();
      }
      throw error;
    }
    const out = new Map<string, { sum: number; count: number }>();
    for (const row of data ?? []) {
      const cur = out.get(row.recipe_id) ?? { sum: 0, count: 0 };
      cur.sum += row.rating;
      cur.count += 1;
      out.set(row.recipe_id, cur);
    }
    const result = new Map<string, { avg: number; count: number }>();
    for (const [id, { sum, count }] of out) {
      result.set(id, { avg: sum / count, count });
    }
    return result;
  },

  async clearMyRating(recipeId: string) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    const { error } = await supabase
      .from("recipe_ratings")
      .delete()
      .eq("recipe_id", recipeId)
      .eq("user_id", user.id);
    if (error) throw error;
  },
};
