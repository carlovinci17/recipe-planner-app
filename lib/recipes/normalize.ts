/**
 * Normalization for AI-generated recipe metadata (tags, cuisines, source names).
 *
 * Tags/cuisines come from the tagging model as free-form strings, so the same
 * concept arrives many ways ("10 minute" / "ten minute" / "10-min"). This is the
 * single source of truth for what "clean" means, used BOTH at write-time
 * (persist / tagging) and by the one-time cleanup script, so they never diverge.
 */

// Word-number forms we bother to recognise in time phrases.
const NUM_WORD =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|ninety";

// A tag is "time-only noise" if it contains a cooking-duration phrase (digit or
// common word-number + a time unit). Cooking time now lives in the structured
// total_time_min field + the cook-time filter, so these tags are pure clutter.
// The cleanup script's dry-run lets you eyeball exactly what this drops.
const TIME_PATTERN = new RegExp(
  `\\b(?:\\d+|${NUM_WORD})\\s*-?\\s*(?:min|mins|minute|minutes|hr|hrs|hour|hours)\\b`,
  "i",
);

/** Normalize one tag/cuisine token. Returns null if it should be dropped. */
export function normalizeTag(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, " ").toLowerCase();
  if (!s) return null;
  if (TIME_PATTERN.test(s)) return null; // "10 minutes", "under 30 min", "ten minute", …
  return s;
}

/** Normalize + case-insensitively dedupe an array of tags/cuisines. */
export function normalizeList(raw: string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw ?? []) {
    const n = normalizeTag(item);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/** Trim + single-space a source name. Casing is preserved (it's a display value). */
export function normalizeSourceName(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().replace(/\s+/g, " ");
  return s.length ? s : null;
}

/**
 * Build a map from each raw source-name value → a single CANONICAL display,
 * merging case/whitespace variants ("Health with Bec" / "Health With Bec" → one).
 * Canonical = the most frequent casing (ties → first seen), so well-known names
 * keep their nice capitalisation (e.g. "BBC Good Food") instead of being mangled.
 */
export function canonicalSourceName(
  rawNames: (string | null | undefined)[],
): Map<string, string> {
  const groups = new Map<string, Map<string, number>>(); // lowercased key → { display → count }
  for (const raw of rawNames) {
    const norm = normalizeSourceName(raw);
    if (!norm) continue;
    const key = norm.toLowerCase();
    const byDisplay = groups.get(key) ?? new Map<string, number>();
    byDisplay.set(norm, (byDisplay.get(norm) ?? 0) + 1);
    groups.set(key, byDisplay);
  }
  const canonical = new Map<string, string>(); // normalized display → canonical display
  for (const byDisplay of groups.values()) {
    let best = "";
    let bestCount = -1;
    for (const [display, count] of byDisplay) {
      if (count > bestCount) {
        best = display;
        bestCount = count;
      }
    }
    for (const display of byDisplay.keys()) canonical.set(display, best);
  }
  return canonical;
}
