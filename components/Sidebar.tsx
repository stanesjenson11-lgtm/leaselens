"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, post, type Chat, type Doc } from "@/lib/client";
import UploadDropzone from "./UploadDropzone";

/** Conversation fires this when an answer lands, so a fresh auto-title shows up
 *  without a reload. Cheaper than a store for the one thing that needs it. */
export const REFRESH = "leaselens:refresh";

const STATUS: Record<string, string> = {
  pending: "queued",
  parsing: "reading pages",
  embedding: "indexing clauses",
  ready: "ready",
  failed: "failed",
};

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);

  const load = useCallback(async () => {
    const [d, c] = await Promise.all([api<Doc[]>("/api/documents"), api<Chat[]>("/api/chats")]);
    setDocs(d);
    setChats(c);
  }, []);

  useEffect(() => {
    void load();
  }, [load, pathname]);

  useEffect(() => {
    const handler = () => void load();
    window.addEventListener(REFRESH, handler);
    return () => window.removeEventListener(REFRESH, handler);
  }, [load]);

  // Ingestion runs after the upload response returns, so the only way to learn
  // it finished is to ask. Polling stops the moment nothing is in flight.
  const working = docs.some((d) => d.status !== "ready" && d.status !== "failed");
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [working, load]);

  async function startChat(documentId: string) {
    const chat = await post<Chat>("/api/chats", { documentId });
    router.push(`/chat/${chat.id}`);
  }

  async function signOut() {
    await post("/api/auth/logout", {});
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex h-dvh w-72 shrink-0 flex-col gap-5 overflow-y-auto border-r border-line bg-panel px-4 py-5">
      <Link href="/chat" className="text-sm uppercase tracking-[0.2em] text-muted">
        LeaseLens
      </Link>

      <UploadDropzone onUploaded={load} />

      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Documents</h2>
        {docs.length === 0 && <p className="text-sm text-muted">Nothing uploaded yet.</p>}
        <ul className="space-y-1">
          {docs.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                disabled={d.status !== "ready"}
                onClick={() => void startChat(d.id)}
                title={d.error ?? undefined}
                className="w-full rounded-lg px-2 py-1.5 text-left transition hover:shadow-neu-sm disabled:opacity-60 disabled:hover:shadow-none"
              >
                <span className="block truncate text-sm">{d.filename}</span>
                <span className="block text-xs text-muted">
                  {d.status === "ready"
                    ? `${d.page_count ?? "?"} pages · ask a question`
                    : (STATUS[d.status] ?? d.status)}
                  {d.status !== "ready" && d.status !== "failed" && " …"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex-1">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
          Conversations
        </h2>
        {chats.length === 0 && (
          <p className="text-sm text-muted">Pick a document above to start one.</p>
        )}
        <ul className="space-y-1">
          {chats.map((c) => {
            const active = pathname === `/chat/${c.id}`;
            return (
              <li key={c.id}>
                <Link
                  href={`/chat/${c.id}`}
                  className={`block truncate rounded-lg px-2 py-1.5 text-sm transition ${
                    active ? "bg-accent text-accent-ink shadow-neu-sm" : "hover:shadow-neu-sm"
                  }`}
                >
                  {c.title ?? "New conversation"}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex items-center justify-between border-t border-line pt-3 text-xs">
        <Link href="/admin" className="text-muted underline-offset-2 hover:underline">
          Pipeline
        </Link>
        <button type="button" onClick={signOut} className="text-muted hover:underline">
          Sign out
        </button>
      </div>
    </aside>
  );
}
