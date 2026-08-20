import { GoogleGenAI } from "@google/genai";

/**
 * Pinned, so a rerun a month from now is the same run. Both are free-tier
 * eligible on Google AI Studio (no card on file) — Pro-tier models are not.
 */
export const ANSWER_MODEL = "gemini-3.7-flash";
export const UTILITY_MODEL = "gemini-3.1-flash-lite";

let client: GoogleGenAI | undefined;

export function genAI(): GoogleGenAI {
  return (client ??= new GoogleGenAI({}));
}

/** For tests, and for the eval harness when it stubs the model. */
export function setGenAI(c: GoogleGenAI | undefined): void {
  client = c;
}

/**
 * Gemini's free tier returns 503 UNAVAILABLE under load; it's transient, not
 * our bug. Retry with backoff on 503 only — anything else (400, 429 quota,
 * auth) fails immediately since a retry won't fix it.
 */
export async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if ((err as { status?: number })?.status !== 503 || attempt === tries) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

export type Usage = { in: number; out: number };

export const addUsage = (a: Usage, b: Partial<Usage>): Usage => ({
  in: a.in + (b.in ?? 0),
  out: a.out + (b.out ?? 0),
});
