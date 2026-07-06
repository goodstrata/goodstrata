import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";
import { useIsOfficer } from "@/lib/roles";

interface PersonRow {
  id: string;
  givenName: string | null;
  familyName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  userId: string | null;
  pendingInvite: boolean;
  lots: { lotId: string; lotNumber: string }[];
}

function personName(p: PersonRow): string {
  return (
    `${p.givenName ?? ""} ${p.familyName ?? ""}`.trim() || p.companyName || p.email || "Unnamed"
  );
}

function personInitials(p: PersonRow): string {
  const initials =
    `${p.givenName?.trim()?.[0] ?? ""}${p.familyName?.trim()?.[0] ?? ""}`.toUpperCase();
  if (initials) return initials;
  return (p.companyName ?? p.email)?.trim()?.[0]?.toUpperCase() ?? "?";
}

const addPersonSchema = z
  .object({
    givenName: z.string(),
    familyName: z.string(),
    email: z.string().email("Enter a valid email address.").or(z.literal("")),
    phone: z.string(),
  })
  .refine((v) => v.givenName.trim() || v.familyName.trim() || v.email.trim(), {
    message: "Add a name or an email address.",
    path: ["givenName"],
  });
type AddPersonValues = z.infer<typeof addPersonSchema>;

function AddPersonCard({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const formRef = useRef<{ reset: () => void } | null>(null);
  const form = useAppForm<AddPersonValues>({
    schema: addPersonSchema,
    defaultValues: { givenName: "", familyName: "", email: "", phone: "" },
    onSubmit: async (values) => {
      await unwrap(
        await api.schemes[":schemeId"].people.$post({
          param: { schemeId },
          json: {
            givenName: values.givenName.trim() || undefined,
            familyName: values.familyName.trim() || undefined,
            email: values.email.trim() || undefined,
            phone: values.phone.trim() || undefined,
          },
        }),
      );
      toast.success("Person added to the roll");
      void queryClient.invalidateQueries({ queryKey: ["people", schemeId] });
      formRef.current?.reset();
    },
  });
  formRef.current = form;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a person</CardTitle>
        <CardDescription>
          Record an owner or contact on the roll. Add an email address so they can be invited to the
          portal.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="givenName">
              {(field) => (
                <Field label="Given name" error={fieldError(field.state.meta.errors)}>
                  <Input
                    autoComplete="off"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="familyName">
              {(field) => (
                <Field label="Family name" error={fieldError(field.state.meta.errors)}>
                  <Input
                    autoComplete="off"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="email">
              {(field) => (
                <Field label="Email" error={fieldError(field.state.meta.errors)}>
                  <Input
                    type="email"
                    autoComplete="off"
                    inputMode="email"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="phone">
              {(field) => (
                <Field label="Phone" error={fieldError(field.state.meta.errors)}>
                  <Input
                    type="tel"
                    autoComplete="off"
                    inputMode="tel"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                </Field>
              )}
            </form.Field>
          </div>
          <FormError form={form} className="mt-3" />
          <div className="mt-4">
            <SubmitButton form={form}>Add person</SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function PeopleSection({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const isOfficer = useIsOfficer(schemeId);
  const { data, isError, error, refetch } = useQuery({
    queryKey: ["people", schemeId],
    queryFn: async () =>
      unwrap<{ people: PersonRow[] }>(
        await api.schemes[":schemeId"].people.$get({ param: { schemeId } }),
      ),
  });
  const invite = useMutation({
    mutationFn: async (personId: string) =>
      unwrap<{ linked: boolean; expiresAt: string | null }>(
        await api.schemes[":schemeId"].people[":personId"].invite.$post({
          param: { schemeId, personId },
          json: { role: "owner" },
        }),
      ),
    onSuccess: (result) => {
      toast.success(
        result?.linked
          ? "Added to the scheme — they already have a GoodStrata account and were notified"
          : "Invite sent",
      );
      void queryClient.invalidateQueries({ queryKey: ["people", schemeId] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (isError) {
    return (
      <div className="max-w-2xl">
        <ErrorState
          message={error instanceof Error ? error.message : "Couldn't load the people register."}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }
  if (!data) return <Skeleton className="h-40 max-w-2xl" />;

  return (
    <div className="max-w-2xl space-y-6">
      {data.people.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No people yet"
          description={
            isOfficer
              ? "Import the plan of subdivision from the Lots tab, or add people below."
              : "Owners appear here once the plan of subdivision is imported."
          }
        />
      ) : (
        <div className="space-y-2">
          {data.people.map((p) => {
            const isThisPending = invite.isPending && invite.variables === p.id;
            const contact = [p.email ?? "No email", p.phone].filter(Boolean).join(" · ");
            const lotLabel =
              p.lots.length > 0 ? `Lot ${p.lots.map((l) => l.lotNumber).join(", ")}` : null;
            return (
              <Card key={p.id} data-testid={`person-${p.email ?? p.id}`} className="py-3">
                <CardContent className="flex items-center gap-3 px-4">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground"
                  >
                    {personInitials(p)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {personName(p)}
                      {lotLabel && (
                        <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                          {lotLabel}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{contact}</p>
                  </div>
                  {p.userId ? (
                    <StatusBadge status="joined" />
                  ) : p.pendingInvite ? (
                    <StatusBadge status="invited" />
                  ) : isOfficer ? (
                    <Button
                      variant="outline"
                      size="sm"
                      pending={isThisPending}
                      disabled={!p.email || invite.isPending}
                      title={p.email ? undefined : "Add an email address to invite this person"}
                      onClick={() => invite.mutate(p.id)}
                    >
                      Invite
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {isOfficer && <AddPersonCard schemeId={schemeId} />}
    </div>
  );
}
