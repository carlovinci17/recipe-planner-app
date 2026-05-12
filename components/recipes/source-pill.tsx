import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { getRecipeSourceName } from "@/lib/recipes/source-name";
import { getSourcePalette } from "@/lib/recipes/source-color";

type SourceRecipeShape = {
  source_name: string | null;
  source_url: string | null;
  source_metadata: unknown;
};

type Variant = "solid" | "overlay";

/**
 * Colour-coded source label. Same source name always lands on the same
 * palette entry. Renders as an external link when `source_url` is set;
 * otherwise as a static pill.
 *
 * Two visual variants:
 *   - solid   — for in-flow placement (meta rows, listing cards over white)
 *   - overlay — translucent + bordered, for placement on top of a photo
 */
export function SourcePill({
  recipe,
  variant = "solid",
  className,
  size = "sm",
  asLink = true,
}: {
  recipe: SourceRecipeShape;
  variant?: Variant;
  className?: string;
  size?: "xs" | "sm";
  /**
   * When false, the pill renders as a plain span even if the recipe has a
   * `source_url`. Use this whenever the pill is placed inside another
   * `<a>` (e.g. a card wrapped in a Next `<Link>`) to avoid the nested-
   * anchor hydration error.
   */
  asLink?: boolean;
}) {
  const name = getRecipeSourceName(recipe);
  if (!name) return null;
  const palette = getSourcePalette(name);

  const sizing =
    size === "xs"
      ? "px-1.5 py-0.5 text-[10px]"
      : "px-2 py-0.5 text-xs";

  const tone =
    variant === "overlay"
      ? cn(
          palette.overlayBg,
          palette.overlayText,
          palette.overlayBorder,
          "border backdrop-blur-sm shadow-sm",
        )
      : cn(palette.bg, palette.text, palette.border, "border");

  const inner = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium leading-none capitalize",
        sizing,
        tone,
        className,
      )}
    >
      {recipe.source_url ? <ExternalLink className="h-3 w-3" aria-hidden /> : null}
      <span className="truncate normal-case">{name}</span>
    </span>
  );

  if (recipe.source_url && asLink) {
    return (
      <a
        href={recipe.source_url}
        target="_blank"
        rel="noopener noreferrer"
        title={`Open source: ${name}`}
        className="inline-flex max-w-full hover:opacity-90"
        onClick={(e) => e.stopPropagation()}
      >
        {inner}
      </a>
    );
  }
  return inner;
}
