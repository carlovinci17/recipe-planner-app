/**
 * Generates all favicon sizes from public/app-icon.png
 * Run: npx tsx scripts/generate-favicons.ts
 */
import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";

const SRC = path.join(process.cwd(), "public", "app-icon.png");
const APP_DIR = path.join(process.cwd(), "app");
const PUBLIC_DIR = path.join(process.cwd(), "public");

const sizes = [
  // Next.js App Router icon files
  { out: path.join(APP_DIR, "icon.png"),        size: 512 },
  { out: path.join(APP_DIR, "apple-icon.png"),  size: 180 },
  // Standard favicon sizes
  { out: path.join(PUBLIC_DIR, "favicon-32x32.png"), size: 32 },
  { out: path.join(PUBLIC_DIR, "favicon-16x16.png"), size: 16 },
  // Android / PWA
  { out: path.join(PUBLIC_DIR, "icon-192.png"), size: 192 },
  { out: path.join(PUBLIC_DIR, "icon-512.png"), size: 512 },
];

async function main() {
  console.log("Generating favicons from", SRC);

  for (const { out, size } of sizes) {
    await sharp(SRC)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(out);
    console.log(`  ✓ ${path.relative(process.cwd(), out)} (${size}×${size})`);
  }

  // Generate favicon.ico (multi-size: 16 + 32 + 48) using the 32px as a single-size ICO
  // Sharp doesn't support .ico natively — write a 32px PNG at app/favicon.ico path trick:
  // Next.js serves app/favicon.ico as the browser favicon regardless of format
  await sharp(SRC)
    .resize(32, 32, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(APP_DIR, "favicon.ico"));
  console.log("  ✓ app/favicon.ico (32×32 PNG served as ICO)");

  console.log("\nDone! Update app/layout.tsx metadata if needed.");
}

main().catch(console.error);
