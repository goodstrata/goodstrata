import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { useState } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/sign-in-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form-message";
import { Separator } from "@/components/ui/separator";
import { signIn } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

interface DemoInfo {
  demo: boolean;
  accounts: { label: string; email: string; password: string }[];
}

function LoginPage() {
  const [entering, setEntering] = useState<string | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);

  const { data: demoInfo } = useQuery({
    queryKey: ["demo-info"],
    queryFn: async () => (await fetch("/api/demo-info")).json() as Promise<DemoInfo>,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  async function enterDemo(account: { label: string; email: string; password: string }) {
    setEntering(account.email);
    setDemoError(null);
    try {
      const result = await signIn.email({ email: account.email, password: account.password });
      if (result.error) {
        setDemoError(result.error.message ?? "Demo sign-in failed.");
        setEntering(null);
        return;
      }
      window.location.href = "/";
    } catch (error) {
      setDemoError(error instanceof Error ? error.message : "Demo sign-in failed.");
      setEntering(null);
    }
  }

  const hasDemo = Boolean(demoInfo?.demo && demoInfo.accounts.length > 0);

  return (
    <AuthShell
      heading={
        <h1 className="page-title text-balance">
          The building runs itself. You stay in charge.
        </h1>
      }
    >
      {hasDemo && (
        <Card className="border-primary/20 bg-accent/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="size-5 text-primary" aria-hidden="true" />
              Explore the demo building
            </CardTitle>
            <CardDescription>
              48 Rose St, Fitzroy — 12 lots, live agents, resets itself. Jump in as:
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {demoError && <FormMessage>{demoError}</FormMessage>}
            {demoInfo?.accounts.map((account) => (
              <Button
                key={account.email}
                size="lg"
                pending={entering === account.email}
                disabled={entering !== null}
                onClick={() => void enterDemo(account)}
              >
                Enter as {account.label}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      {hasDemo && (
        <div className="relative">
          <Separator />
          <span className="absolute inset-x-0 -top-2.5 mx-auto w-fit bg-background px-3 text-xs text-muted-foreground">
            or use a regular account
          </span>
        </div>
      )}

      <SignInForm />
    </AuthShell>
  );
}
