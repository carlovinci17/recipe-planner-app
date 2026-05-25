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
  /** Hard cap to prevent runaway PDFs. */
  maxPages?: number;
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
  const data: Uint8Array =
    buf instanceof ArrayBuffer
      ? new Uint8Array(buf)
      : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;

  const totalPages = Math.min(doc.numPages, maxPages);
  const images: Buffer[] = [];
  const scale = dpi / 72; // pdfjs default is 72 DPI

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
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
