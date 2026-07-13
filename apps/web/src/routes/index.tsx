import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { RegistryPlate } from "@/components/ui/registry-plate";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api, unwrap } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";

export const Route = createFileRoute("/")({
  component: HomePage,
});

interface SchemeRow {
  scheme: {
    id: string;
    name: string;
    planOfSubdivision: string;
    suburb: string;
    status: string;
    tier: number;
  };
  roles: string[];
}

function HomePage() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isPending && !session?.user) {
      void navigate({ to: "/login" });
    }
  }, [isPending, session?.user, navigate]);

  if (isPending) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <SchemeGridSkeleton />
      </div>
    );
  }
  if (!session?.user) return null;
  return <SchemeList />;
}

function SchemeGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SchemeCardSkeleton />
      <SchemeCardSkeleton />
    </div>
  );
}

function SchemeCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <Skeleton className="h-2.5 w-28" />
      <Skeleton className="mt-2.5 h-5 w-40" />
      <Skeleton className="mt-3 h-px w-full" />
      <div className="mt-3 flex gap-1.5">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
    </div>
  );
}

function JoiningState() {
  return (
    <div className="mx-auto mt-16 flex max-w-sm flex-col items-center gap-3 text-center md:mt-24">
      <Spinner size="lg" className="text-primary" />
      <p className="text-sm text-muted-foreground">Adding you to your building…</p>
    </div>
  );
}

