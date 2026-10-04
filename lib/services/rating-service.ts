import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { profiles, recipeRatings } from "@/lib/db/schema";
import { runInUserTx } from "./user-tx";

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
   * Every per-user rating for a recipe, joined with profile metadata for
   * avatar / display-name rendering. Runs inside `runInUserTx`, so Row-Level
   * Security (RLS) scopes the rows to the caller's household.
   */
  async listForRecipe(recipeId: string): Promise<RecipeRating[]> {
    return runInUserTx(async (tx) => {
      const rows = await tx
        .select({
          rating: recipeRatings.rating,
          user_id: recipeRatings.userId,
          updated_at: recipeRatings.updatedAt,
          u_id: profiles.id,
          u_display_name: profiles.displayName,
          u_avatar_url: profiles.avatarUrl,
          u_email: profiles.email,
        })
        .from(recipeRatings)
        .innerJoin(profiles, eq(profiles.id, recipeRatings.userId))
        .where(eq(recipeRatings.recipeId, recipeId))
        .orderBy(desc(recipeRatings.updatedAt));
      return rows.map((r) => ({
        rating: r.rating,
        user_id: r.user_id,
        updated_at: r.updated_at,
        user: {
          id: r.u_id,
          display_name: r.u_display_name,
          avatar_url: r.u_avatar_url,
          email: r.u_email,
        },
      }));
    });
  },

  /**
   * Set the current user's rating. 1-5; pass 0 (or call `clear`) to remove.
   */
  async setMyRating(args: { recipeId: string; rating: number }) {
    if (args.rating < 1 || args.rating > 5) {
      throw new Error("Rating must be between 1 and 5");
    }
    await runInUserTx((tx, userId) =>
      tx
        .insert(recipeRatings)
        .values({ recipeId: args.recipeId, userId, rating: args.rating })
        .onConflictDoUpdate({
          target: [recipeRatings.recipeId, recipeRatings.userId],
          set: { rating: args.rating },
        }),
    );
  },

  /**
   * Average rating + count per recipe across the given id list. Used by the
   * recipes listing page to show "4.3 (12)" on each card without N+1 queries.
   * Returns a Map keyed by recipe id; recipes with no ratings are absent from
   * the map, so callers should treat missing as "no ratings yet".
   */
  async getAggregatesForRecipes(
    recipeIds: string[],
  ): Promise<Map<string, { avg: number; count: number }>> {
    if (recipeIds.length === 0) return new Map();

    const rows = await runInUserTx((tx) =>
      tx
        .select({ recipe_id: recipeRatings.recipeId, rating: recipeRatings.rating })
        .from(recipeRatings)
        .where(inArray(recipeRatings.recipeId, recipeIds)),
    );

    const out = new Map<string, { sum: number; count: number }>();
    for (const row of rows) {
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
    await runInUserTx((tx, userId) =>
      tx
        .delete(recipeRatings)
        .where(and(eq(recipeRatings.recipeId, recipeId), eq(recipeRatings.userId, userId))),
    );
  },
};
