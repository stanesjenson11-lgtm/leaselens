import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { chunkPages } from "@/lib/ingest/chunk";
import { extractPages, validateUpload } from "@/lib/ingest/pdf";
import { MAPLE_COURT, renderPdf } from "@/scripts/fixtures";

/**
 * The chunker tests work on strings. This one goes through a real PDF, because
 * everything interesting about page attribution happens in the gap between
 * "text" and "text that came out of a PDF at a particular page".
 */
let pdf: Uint8Array;
beforeAll(async () => {
  pdf = await renderPdf(MAPLE_COURT);
});

describe("upload validation", () => {
  it("checks magic bytes, not the file extension", () => {
    const notAPdf = new TextEncoder().encode("GIF89a and some bytes");
    expect(() => validateUpload(notAPdf, "lease.pdf")).toThrow(/isn't a PDF/);
  });

  it("rejects a non-pdf name outright", () => {
    expect(() => validateUpload(pdf, "lease.docx")).toThrow(/Only PDF/);
  });

  it("accepts a real PDF", () => {
    expect(() => validateUpload(pdf, "lease.pdf")).not.toThrow();
  });

  it("rejects a scan — pages with no text layer", async () => {
    // Blank pages are what a scanned lease looks like to a text extractor.
    // Embedding them would build an index that retrieves nothing, silently.
    const blank = await PDFDocument.create();
    for (let i = 0; i < 3; i++) blank.addPage([595, 842]);

    await expect(extractPages(await blank.save())).rejects.toThrow(/scan/i);
  });
});

describe("a real lease PDF, end to end", () => {
  it("extracts pages with text", async () => {
    const pages = await extractPages(pdf);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0].number).toBe(1);
    expect(pages[0].text).toContain("MAPLE COURT");
  });

  it("chunks it on clause boundaries with usable heading paths", async () => {
    const chunks = chunkPages(await extractPages(pdf));

    const deposit = chunks.find((c) => c.content.includes("$2,400"));
    expect(deposit?.headingPath).toContain("5. SECURITY DEPOSIT");

    const pets = chunks.find((c) => c.content.includes("two (2) cats or dogs"))!;
    expect(pets.headingPath).toBe("8. PETS");
    // Whole clause, subclauses included: asking "can I keep a python?" has to
    // retrieve 8.4 (service animals) alongside 8.1, or the answer is confident
    // and incomplete.
    expect(pets.content).toContain("8.4");

    // And nothing from a neighbouring clause bled in under the PETS heading.
    expect(pets.content).not.toContain("ALTERATIONS");
    expect(pets.content).not.toContain("QUIET ENJOYMENT");
  });

  it("gives every clause its own chunk, correctly labelled", async () => {
    const chunks = chunkPages(await extractPages(pdf));
    const paths = chunks.map((c) => c.headingPath);

    for (const heading of [
      "3. RENT",
      "5. SECURITY DEPOSIT",
      "8. PETS",
      "11. ENTRY BY LANDLORD",
      "13. EARLY TERMINATION",
    ])
      expect(paths).toContain(heading);

    // "…gives notice under / Section 12." is a wrapped sentence, not a heading.
    expect(paths).not.toContain("Section 12.");
  });

  it("produces chunks of a size worth embedding", async () => {
    const chunks = chunkPages(await extractPages(pdf));
    expect(chunks.length).toBeGreaterThan(8);
    // Nothing so small it retrieves on noise, nothing so large it dilutes.
    expect(chunks.every((c) => c.content.length >= 40)).toBe(true);
    expect(chunks.every((c) => c.content.length <= 2400)).toBe(true);
  });

  it("keeps every page reachable, so a citation can name any of them", async () => {
    const pages = await extractPages(pdf);
    const chunks = chunkPages(pages);
    const covered = new Set(chunks.map((c) => c.pageStart));
    for (const page of pages) expect(covered.has(page.number)).toBe(true);
  });
});
