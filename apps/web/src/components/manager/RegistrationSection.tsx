import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CalendarClock, ShieldCheck, ShieldX } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DescriptionItem, DescriptionList } from "@/components/ui/description-list";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";
import { dollars, formatDate } from "@/lib/format";

/** Statutory floor for continuous professional-indemnity cover (reg 10). */
const MIN_PI_COVER_CENTS = 200_000_000;

// ---------------------------------------------------------------------------
// Types (JSON — timestamps/dates arrive as strings, cents as numbers).
// ---------------------------------------------------------------------------

interface PiPolicy {
  id: string;
  insurer: string;
  policyNumber: string;
  coverAmountCents: number;
  effectiveOn: string | null;
  expiresOn: string;
  documentId: string | null;
  createdAt: string;
}

interface RegistrationStatus {
  organizationId: string;
  registrationNumber: string | null;
  currentPiPolicy: PiPolicy | null;
  piCoverSufficient: boolean;
  piContinuous: boolean;
}

interface Obligation {
  id: string;
  kind: string;
  title: string;
  dueOn: string;
  status: "upcoming" | "due" | "overdue" | "done" | "waived";
  escalationState: string;
}

interface RegistrationPayload {
  status: RegistrationStatus;
  policies: PiPolicy[];
  obligations: Obligation[];
}

// ---------------------------------------------------------------------------
// Section.
// ---------------------------------------------------------------------------

export function RegistrationSection({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["manager-registration", schemeId],
    queryFn: async () =>
      unwrap<RegistrationPayload>(
        await api.schemes[":schemeId"].manager.registration.$get({ param: { schemeId } }),
      ),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["manager-registration", schemeId] });
  };

  if (query.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40" />
        <Skeleton className="h-56" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <ErrorState
        message="Couldn't load registration and insurance."
        onRetry={() => void query.refetch()}
      />
    );
  }

  const { status, policies, obligations } = query.data;

  return (
    <div className="space-y-6">
      <RegistrationCard schemeId={schemeId} status={status} onSaved={invalidate} />
      <PiInsuranceCard
        schemeId={schemeId}
        status={status}
        policies={policies}
        onSaved={invalidate}
      />
      <RemindersCard obligations={obligations} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registration number.
// ---------------------------------------------------------------------------

const registrationSchema = z.object({
  registrationNumber: z.string().trim().min(1, "Enter the BLA registration number."),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a review date."),
});

function RegistrationCard({
  schemeId,
  status,
  onSaved,
}: {
  schemeId: string;
  status: RegistrationStatus;
  onSaved: () => void;
}) {
  const save = useMutation({
    mutationFn: async (values: z.infer<typeof registrationSchema>) =>
      unwrap(
        await api.schemes[":schemeId"].manager.registration.$post({
          param: { schemeId },
          json: values,
        }),
      ),
    onSuccess: () => {
      toast.success("Registration recorded — a review reminder has been scheduled");
      onSaved();
    },
  });

  const form = useAppForm({
    schema: registrationSchema,
    defaultValues: {
      registrationNumber: status.registrationNumber ?? "",
      expiresOn: "",
    },
    onSubmit: (values) => save.mutateAsync(values),
  });

  return (
    <Card>
      <form
        id="registration-form"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <CardHeader>
          <CardTitle>Business Licensing Authority registration</CardTitle>
          <CardDescription>
            The registered manager's BLA registration number. It feeds the s147/148 register of
            managers and owners corporation certificates. Registration is ongoing — record a review
            date and we'll remind you before it falls due.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status.registrationNumber ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
              <BadgeCheck className="size-4 text-positive" aria-hidden="true" />
              <span className="text-sm">
                Registered as{" "}
                <span className="font-medium text-foreground">{status.registrationNumber}</span>
              </span>
            </div>
          ) : (
            <Alert tone="caution">
              <ShieldX aria-hidden="true" />
              <AlertTitle>No registration recorded</AlertTitle>
              <AlertDescription>
                The registered-manager path requires a current BLA registration. Record it below.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="registrationNumber">
              {(field) => (
                <Field
                  label="Registration number"
                  required
                  error={fieldError(field.state.meta.errors)}
                >
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      placeholder="e.g. OC-2026-004821"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  )}
                </Field>
              )}
            </form.Field>
            <form.Field name="expiresOn">
              {(field) => (
                <Field
                  label="Next review date"
                  required
                  hint="When to re-confirm the registration is current."
                  error={fieldError(field.state.meta.errors)}
                >
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      type="date"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  )}
                </Field>
              )}
            </form.Field>
          </div>
          <FormError form={form} />
        </CardContent>
        <CardFooter className="border-t">
          <SubmitButton form={form} formId="registration-form">
            Save registration
          </SubmitButton>
        </CardFooter>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// PI insurance.
