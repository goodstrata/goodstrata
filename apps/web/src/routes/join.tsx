import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api, unwrap } from "../lib/api";
import { signUp, useSession } from "../lib/auth";

export const Route = createFileRoute("/join")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: JoinPage,
});

function JoinPage() {
  const { token } = Route.useSearch();
  const { data: session, isPending } = useSession();

  if (!token) return <p className="text-red-600">Missing invite token.</p>;
  if (isPending) return <p className="text-gray-500">Loading…</p>;

  return session?.user ? <AcceptInvite token={token} /> : <SignupThenAccept token={token} />;
}

function AcceptInvite({ token }: { token: string }) {
  const navigate = useNavigate();
  const accept = useMutation({
    mutationFn: async () =>
      unwrap<{ schemeId: string }>(await api.invites.accept.$post({ json: { token } })),
    onSuccess: (data) =>
      void navigate({ to: "/schemes/$schemeId", params: { schemeId: data.schemeId } }),
  });

  return (
    <div className="mx-auto mt-12 max-w-sm rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
      <h1 className="text-lg font-semibold">Accept your invite</h1>
      <p className="mt-2 text-sm text-gray-500">
        You're signed in — accept to join the owners corporation.
      </p>
      {accept.error && <p className="mt-2 text-sm text-red-600">{accept.error.message}</p>}
      <button
        type="button"
        disabled={accept.isPending}
        onClick={() => accept.mutate()}
        className="mt-4 w-full rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
      >
        {accept.isPending ? "Joining…" : "Accept invite"}
      </button>
    </div>
  );
}

function SignupThenAccept({ token }: { token: string }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Unauthenticated preview via query param (public by design: token IS the secret).
  const { data: preview } = useQuery({
    queryKey: ["invite-preview", token],
    queryFn: async () => {
      const res = await fetch(`/api/invites/preview?token=${encodeURIComponent(token)}`);
      if (!res.ok) throw new Error("This invite is invalid or has expired");
      return (await res.json()) as { schemeName: string; role: string; email: string };
    },
    retry: false,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!preview) return;
    setBusy(true);
    setError(null);
    const signup = await signUp.email({
      email: preview.email,
      password,
      name: name || preview.email.split("@")[0]!,
    });
    if (signup.error) {
      setBusy(false);
      setError(signup.error.message ?? "Sign up failed");
      return;
    }
    const res = await api.invites.accept.$post({ json: { token } });
    setBusy(false);
    if (!res.ok) {
      let message = `Invite could not be accepted (${res.status})`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        message = body.error?.message ?? message;
      } catch {
        // keep the status-based message
      }
      setError(message);
      return;
    }
    const data = (await res.json()) as { schemeId: string };
    void navigate({ to: "/schemes/$schemeId", params: { schemeId: data.schemeId } });
  }

  return (
    <div className="mx-auto mt-12 max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold">Join {preview?.schemeName ?? "…"}</h1>
      <p className="mt-1 text-sm text-gray-500">
        You've been invited as <b>{preview?.role.replace("_", " ")}</b>
        {preview?.email ? ` (${preview.email})` : ""}. Create your account to join.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <input
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="Choose a password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy || !preview}
          className="w-full rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          {busy ? "…" : "Create account & join"}
        </button>
      </form>
    </div>
  );
}
