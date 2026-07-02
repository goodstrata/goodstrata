import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { signIn, signUp } from "../lib/auth";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

interface DemoInfo {
  demo: boolean;
  accounts: { label: string; email: string; password: string }[];
}

function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: demoInfo } = useQuery({
    queryKey: ["demo-info"],
    queryFn: async () => (await fetch("/api/demo-info")).json() as Promise<DemoInfo>,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  async function enterDemo(account: { email: string; password: string }) {
    setBusy(true);
    setError(null);
    const result = await signIn.email(account);
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "Demo sign-in failed");
      return;
    }
    window.location.href = "/";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result =
      mode === "signin"
        ? await signIn.email({ email, password })
        : await signUp.email({ email, password, name: name || email.split("@")[0]! });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "Something went wrong");
      return;
    }
    // Full navigation: the session store re-initialises from the cookie, so
    // the home page can't race a stale null session back to /login.
    window.location.href = "/";
  }

  return (
    <div className="mx-auto mt-12 max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      {demoInfo?.demo && (
        <div className="mb-6">
          <h1 className="text-lg font-semibold">Explore the demo building</h1>
          <p className="mt-1 text-sm text-gray-500">
            48 Rose St, Fitzroy — 12 lots, live agents, resets itself. Jump in as:
          </p>
          <div className="mt-3 space-y-2">
            {demoInfo.accounts.map((account) => (
              <button
                key={account.email}
                type="button"
                disabled={busy}
                onClick={() => void enterDemo(account)}
                className="w-full rounded-md bg-brand-700 px-3 py-2.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
              >
                Enter as {account.label}
              </button>
            ))}
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <div className="mt-6 border-t border-gray-200 pt-4 text-xs text-gray-400">
            or use a regular account below
          </div>
        </div>
      )}
      <h1
        className={demoInfo?.demo ? "text-sm font-semibold text-gray-600" : "text-lg font-semibold"}
      >
        {mode === "signin" ? "Sign in" : "Create your account"}
      </h1>
      <form onSubmit={submit} className="mt-4 space-y-3">
        {mode === "signup" && (
          <input
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <input
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="Email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="Password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          {busy ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
        </button>
      </form>
      <button
        type="button"
        className="mt-4 text-sm text-brand-700 hover:underline"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
      >
        {mode === "signin" ? "New here? Create an account" : "Have an account? Sign in"}
      </button>
    </div>
  );
}
