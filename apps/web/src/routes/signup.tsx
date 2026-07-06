import { createFileRoute } from "@tanstack/react-router";
import { GitBranch, MapPin, Sparkles } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
});

function SignupPage() {
  return (
    <AuthShell
      heading={
        <div className="flex flex-col gap-3">
          <h1 className="page-title text-balance lg:text-4xl">Create your account</h1>
          <p className="text-balance text-muted-foreground">
            Set up your owners corporation in minutes. The agents handle the admin — you stay in
            charge of every decision.
          </p>
        </div>
      }
      aside={
        <ul className="flex flex-col items-center gap-2.5 text-sm text-muted-foreground lg:items-start">
          <li className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            Free forever
          </li>
          <li className="flex items-center gap-2">
            <GitBranch className="size-4 text-primary" aria-hidden="true" />
            Open source
          </li>
          <li className="flex items-center gap-2">
            <MapPin className="size-4 text-primary" aria-hidden="true" />
            {/* Residency claim parked pending region verification (docs/legal/):
                "stays" also implies processing, which runs on Cloudflare's
                network. Restore a precise "stored in Australia" once the
                database region is confirmed ap-southeast-2. */}
            Built for Victorian strata law
          </li>
        </ul>
      }
    >
      <SignUpForm />
    </AuthShell>
  );
}
