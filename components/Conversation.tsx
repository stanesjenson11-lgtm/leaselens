"use client";

import { useEffect, useRef, useState } from "react";
import { api, type Chat, type Citation, type Msg } from "@/lib/client";
import { AnswerText } from "./CitationChip";
import { REFRESH } from "./Sidebar";

const STAGE_LABEL: Record<string, string> = {
  rewrite: "reading the conversation",
  retrieve: "searching the lease",
  rerank: "ranking clauses",
  grade: "checking the clauses answer it",
  retry: "widening the search",
  answer: "writing",
};

/** One deliberately unanswerable prompt, so the refusal gets discovered by
 *  anyone who clicks around rather than only by someone who knows to look. */
const SUGGESTIONS = [
  "Can my landlord keep my deposit for normal wear and tear?",
  "How much notice do I have to give before moving out?",
  "Am I allowed to keep a python?",
];

export default function Conversation({ chatId }: { chatId: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [question, setQuestion] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api<{ chat: Chat; messages: Msg[] }>(`/api/chats/${chatId}`)
      .then((d) => setMessages(d.messages))
      .catch((e) => setError(e.message));
  }, [chatId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, draft, stage]);

  async function ask(text: string) {
    if (!text.trim() || streaming) return;
    setQuestion("");
    setError(null);
    setStreaming(true);
    setStage("searching the lease");
    setDraft("");
    setCitations([]);
    setMessages((m) => [
      ...m,
      { id: `local-${Date.now()}`, role: "user", content: text, citations: null },
    ]);

    try {
      const res = await fetch(`/api/chats/${chatId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text }),
      });

      // A rejected request (429, 404, validation) answers with JSON, not SSE.
      if (!res.ok || !res.headers.get("content-type")?.includes("event-stream")) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      let cites: Citation[] = [];

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line; the tail may be partial.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          if (!frame.startsWith("data: ")) continue;
          const event = JSON.parse(frame.slice(6));

          if (event.type === "stage") setStage(STAGE_LABEL[event.stage] ?? event.stage);
          else if (event.type === "citations") {
            cites = event.citations;
            setCitations(cites);
          } else if (event.type === "text") {
            answer += event.text;
            setDraft(answer);
          } else if (event.type === "error") throw new Error(event.message);
          else if (event.type === "done") {
            answer = event.content;
            cites = event.citations;
          }
        }
      }

      setMessages((m) => [
        ...m,
        { id: `local-a-${Date.now()}`, role: "assistant", content: answer, citations: cites },
      ]);
      window.dispatchEvent(new Event(REFRESH));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setStreaming(false);
      setStage(null);
      setDraft("");
    }
  }

  return (
    <div className="flex h-dvh flex-1 flex-col">
      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-6 py-8">
        {messages.length === 0 && !streaming && (
          <div className="mt-16">
            <h1 className="font-serif text-2xl">What does your lease say?</h1>
            <p className="mt-2 text-muted">Try one of these:</p>
            <ul className="mt-4 space-y-2">
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => void ask(s)}
                    className="w-full rounded-lg border border-line px-4 py-3 text-left text-sm transition hover:border-accent hover:bg-panel"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ol className="space-y-6">
          {messages.map((m) =>
            m.role === "user" ? (
              <li key={m.id} className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent-soft px-4 py-2.5 text-sm text-accent">
                  {m.content}
                </p>
              </li>
            ) : (
              <li key={m.id}>
                <AnswerText content={m.content} citations={m.citations} />
              </li>
            ),
          )}

          {streaming && (
            <li>
              {draft ? (
                <AnswerText content={draft} citations={citations} />
              ) : (
                <p className="text-sm text-muted">
                  <span className="mr-2 inline-block size-1.5 animate-pulse rounded-full bg-accent align-middle" />
                  {stage}…
                </p>
              )}
            </li>
          )}
        </ol>

        {error && (
          <p role="alert" className="mt-6 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">
            {error}
          </p>
        )}

        <div ref={bottom} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
        className="border-t border-line bg-panel"
      >
        <div className="mx-auto flex max-w-3xl gap-3 px-6 py-4">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about a clause, a deadline, a deposit…"
            disabled={streaming}
            className="flex-1 rounded-md border border-line bg-paper px-3 py-2 outline-none focus:border-accent disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={streaming || !question.trim()}
            className="rounded-md bg-accent px-5 py-2 font-medium text-paper transition hover:opacity-90 disabled:opacity-40"
          >
            Ask
          </button>
        </div>
        <p className="mx-auto max-w-3xl px-6 pb-3 text-xs text-muted">
          Information from your document, not legal advice.
        </p>
      </form>
    </div>
  );
}
