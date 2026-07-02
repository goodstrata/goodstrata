import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api";
import { signUp, useSession } from "@/lib/auth";

export const Route = createFileRoute("/join")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: JoinPage,
});

function JoinPage() {
  const { token } = Route.useSearch();
  const { data: session, isPending } = useSession();

  if (!token) {
    return (
      <div className="mx-auto mt-16 max-w-sm">
        <Alert variant="destructive">
          <AlertTitle>Missing invite token.</AlertTitle>
        </Alert>
      </div>
    );
  }
  if (isPending) {
    return (
      <div className="mx-auto mt-16 max-w-sm space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

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
    <div className="mx-auto mt-8 w-full max-w-sm md:mt-16">
      <Card className="text-center">
        <CardHeader>
          <CardTitle className="text-lg">Accept your invite</CardTitle>
          <CardDescription>
            You're signed in — accept to join the owners corporation.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {accept.error && <p className="text-sm text-destructive">{accept.error.message}</p>}
          <Button disabled={accept.isPending} onClick={() => accept.mutate()}>
            {accept.isPending ? "Joining…" : "Accept invite"}
          </Button>
        </CardContent>
      </Card>
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
    <div className="mx-auto mt-8 w-full max-w-sm md:mt-16">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Join {preview?.schemeName ?? "…"}</CardTitle>
          <CardDescription>
            You've been invited as <b>{preview?.role.replace("_", " ")}</b>
            {preview?.email ? ` (${preview.email})` : ""}. Create your account to join.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="join-name">Name</Label>
              <Input
                id="join-name"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="join-password">Password</Label>
              <Input
                id="join-password"
                placeholder="Choose a password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy || !preview}>
              {busy ? "…" : "Create account & join"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