function SchemeList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [wizardActive, setWizardActive] = useState(false);

  // A user who signed up from an invite may not have been signed in when the
  // /join page tried to accept (email verification defers the session). The
  // token is stashed in localStorage there; accept it now they're signed in and
  // send them to the scheme, so they never land on the create-a-scheme wizard.
  const [pendingInvite] = useState(() =>
    typeof localStorage !== "undefined" ? localStorage.getItem("pendingInviteToken") : null,
  );
  const acceptStarted = useRef(false);
  const acceptInvite = useMutation({
    mutationFn: async (token: string) =>
      unwrap<{ schemeId: string }>(await api.invites.accept.$post({ json: { token } })),
    onSuccess: (result) => {
      localStorage.removeItem("pendingInviteToken");
      void queryClient.invalidateQueries({ queryKey: ["schemes"] });
      void navigate({ to: "/schemes/$schemeId", params: { schemeId: result.schemeId } });
    },
    onError: () => {
      // Expired / already used / invalid — drop it so we don't retry forever.
      localStorage.removeItem("pendingInviteToken");
    },
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["schemes"],
    queryFn: async () => unwrap<{ schemes: SchemeRow[] }>(await api.schemes.$get()),
  });

  const isEmpty = !isLoading && !isError && data?.schemes.length === 0;

  useEffect(() => {
    if (pendingInvite && !acceptStarted.current) {
      acceptStarted.current = true;
      acceptInvite.mutate(pendingInvite);
    }
  }, [pendingInvite, acceptInvite]);

  // First run (signed in, no scheme yet): the guided onboarding wizard replaces
  // the bare empty state and takes over the whole surface — no page header.
  // Latched: step 1 creates the scheme, and the ["schemes"] query can refetch
  // mid-flow (invalidation, window refocus). A non-empty result must not
  // unmount the wizard — the user still has the lots and invite steps to
  // finish. FinishStep navigates away, so a fresh visit to "/" renders the
  // normal list again. Never latch it for someone mid-join via an invite.
  useEffect(() => {
    if (isEmpty && !pendingInvite) setWizardActive(true);
  }, [isEmpty, pendingInvite]);

  // Hold the surface while a pending invite is being accepted so the wizard
  // never flashes for someone who is actually joining an existing scheme.
  if (pendingInvite && !acceptInvite.isError) {
    return <JoiningState />;
  }

  if (isEmpty || wizardActive) return <OnboardingWizard />;

  const newSchemeButton = (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus className="size-4" /> New scheme
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Your schemes"
        description="Owners corporations you manage or belong to."
        actions={newSchemeButton}
      />

      {isLoading && <SchemeGridSkeleton />}

      {isError && (
        <ErrorState
          title="Couldn't load your schemes"
          message={
            error instanceof Error
              ? error.message
              : "The register didn't respond. Try again in a moment."
          }
          onRetry={() => void refetch()}
        />
      )}

      {data && data.schemes.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.schemes.map(({ scheme, roles }) => (
            <Link
              key={scheme.id}
              to="/schemes/$schemeId"
              params={{ schemeId: scheme.id }}
              className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="h-full gap-0 py-0 transition-colors group-hover:border-primary/40">
                <CardContent className="p-5">
                  <RegistryPlate
                    compact
                    eyebrow={`${scheme.planOfSubdivision} · ${scheme.suburb} · Tier ${scheme.tier}`}
                    name={scheme.name}
                    badge={<StatusBadge status={scheme.status} />}
                  />
                  {roles.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {roles.map((role) => (
                        <Badge key={role} tone="info">
                          {role.replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <CreateSchemeDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

const createSchemeSchema = z.object({
  name: z.string().min(3, "Enter the scheme's name (at least 3 characters)."),
  planOfSubdivision: z.string().regex(/^PS\d{5,6}[A-Z]?$/i, "Plan numbers look like PS543210V."),
  addressLine1: z.string().min(3, "Enter the street address."),
  suburb: z.string().min(2, "Enter the suburb."),
  postcode: z.string().regex(/^\d{4}$/, "Victorian postcodes have 4 digits."),
});

function CreateSchemeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Remounts on each open, so half-typed values never persist. */}
        <CreateSchemeForm onSuccess={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CreateSchemeForm({ onSuccess }: { onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const form = useAppForm({
    schema: createSchemeSchema,
    defaultValues: {
      name: "",
      planOfSubdivision: "",
      addressLine1: "",
      suburb: "",
      postcode: "",
    },
    onSubmit: async (values) => {
      await unwrap(await api.schemes.$post({ json: { ...values, state: "VIC" } }));
      toast.success("Scheme created");
      await queryClient.invalidateQueries({ queryKey: ["schemes"] });
      onSuccess();
    },
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Register an owners corporation</DialogTitle>
        <DialogDescription>
          Enter the details from the plan of subdivision to get started.
        </DialogDescription>
      </DialogHeader>
      <form
        id="create-scheme-form"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="flex flex-col gap-4"
      >
        <form.Field name="name">
          {(field) => (
            <Field
              label="Scheme name"
              htmlFor="scheme-name"
              required
              error={fieldError(field.state.meta.errors)}
            >
              <Input
                placeholder="Scheme name (e.g. 48 Rose St Owners Corporation)"
                autoComplete="organization"
                enterKeyHint="next"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="planOfSubdivision">
          {(field) => (
            <Field
              label="Plan of subdivision"
              htmlFor="scheme-planOfSubdivision"
              required
              error={fieldError(field.state.meta.errors)}
            >
              <Input
                placeholder="Plan of subdivision (e.g. PS543210V)"
                autoCapitalize="characters"
                enterKeyHint="next"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="addressLine1">
          {(field) => (
            <Field
              label="Street address"
              htmlFor="scheme-addressLine1"
              required
              error={fieldError(field.state.meta.errors)}
            >
              <Input
                placeholder="Street address"
                autoComplete="address-line1"
                enterKeyHint="next"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </Field>
          )}
        </form.Field>
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <form.Field name="suburb">
            {(field) => (
              <Field
                label="Suburb"
                htmlFor="scheme-suburb"
                required
                error={fieldError(field.state.meta.errors)}
              >
                <Input
                  placeholder="Suburb"
                  autoComplete="address-level2"
                  enterKeyHint="next"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="postcode">
            {(field) => (
              <Field
                label="Postcode"
                htmlFor="scheme-postcode"
                required
                error={fieldError(field.state.meta.errors)}
              >
                <Input
                  placeholder="Postcode"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  enterKeyHint="done"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </Field>
            )}
          </form.Field>
        </div>
        <FormError form={form} />
      </form>
      <DialogFooter>
        <SubmitButton form={form} formId="create-scheme-form">
          Create scheme
        </SubmitButton>
      </DialogFooter>
    </>
  );
}
