import { extractText } from "unpdf";
import { badRequest } from "../http";

export type Page = { number: number; text: string };

export const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_PAGES = 60;
export const MAX_DOCS_PER_USER = 5;

/** Below this, the "text layer" is page furniture and nothing else. */
const MIN_CHARS_PER_PAGE = 120;

/**
 * Everything here runs before a single byte is parsed. The page cap is lower
 * than the split-deploy version's 300 for a concrete reason: ingestion has to
 * finish inside one Vercel function invocation, and the ceiling there is 60s.
 * ponytail: raise MAX_PAGES only alongside a queue — a bigger cap on the same
 * synchronous path just moves the failure from "rejected" to "timed out".
 */
export function validateUpload(bytes: Uint8Array, filename: string): void {
  if (!/\.pdf$/i.test(filename)) throw badRequest("Only PDF files are accepted.");
  if (bytes.byteLength > MAX_BYTES)
    throw badRequest(`That file is over ${MAX_BYTES / 1024 / 1024} MB.`);
  // Magic bytes, not the extension: the extension is whatever the client says.
  const magic = new TextDecoder().decode(bytes.slice(0, 5));
  if (magic !== "%PDF-") throw badRequest("That file isn't a PDF.");
}

export async function extractPages(bytes: Uint8Array): Promise<Page[]> {
  let totalPages: number;
  let text: string[];
  try {
    // A copy, deliberately: pdf.js detaches the ArrayBuffer it is handed, so
    // the caller's `bytes` would be a zero-length view afterwards and any
    // second read of the same upload would fail as "damaged".
    ({ totalPages, text } = await extractText(new Uint8Array(bytes), { mergePages: false }));
  } catch {
    throw badRequest("That PDF could not be read. It may be encrypted or damaged.");
  }

  if (totalPages > MAX_PAGES)
    throw badRequest(`That lease is ${totalPages} pages; the limit is ${MAX_PAGES}.`);

  const pages = text.map((t, i) => ({ number: i + 1, text: t ?? "" }));

  // A scanned lease has pages and no text. Rejecting it loudly beats embedding
  // empty strings and shipping an index that silently retrieves nothing.
  const chars = pages.reduce((n, p) => n + p.text.trim().length, 0);
  if (chars / Math.max(pages.length, 1) < MIN_CHARS_PER_PAGE)
    throw badRequest(
      "This PDF has no selectable text — it looks like a scan. LeaseLens can't read scanned documents yet.",
    );

  return pages;
}
