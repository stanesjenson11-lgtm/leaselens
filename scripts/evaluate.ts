import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Type } from "@google/genai";
import { z } from "zod";
import "./env";
import { required } from "./env";
import { findUserByEmail, listDocuments } from "@/lib/db/queries";
import { genAI, ANSWER_MODEL } from "@/lib/llm";
import { answerQuestion } from "@/lib/rag/pipeline";
import type { Citation } from "@/lib/rag/types";

/**
 * Turns "it seems to work" into four numbers.
 *
 * Run against the seeded demo account (`npm run seed` first). Free-tier rate
 * limits (15 req/min on Flash) mean 24 questions plus one judge call each take
 * a few minutes, not API dollars — that's the point of running on Google AI
 * Studio's free tier. Still nightly, not per-push: it's slow, not cheap.
 */
required("DATABASE_URL");
required("GOOGLE_API_KEY");

const EMAIL = process.argv[2] ?? "demo@leaselens.app";

type Case = {
  id: string;
  document: string;
  question: string;
  answerable: boolean;
  evidence: string | null;
};

/** A refusal is a specific shape, not a vibe — the answer prompt mandates it. */
const REFUSED = /does not address|does not (say|cover|mention|specify)|is silent on/i;

const Judgement = z.object({
  grounded: z.boolean(),
  reason: z.string(),
});

const JUDGEMENT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    grounded: {
      type: Type.BOOLEAN,
      description: "every factual claim is supported by a cited clause",
    },
    reason: { type: Type.STRING, description: "one sentence" },
  },
  required: ["grounded", "reason"],
};

async function judge(question: string, answer: string, citations: Citation[]) {
  const clauses = citations
    .map((c) => `[${c.id}] ${c.heading ?? "clause"} (p.${c.pageStart})\n${c.text}`)
    .join("\n\n");

  const res = await genAI().models.generateContent({
    model: ANSWER_MODEL,
    contents: `Question: ${question}\n\nClauses:\n${clauses}\n\nAnswer:\n${answer}`,
    config: {
      systemInstruction:
        "You audit an answer against the clauses it was given. Grounded means every factual claim in the answer is supported by the text of a clause it cites. An answer that correctly declines because the clauses do not cover the question is grounded. An answer that adds general knowledge about leases or tenancy law is NOT grounded, however true that knowledge is.",
      responseMimeType: "application/json",
      responseSchema: JUDGEMENT_SCHEMA,
    },
  });

  try {
    return Judgement.parse(JSON.parse(res.text ?? "")).grounded;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------

const user = await findUserByEmail(EMAIL);
if (!user) throw new Error(`No seeded account for ${EMAIL}. Run: npm run seed`);

const docs = await listDocuments(user.id);
const byName = new Map(docs.map((d) => [d.filename.replace(/\.pdf$/, ""), d]));

const cases: Case[] = readFileSync(path.join(process.cwd(), "eval/golden.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

type Result = Case & {
  answer: string;
  citations: Citation[];
  recalled: boolean;
  refused: boolean;
  citationsValid: boolean;
  grounded: boolean | null;
  ms: number;
};

const results: Result[] = [];

for (const c of cases) {
  const doc = byName.get(c.document);
  if (!doc) throw new Error(`Document ${c.document} is not seeded for ${EMAIL}`);

  const started = Date.now();
  let answer = "";
  let citations: Citation[] = [];

  for await (const event of answerQuestion({
    userId: user.id,
    documentId: doc.id,
    question: c.question,
    history: [],
  })) {
    if (event.type === "citations") citations = event.citations;
    if (event.type === "done") {
      answer = event.content;
      citations = event.citations;
    }
    if (event.type === "error") answer = `[pipeline error] ${event.message}`;
  }

  const cited = [...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const result: Result = {
    ...c,
    answer,
    citations,
    // Recall@5: did the clause that decides the answer survive to the prompt?
    recalled: c.evidence ? citations.some((x) => x.text.includes(c.evidence!)) : false,
    refused: REFUSED.test(answer),
    // Every marker resolves to a clause that was actually supplied. A [7] with
    // five clauses is a fabricated citation, which is worse than none.
    citationsValid:
      cited.every((n) => n >= 1 && n <= citations.length) && (!c.answerable || cited.length > 0),
    grounded: null,
    ms: Date.now() - started,
  };

  result.grounded = answer.startsWith("[pipeline error]")
    ? false
    : await judge(c.question, answer, citations);

  results.push(result);
  console.log(
    `${result.recalled || !c.answerable ? "." : "R"}${result.refused === !c.answerable ? "." : "F"}${result.grounded ? "." : "G"} ${c.id}`,
  );
}

// ---------------------------------------------------------------------------

const answerable = results.filter((r) => r.answerable);
const unanswerable = results.filter((r) => !r.answerable);
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "n/a");
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

const rows = [
  ["Recall@5", pct(answerable.filter((r) => r.recalled).length, answerable.length), `${answerable.length} answerable questions`],
  ["Refusal accuracy", pct(unanswerable.filter((r) => r.refused).length, unanswerable.length), `${unanswerable.length} questions the leases do not cover`],
  ["False refusals", pct(answerable.filter((r) => r.refused).length, answerable.length), "answerable questions wrongly declined"],
  ["Citation validity", pct(results.filter((r) => r.citationsValid).length, results.length), "every [n] resolves to a supplied clause"],
  ["Groundedness", pct(results.filter((r) => r.grounded).length, results.length), `LLM-as-judge, ${ANSWER_MODEL}`],
  ["Median latency", `${(median(results.map((r) => r.ms)) / 1000).toFixed(1)}s`, "rewrite → retrieve → rerank → grade → answer"],
];

const report = `# Evaluation

Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · \`npm run eval\`
${cases.length} questions across ${byName.size} synthetic leases.

| Metric | Score | Notes |
| --- | --- | --- |
${rows.map(([k, v, n]) => `| ${k} | **${v}** | ${n} |`).join("\n")}

## Every case

| # | Question | Expected | Refused | Recall | Grounded |
| --- | --- | --- | --- | --- | --- |
${results
  .map(
    (r) =>
      `| \`${r.id}\` | ${r.question} | ${r.answerable ? "answer" : "decline"} | ${r.refused ? "yes" : "no"} | ${r.answerable ? (r.recalled ? "hit" : "miss") : "—"} | ${r.grounded ? "yes" : "no"} |`,
  )
  .join("\n")}

## Failures worth reading

${
  results
    .filter((r) => (r.answerable ? !r.recalled || r.refused || !r.grounded : !r.refused))
    .map((r) => `### \`${r.id}\`\n\n**${r.question}**\n\n> ${r.answer.replace(/\n+/g, "\n> ")}`)
    .join("\n\n") || "_None._"
}
`;

writeFileSync(path.join(process.cwd(), "eval/results.md"), report);
console.log(`\n${rows.map(([k, v]) => `${k.padEnd(20)} ${v}`).join("\n")}\n\neval/results.md written`);
