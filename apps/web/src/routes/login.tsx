import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { signIn, signUp } from "@/lib/auth";

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
    <div className="mx-auto mt-8 w-full max-w-sm md:mt-16">
      {demoInfo?.demo && (
        <Card className="mb-6 border-brand-100 bg-gradient-to-b from-brand-50/70 to-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Building2 className="size-5 text-brand-700" />
              Explore the demo building
            </CardTitle>
            <CardDescription>
              48 Rose St, Fitzroy — 12 lots, live agents, resets itself. Jump in as:
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {demoInfo.accounts.map((account) => (
              <Button
                key={account.email}
                size="lg"
                disabled={busy}
                onClick={() => void enterDemo(account)}
              >
                Enter as {account.label}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      {demoInfo?.demo && (
        <div className="relative my-6">
          <Separator />
          <span className="absolute inset-x-0 -top-2.5 mx-auto w-fit bg-background px-3 text-xs text-muted-foreground">
            or use a regular account
          </span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {mode === "signin" ? "Sign in" : "Create your account"}
          </CardTitle>
          <CardDescription>
            {mode === "signin"
              ? "Welcome back to your owners corporation."
              : "Set up your GoodStrata account."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            {mode === "signup" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="login-name">Name</Label>
                <Input
                  id="login-name"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                placeholder="Email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                placeholder="Password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy}>
              {busy ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
            </Button>
          </form>
          <Button
            type="button"
            variant="link"
            className="mt-3 h-auto p-0 text-sm"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "New here? Create an account" : "Have an account? Sign in"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
