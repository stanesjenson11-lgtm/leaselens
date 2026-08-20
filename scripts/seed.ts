import { readFileSync } from "node:fs";
import path from "node:path";
import "./env";
import { required } from "./env";
import { hashPassword } from "@/lib/auth/password";
import { applySchema } from "@/lib/db/migrate";
import { createDocument, createUser, findUserByEmail, listDocuments } from "@/lib/db/queries";
import { ingest } from "@/lib/ingest";
import { writeFixtures } from "./fixtures";

/**
 * Seeds the demo account. Uses the SAME ingest() the upload route uses, so a
 * seeded lease and an uploaded one are byte-identical in the database — there
 * is no second embedding path to drift.
 *
 *   npm run seed -- demo@leaselens.app "a-long-demo-password"
 */
required("DATABASE_URL");
required("GOOGLE_API_KEY");

const [email = "demo@leaselens.app", password = "leaselens-demo-password"] = process.argv.slice(2);

await applySchema();

const user =
  (await findUserByEmail(email)) ?? (await createUser(email, await hashPassword(password)));
console.log(`user ${user.email}`);

const fixtures = await writeFixtures(path.join(process.cwd(), "eval/fixtures"));
const existing = new Set((await listDocuments(user.id)).map((d) => d.filename));

for (const [name, file] of Object.entries(fixtures)) {
  const filename = `${name}.pdf`;
  if (existing.has(filename)) {
    console.log(`${filename} — already seeded, skipping`);
    continue;
  }

  const doc = await createDocument(user.id, filename);
  const { pages, chunks } = await ingest(user.id, doc.id, readFileSync(file));
  console.log(`${filename} — ${pages} pages, ${chunks} chunks`);
}

console.log(`\nsign in as ${email}`);
