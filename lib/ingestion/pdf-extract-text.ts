import "server-only";

/**
 * Extract the text layer from a PDF buffer using pdfjs-dist.
 * Returns an array of per-page strings. Pages with no selectable text
 * (scanned images) return an empty string.
 *
 * This is much cheaper than vision rendering — no canvas, no sharp, no images.
 * Use it first; fall back to pdf-to-images only when text is sparse.
 */
export async function pdfExtractText(args: {
  buffer: ArrayBuffer | Uint8Array;
  maxPages?: number;
}): Promise<{ pages: string[]; totalPages: number }> {
  const maxPages = args.maxPages ?? 50;

  const pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs") = await import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  );

  const buf = args.buffer;
  // Copy into a fresh ArrayBuffer — pdfjs transfers ownership of the buffer it
  // receives, detaching it. Without a copy the caller's buffer is unusable after
  // this call (e.g. for a subsequent vision-path pass in index-drive-file).
  const data: Uint8Array =
    buf instanceof ArrayBuffer ? new Uint8Array(buf.slice(0)) : new Uint8Array(buf);

  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true })
    .promise;

  const totalPages = doc.numPages;
  const pagesToRead = Math.min(totalPages, maxPages);
  const pages: string[] = [];

  for (let i = 1; i <= pagesToRead; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push(text);
    page.cleanup();
  }

  await doc.cleanup();
  await doc.destroy();
  return { pages, totalPages };
}

/** Average chars per page — used to decide if a PDF has a real text layer. */
export function avgCharsPerPage(pages: string[]): number {
  if (pages.length === 0) return 0;
  return pages.reduce((sum, p) => sum + p.length, 0) / pages.length;
}