// ---------------------------------------------------------------------------

const piSchema = z.object({
  insurer: z.string().trim().min(1, "Name the insurer."),
  policyNumber: z.string().trim().min(1, "Enter the policy number."),
  coverAmountDollars: z
    .number({ error: "Enter the cover amount." })
    .positive("Cover must be greater than zero."),
  effectiveOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date.")
    .or(z.literal("")),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose an expiry date."),
});

function CoverBadge({ cents }: { cents: number }) {
  const ok = cents >= MIN_PI_COVER_CENTS;
  return (
    <Badge tone={ok ? "positive" : "critical"} className="gap-1">
      {ok ? (
        <ShieldCheck className="size-3" aria-hidden="true" />
      ) : (
        <ShieldX className="size-3" aria-hidden="true" />
      )}
      {ok ? "Meets $2M floor" : "Below $2M floor"}
    </Badge>
  );
}

function PiInsuranceCard({
  schemeId,
  status,
  policies,
  onSaved,
}: {
  schemeId: string;
  status: RegistrationStatus;
  policies: PiPolicy[];
  onSaved: () => void;
}) {
  const save = useMutation({
    mutationFn: async (values: z.infer<typeof piSchema>) =>
      unwrap(
        await api.schemes[":schemeId"].manager["pi-policies"].$post({
          param: { schemeId },
          json: {
            insurer: values.insurer,
            policyNumber: values.policyNumber,
            coverAmountCents: Math.round(values.coverAmountDollars * 100),
            effectiveOn: values.effectiveOn || undefined,
            expiresOn: values.expiresOn,
          },
        }),
      ),
    onSuccess: (_data, values) => {
      const cents = Math.round(values.coverAmountDollars * 100);
      if (cents < MIN_PI_COVER_CENTS) {
        toast.warning("Policy recorded, but cover is below the $2M statutory floor");
      } else {
        toast.success("PI policy recorded — an expiry reminder has been scheduled");
      }
      form.reset();
      onSaved();
    },
  });

  const form = useAppForm({
    schema: piSchema,
    defaultValues: {
      insurer: "",
      policyNumber: "",
      coverAmountDollars: 0,
      effectiveOn: "",
      expiresOn: "",
    },
    onSubmit: (values) => save.mutateAsync(values),
  });

  const current = status.currentPiPolicy;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Professional indemnity insurance</CardTitle>
        <CardDescription>
          The registered-manager path requires at least $2,000,000 of PI cover held continuously
          (s119(5) / reg 10). Record each policy period so cover and continuity can be evidenced.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Current cover snapshot. */}
        {current ? (
          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Eyebrow className="block">Current cover</Eyebrow>
              <div className="flex items-center gap-2">
                <CoverBadge cents={current.coverAmountCents} />
                <Badge tone={status.piContinuous ? "positive" : "caution"}>
                  {status.piContinuous ? "Continuous" : "Gap detected"}
                </Badge>
              </div>
            </div>
            <DescriptionList>
              <DescriptionItem label="Insurer">{current.insurer}</DescriptionItem>
              <DescriptionItem label="Policy number">{current.policyNumber}</DescriptionItem>
              <DescriptionItem label="Cover">{dollars(current.coverAmountCents)}</DescriptionItem>
              <DescriptionItem label="Expires">{formatDate(current.expiresOn)}</DescriptionItem>
            </DescriptionList>
          </div>
        ) : (
          <Alert tone="caution">
            <ShieldX aria-hidden="true" />
            <AlertTitle>No PI policy on record</AlertTitle>
            <AlertDescription>
              Record a current professional-indemnity policy to evidence the statutory cover.
            </AlertDescription>
          </Alert>
        )}

        {current && !status.piCoverSufficient ? (
          <Alert tone="critical">
            <ShieldX aria-hidden="true" />
            <AlertTitle>Cover below the statutory floor</AlertTitle>
            <AlertDescription>
              The current policy provides {dollars(current.coverAmountCents)}, under the $2,000,000
              minimum. Increase cover to remain compliant on the registered-manager path.
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Add a policy period. */}
        <form
          id="pi-form"
          className="space-y-4 border-t pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <Eyebrow className="block">Record a policy period</Eyebrow>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="insurer">
              {(field) => (
                <Field label="Insurer" required error={fieldError(field.state.meta.errors)}>
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      placeholder="e.g. CHU Underwriting"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  )}
                </Field>
              )}
            </form.Field>
            <form.Field name="policyNumber">
              {(field) => (
                <Field label="Policy number" required error={fieldError(field.state.meta.errors)}>
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      placeholder="e.g. PI-88472019"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  )}
                </Field>
              )}
            </form.Field>
            <form.Field name="coverAmountDollars">
              {(field) => (
                <Field
                  label="Cover amount (AUD)"
                  required
                  hint="Minimum $2,000,000 on the registered-manager path."
                  error={fieldError(field.state.meta.errors)}
                >
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      type="number"
                      min={0}
                      step={1000}
                      inputMode="numeric"
                      placeholder="2000000"
                      value={field.state.value === 0 ? "" : field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(Number(e.target.value))}
                    />
                  )}
                </Field>
              )}
            </form.Field>
            <div className="grid grid-cols-2 gap-3">
              <form.Field name="effectiveOn">
                {(field) => (
                  <Field
                    label="Effective from"
                    hint="For continuity."
                    error={fieldError(field.state.meta.errors)}
                  >
                    {(controlProps) => (
                      <Input
                        {...controlProps}
                        type="date"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    )}
                  </Field>
                )}
              </form.Field>
              <form.Field name="expiresOn">
                {(field) => (
                  <Field label="Expires" required error={fieldError(field.state.meta.errors)}>
                    {(controlProps) => (
                      <Input
                        {...controlProps}
                        type="date"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    )}
                  </Field>
                )}
              </form.Field>
            </div>
          </div>
          {/* Live sub-$2M warning as the user types. */}
          <form.Subscribe selector={(s) => s.values.coverAmountDollars}>
            {(cover) =>
              cover > 0 && cover * 100 < MIN_PI_COVER_CENTS ? (
                <p className="text-13 text-critical">
                  {dollars(Math.round(cover * 100))} is below the $2,000,000 statutory floor. You
                  can still record it, but the owners corporation will be flagged as non-compliant.
                </p>
              ) : null
            }
          </form.Subscribe>
          <FormError form={form} />
          <SubmitButton form={form} formId="pi-form">
            Record policy
          </SubmitButton>
        </form>

        {/* Policy history. */}
        {policies.length > 0 ? (
          <div className="space-y-2 border-t pt-5">
            <Eyebrow className="block">Policy history</Eyebrow>
            <div className="space-y-2">
              {policies.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{p.insurer}</p>
                    <p className="text-13 text-muted-foreground">
                      {p.policyNumber} · {dollars(p.coverAmountCents)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-13 text-muted-foreground">
                    <span>
                      {p.effectiveOn ? `${formatDate(p.effectiveOn)} – ` : "expires "}
                      {formatDate(p.expiresOn)}
                    </span>
                    <CoverBadge cents={p.coverAmountCents} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Raised reminders (manager-level compliance obligations).
// ---------------------------------------------------------------------------

type Tone = "positive" | "caution" | "critical" | "info" | "neutral";

const STATUS_TONE: Record<Obligation["status"], Tone> = {
  upcoming: "info",
  due: "caution",
  overdue: "critical",
  done: "positive",
  waived: "neutral",
};

function RemindersCard({ obligations }: { obligations: Obligation[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Scheduled reminders</CardTitle>
        <CardDescription>
          Registration reviews and PI expiries are tracked on the compliance calendar and escalate
          as they approach.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {obligations.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No reminders yet"
            description="Record a registration number or PI policy above and reminders appear here."
          />
        ) : (
          <div className="space-y-2">
            {obligations.map((o) => (
              <div
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2.5"
              >
                <div className="flex items-center gap-2.5">
                  <CalendarClock className="size-4 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-medium">{o.title}</p>
                    <p className="text-13 text-muted-foreground">Due {formatDate(o.dueOn)}</p>
                  </div>
                </div>
                <Badge tone={STATUS_TONE[o.status]} className="capitalize">
                  {o.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
