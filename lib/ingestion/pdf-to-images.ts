import "server-only";
import sharp from "sharp";

/**
 * Convert a PDF buffer into one JPEG image per page.
 *
 * Strategy: use pdfjs-dist's `getDocument` to render each page to a canvas,
 * then encode through Sharp at a target DPI suitable for vision models.
 *
 * Output format is JPEG (q85, mozjpeg) at 1600px max width. PNG output was
 * 5–10× larger with no real benefit — JPEG at this quality is visually
 * indistinguishable to human eyes and Claude vision reads text equally well.
 * Smaller files = faster signed-URL fetches by Anthropic + faster cover
 * loads in the UI when the on-the-fly transform isn't cached yet.
 *
 * We dynamically import pdfjs because it's CJS/ESM-flaky and only needed
 * inside background functions — keeps the Vercel edge runtime happy.
 */
export async function pdfBufferToPageImages(args: {
  buffer: ArrayBuffer | Uint8Array;
  /** Target DPI when rasterizing. 200 is a reasonable balance. */
  dpi?: number;
  /** Hard cap to prevent runaway PDFs. Ignored when `pageNumbers` is given. */
  maxPages?: number;
  /**
   * Explicit 1-based pages to render, e.g. [2,5,6,7,8]. When given, ONLY these
   * pages are rasterized — the expensive part of a big cookbook import is
   * rendering pages nobody asked for, so we skip them rather than render and
   * discard. Out-of-range entries are dropped silently; the caller validates
   * against the real page count and reports that properly.
   */
  pageNumbers?: number[];
  /**
   * Called once, before rendering starts, with the pages actually chosen and
   * the document's real page count. The caller needs both — to record which
   * book page each image came from, and to tell the user when they asked for
   * a page the document doesn't have. A callback rather than a return value
   * so the existing `Buffer[]` signature keeps working everywhere else.
   */
  onSelection?: (info: { selected: number[]; documentPages: number }) => void;
  /** Called after each page is rendered. pageNum is the 1-based source page. */
  onPageRendered?: (pageNum: number, totalPages: number) => void | Promise<void>;
}): Promise<Buffer[]> {
  const dpi = args.dpi ?? 200;
  const maxPages = args.maxPages ?? 25;

  // pdfjs-dist legacy build is the safest one for server contexts
  const pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs") = await import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  );

  // pdfjs-dist explicitly rejects Node's Buffer (`instanceof Buffer` check)
  // even though Buffer extends Uint8Array. Force a plain Uint8Array view —
  // same memory, different prototype, no copy.
  const buf = args.buffer;
  // Copy into a fresh ArrayBuffer — pdfjs transfers ownership and detaches
  // the source. Using a view of a pooled Node Buffer also causes detach errors.
  const data: Uint8Array =
    buf instanceof ArrayBuffer ? new Uint8Array(buf.slice(0)) : new Uint8Array(buf);

  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;

  // Either an explicit selection, or the leading run up to the cap.
  const selected =
    args.pageNumbers && args.pageNumbers.length > 0
      ? Array.from(new Set(args.pageNumbers))
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= doc.numPages)
          .sort((a, b) => a - b)
      : Array.from({ length: Math.min(doc.numPages, maxPages) }, (_, i) => i + 1);

  args.onSelection?.({ selected, documentPages: doc.numPages });

  const totalPages = selected.length;
  const images: Buffer[] = [];
  const scale = dpi / 72; // pdfjs default is 72 DPI

  for (let i = 0; i < selected.length; i++) {
    const pageNum = selected[i]!;
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    // Render path differs in node — use OffscreenCanvas-shaped fallback via
    // sharp pipeline. We get the page as raw RGBA pixels through a virtual canvas.
    const canvasFactory = new NodeCanvasFactory();
    const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);

    await page.render({
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      canvasFactory,
    } as Parameters<typeof page.render>[0]).promise;

    // @napi-rs/canvas requires an explicit MIME type — unlike node-canvas,
    // bare `toBuffer()` throws StringExpected. We round-trip PNG → sharp →
    // JPEG (mozjpeg q82) because that's lossless on the rasterized output
    // and lets sharp do both the resize and the perceptual encode in one
    // pipeline. 1200px is still plenty for OCR (Claude vision tested
    // accurate down to ~800px on typeset cookbook text) and saves ~30%
    // vs 1600. Final files are ~80–200KB per page (vs 0.5–2MB as PNG).
    const jpeg = await sharp(canvas.toBuffer("image/png"))
      .resize({ width: 1200, withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();

    images.push(jpeg);
    page.cleanup();
    await args.onPageRendered?.(pageNum, totalPages);
  }

  await doc.cleanup();
  await doc.destroy();
  return images;
}

// --- minimal canvas factory backed by `@napi-rs/canvas` semantics via raw Buffer ---

interface NodeCanvas {
  width: number;
  height: number;
  toBuffer(mime: "image/png" | "image/jpeg" | "image/webp"): Buffer;
}

class NodeCanvasFactory {
  create(width: number, height: number): { canvas: NodeCanvas; context: unknown } {
    // Lazy require — installed in production via `@napi-rs/canvas` peer dep.
    // In Vercel Functions runtime, set NODE_OPTIONS=--no-warnings to silence noise.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createCanvas } = require("@napi-rs/canvas") as typeof import("@napi-rs/canvas");
    const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
    const context = canvas.getContext("2d");
    return { canvas: canvas as unknown as NodeCanvas, context };
  }

  reset(canvasAndContext: { canvas: NodeCanvas }, width: number, height: number) {
    canvasAndContext.canvas.width = Math.ceil(width);
    canvasAndContext.canvas.height = Math.ceil(height);
  }

  destroy(canvasAndContext: { canvas: NodeCanvas | null }) {
    canvasAndContext.canvas = null;
  }
}
