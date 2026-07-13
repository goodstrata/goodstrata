import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api";
import { signUp, useSession } from "@/lib/auth";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";

export const Route = createFileRoute("/join")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: JoinPage,
});

interface InvitePreview {
  schemeName: string;
  role: string;
  email: string;
  /** Set from the invited person record; when present the join form locks it. */
  name: string | null;
}

async function fetchInvitePreview(token: string): Promise<InvitePreview> {
  const res = await fetch(`/api/invites/preview?token=${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error("This invite is invalid or has expired.");
  return (await res.json()) as InvitePreview;
}

const joinSchema = z.object({
  name: z.string(),
  password: z.string().min(8, "Use at least 8 characters."),
});

function JoinPage() {
  const { token } = Route.useSearch();
  const { data: session, isPending } = useSession();

  if (!token) {
    return (
      <div className="mx-auto mt-8 w-full max-w-sm md:mt-16">
        <EmptyState
          icon={Building2}
          title="Missing invite token"
          description="This link is incomplete. Open the invite link from your email again, or sign in to your existing account."
          action={
            <Button asChild variant="outline">
              <Link to="/login">Go to sign in</Link>
            </Button>
          }
        />
      </div>
    );
  }
  if (isPending) {
    return (
      <div className="mx-auto mt-8 w-full max-w-sm space-y-3 md:mt-16">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return session?.user ? <AcceptInvite token={token} /> : <SignupThenAccept token={token} />;
}

function AcceptInvite({ token }: { token: string }) {
  const navigate = useNavigate();
  const preview = useQuery({
    queryKey: ["invite-preview", token],
    queryFn: () => fetchInvitePreview(token),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: async () =>
      unwrap<{ schemeId: string }>(await api.invites.accept.$post({ json: { token } })),
    onSuccess: (data) =>
      void navigate({ to: "/schemes/$schemeId", params: { schemeId: data.schemeId } }),
  });

  if (preview.isError) {
    return (
      <div className="mx-auto mt-8 w-full max-w-sm md:mt-16">
        <ErrorState
          title="Invite unavailable"
          message={
            preview.error instanceof Error
              ? preview.error.message
              : "This invite is invalid or has expired."
          }
          onRetry={() => void preview.refetch()}
        />
      </div>
    );
  }

  if (preview.isPending || !preview.data) {
    return (
      <div className="mx-auto mt-8 w-full max-w-sm space-y-3 md:mt-16" role="status">
        <span className="sr-only">Loading invitation</span>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto mt-8 w-full max-w-sm md:mt-16">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Join {preview.data.schemeName}</CardTitle>
          <CardDescription>
            You've been invited as {preview.data.role.replace(/_/g, " ")}. Accept to add your
            signed-in account to this owners corporation.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {accept.error && <FormMessage>{accept.error.message}</FormMessage>}
          <Button pending={accept.isPending} onClick={() => accept.mutate()}>
            Accept invite
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SignupThenAccept({ token }: { token: string }) {
  const navigate = useNavigate();
  const previewRef = useRef<InvitePreview | undefined>(undefined);
  const [needsVerification, setNeedsVerification] = useState(false);

  // Unauthenticated preview via query param (public by design: token IS the secret).
  const {
    data: preview,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["invite-preview", token],
    queryFn: () => fetchInvitePreview(token),
    retry: false,
  });
  previewRef.current = preview;

  const form = useAppForm({
    schema: joinSchema,
    defaultValues: { name: "", password: "" },
    onSubmit: async ({ name, password }) => {
      const current = previewRef.current;
      if (!current) throw new Error("This invite is invalid or has expired.");
      // Stash the token so it's accepted after email verification + sign-in even
      // when we can't accept inline right now (verification defers the session).
      localStorage.setItem("pendingInviteToken", token);
      const signup = await signUp.email({
        email: current.email,
        password,
        // Keep the bearer token in the verification callback as well as local
        // storage. If the recipient opens the email on another browser/device,
        // Better Auth returns them to this exact invite instead of dropping
        // them on the empty-scheme onboarding screen.
        callbackURL: `/join?token=${encodeURIComponent(token)}`,
        // The invite already carries the person's name; only fall back to the
        // typed field (or the email local-part) when it doesn't.
        name: current.name?.trim() || name.trim() || current.email.split("@")[0]!,
      });
      if (signup.error) throw new Error(signup.error.message ?? "Sign up failed.");
      try {
        // Works when signup establishes a session immediately.
        const data = await unwrap<{ schemeId: string }>(
          await api.invites.accept.$post({ json: { token } }),
        );
        localStorage.removeItem("pendingInviteToken");
        void navigate({ to: "/schemes/$schemeId", params: { schemeId: data.schemeId } });
      } catch {
        // Not signed in yet — email verification is required. The stashed token
        // is accepted automatically once they verify and sign in.
        setNeedsVerification(true);
      }
    },
  });

  if (isError) {
    return (
      <div className="mx-auto mt-8 w-full max-w-sm md:mt-16">
        <ErrorState
          title="Invite unavailable"
          message={
            error instanceof Error ? error.message : "This invite is invalid or has expired."
          }
          onRetry={() => void refetch()}
        />
      </div>
    );
  }
  if (isPending || !preview) {
    return (
      <div className="mx-auto mt-8 w-full max-w-sm space-y-3 md:mt-16" role="status">
        <span className="sr-only">Loading invitation</span>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (needsVerification) {
    return (
      <div className="mx-auto mt-8 w-full max-w-sm md:mt-16">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Check your email</CardTitle>
            <CardDescription>
              Your account for <span className="break-all">{preview.email}</span> is set up. Open
              the verification link we just emailed you and sign in — you'll be added to{" "}
              {preview.schemeName} automatically.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-8 w-full max-w-sm md:mt-16">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Join {preview.schemeName}</CardTitle>
          <CardDescription>
            You've been invited as{" "}
            <b className="font-medium text-foreground">{preview.role.replace(/_/g, " ")}</b>{" "}
            <span className="break-all">({preview.email})</span>. Create your account to join.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            id="join-form"
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
            className="flex flex-col gap-4"
          >
            {preview.name ? (
              <Field label="Name" htmlFor="join-name" hint="Set from your invitation.">
                <Input id="join-name" value={preview.name} readOnly disabled autoComplete="name" />
              </Field>
            ) : (
              <form.Field name="name">
                {(field) => (
                  <Field label="Name" htmlFor="join-name">
                    <Input
                      id="join-name"
                      placeholder="Your name"
                      autoComplete="name"
                      enterKeyHint="next"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                  </Field>
                )}
              </form.Field>
            )}
            <form.Field name="password">
              {(field) => (
                <Field
                  label="Password"
                  htmlFor="join-password"
                  required
                  error={fieldError(field.state.meta.errors)}
                >
                  <Input
                    placeholder="Choose a password"
                    type="password"
                    autoComplete="new-password"
                    enterKeyHint="go"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                </Field>
              )}
            </form.Field>
            <FormError form={form} />
            <SubmitButton form={form} className="w-full">
              Create account & join
            </SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
