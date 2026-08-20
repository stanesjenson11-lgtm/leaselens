"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { post } from "@/lib/client";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const register = mode === "register";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(`/api/auth/${mode}`, { email, password });
      // The session cookie is already set by the response; nothing to store.
      router.push("/chat");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <Link href="/" className="text-sm uppercase tracking-[0.2em] text-muted">
        LeaseLens
      </Link>
      <h1 className="mt-3 font-serif text-3xl">
        {register ? "Create an account" : "Welcome back"}
      </h1>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <label className="block">
          <span className="text-sm text-muted">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 outline-none focus:border-accent"
          />
        </label>

        <label className="block">
          <span className="text-sm text-muted">Password</span>
          <input
            type="password"
            required
            minLength={10}
            autoComplete={register ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 outline-none focus:border-accent"
          />
          {register && (
            <span className="mt-1 block text-xs text-muted">At least 10 characters.</span>
          )}
        </label>

        {error && (
          <p role="alert" className="rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-accent px-4 py-2.5 font-medium text-paper transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "…" : register ? "Create account" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-sm text-muted">
        {register ? "Already have an account? " : "No account yet? "}
        <Link href={register ? "/login" : "/register"} className="text-accent underline">
          {register ? "Sign in" : "Create one"}
        </Link>
      </p>
    </main>
  );
}
