import { denseSearch, keywordSearch } from "../db/queries";
import { embed } from "./embed";
import { rrf } from "./rrf";
import type { Clause } from "./types";

/**
 * Both halves of the hybrid are separate SQL statements against the same table,
 * and both carry `user_id = $1 AND document_id = $2`. There is no path where
 * one is scoped and the other isn't, because there is no third place retrieval
 * can read chunks from.
 *
 * Dense finds the paraphrase — "can I have a snake" against "animals of any
 * kind". Keyword finds the exact term the embedding drifted past — a defined
 * term like "Permitted Occupant" that only means anything inside this lease.
 * Leases need both.
 */
export async function hybridSearch(
  userId: string,
  documentId: string,
  query: string,
  limit = 25,
): Promise<Clause[]> {
  const [vector] = await embed([query], "RETRIEVAL_QUERY");

  const [dense, keyword] = await Promise.all([
    denseSearch(userId, documentId, vector, limit),
    keywordSearch(userId, documentId, query, limit),
  ]);

  return rrf([dense, keyword], limit);
}
