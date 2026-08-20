import { insertChunks, setDocumentStatus } from "../db/queries";
import { embed } from "../rag/embed";
import { chunkPages } from "./chunk";
import { extractPages } from "./pdf";

/**
 * The single ingest path. `POST /api/documents` calls it and so does the seed
 * script, so a seeded lease and an uploaded one are byte-identical in the
 * database — no second embedding code path to drift out of sync with this one.
 *
 * Status is written at each stage so the UI can show `parsing → embedding →
 * ready` instead of a spinner that means nothing.
 */
export async function ingest(
  userId: string,
  documentId: string,
  bytes: Uint8Array,
): Promise<{ pages: number; chunks: number }> {
  try {
    await setDocumentStatus(userId, documentId, "parsing");
    const pages = await extractPages(bytes);

    const chunks = chunkPages(pages);
    if (chunks.length === 0)
      throw new Error("No readable clauses were found in this document.");

    await setDocumentStatus(userId, documentId, "embedding", { pageCount: pages.length });
    const vectors = await embed(
      chunks.map((c) => c.content),
      "RETRIEVAL_DOCUMENT",
    );

    await insertChunks(
      userId,
      documentId,
      chunks.map((c, i) => ({
        ordinal: c.ordinal,
        headingPath: c.headingPath,
        pageStart: c.pageStart,
        pageEnd: c.pageEnd,
        content: c.content,
        embedding: vectors[i],
      })),
    );

    await setDocumentStatus(userId, documentId, "ready", { pageCount: pages.length });
    return { pages: pages.length, chunks: chunks.length };
  } catch (e) {
    // The user needs to know *why*, and `documents.error` is where the UI reads
    // it from. Rethrow so the caller still sees the failure.
    const message = e instanceof Error ? e.message : "Ingestion failed.";
    await setDocumentStatus(userId, documentId, "failed", { error: message });
    throw e;
  }
}
