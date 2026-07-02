import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ClipboardCheck, HardHat, Plus, Wrench } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, unwrap } from "@/lib/api";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";
import { useIsOfficer } from "@/lib/roles";

interface Request {
  id: string;
  title: string;
  description: string;
  category: string | null;
  urgency: string | null;
  isCommonProperty: boolean | null;
  status: string;
  createdAt: string;
}
interface WorkOrder {
  id: string;
  scope: string;
  approvedAmountCents: number;
  status: string;
  contractorId: string;
}
interface Contractor {
  id: string;
  businessName: string;
  tradeCategories: string[];
  email: string | null;
}

/** Officer statuses where a work order can still be marked completed. */
const COMPLETABLE_STATUSES = ["dispatched", "accepted", "scheduled", "in_progress"];

export function MaintenanceTab({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const isOfficer = useIsOfficer(schemeId);
  const invalidate = () => {
    for (const key of ["maintenance", "work-orders", "contractors", "decisions"]) {
      void queryClient.invalidateQueries({ queryKey: [key, schemeId] });
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        as="h2"
        title="Maintenance"
        description="Report issues, follow the agent's triage, and track work through to completion."
        actions={<ReportIssueDialog schemeId={schemeId} onChange={invalidate} />}
      />
      <RequestList schemeId={schemeId} />
      <WorkOrderList schemeId={schemeId} isOfficer={isOfficer} onChange={invalidate} />
      {isOfficer && <ContractorSection schemeId={schemeId} onChange={invalidate} />}
    </div>
  );
}

const reportSchema = z.object({
  title: z.string().trim().min(1, "Give the issue a short title."),
  description: z.string().trim().min(1, "Describe the issue so the agent can triage it."),
});

function ReportIssueDialog({ schemeId, onChange }: { schemeId: string; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const create = useMutation({
    mutationFn: async (values: { title: string; description: string }) =>
      unwrap(
        await api.schemes[":schemeId"].maintenance.$post({
          param: { schemeId },
          json: { title: values.title, description: values.description },
        }),
      ),
    onSuccess: () => {
      setOpen(false);
      form.reset();
      toast.success("Request submitted — the maintenance agent will triage it");
      onChange();
    },
  });
  const form = useAppForm({
    schema: reportSchema,
    defaultValues: { title: "", description: "" },
    onSubmit: (values) => create.mutateAsync(values),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden="true" className="size-4" /> Report issue
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report a maintenance issue</DialogTitle>
          <DialogDescription>
            The maintenance agent triages every report automatically.
          </DialogDescription>
        </DialogHeader>
        <form
          id="mr-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="title">
            {(field) => (
              <Field label="Title" required error={fieldError(field.state.meta.errors)}>
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    data-testid="mr-title"
                    placeholder="What's the problem? (e.g. Water stain on ceiling)"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                )}
              </Field>
            )}
          </form.Field>
          <form.Field name="description">
            {(field) => (
              <Field label="Description" required error={fieldError(field.state.meta.errors)}>
                {(controlProps) => (
                  <Textarea
                    {...controlProps}
                    data-testid="mr-description"
                    className="min-h-28"
                    placeholder="Describe it — where, since when, how bad."
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                )}
              </Field>
            )}
          </form.Field>
          <FormError form={form} />
        </form>
        <DialogFooter>
          <SubmitButton form={form} formId="mr-form">
            Submit request
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequestList({ schemeId }: { schemeId: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["maintenance", schemeId],
    queryFn: async () =>
      unwrap<{ requests: Request[] }>(
        await api.schemes[":schemeId"].maintenance.$get({ param: { schemeId } }),
      ),
    refetchInterval: 3000,
  });

  return (
    <section>
      <h2 className="text-base font-semibold">Requests</h2>
      <p className="text-sm text-muted-foreground">
        Maintenance reports from residents and owners.
      </p>
      <div className="mt-4 space-y-2.5">
        {isLoading && <Skeleton className="h-24" />}
        {isError && (
          <ErrorState
            message="Couldn't load maintenance requests."
            onRetry={() => void refetch()}
          />
        )}
        {data?.requests.length === 0 && (
          <EmptyState
            icon={Wrench}
            title="No maintenance requests yet"
            description="Report an issue and the maintenance agent triages it automatically."
          />
        )}
        {data?.requests.map((r) => (
          <Card key={r.id} data-testid={`mr-${r.title}`} className="py-4">
            <CardContent className="px-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium">{r.title}</p>
                <StatusBadge status={r.status} />
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{r.description}</p>
              {r.category && (
                <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 text-agent">
                    <Bot aria-hidden="true" className="size-3.5" />
                    triaged
                  </span>
                  <Eyebrow>{r.category}</Eyebrow>
                  <span>
                    {r.urgency} · {r.isCommonProperty ? "common property" : "lot responsibility"}
                  </span>
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function WorkOrderList({
  schemeId,
  isOfficer,
  onChange,
}: {
  schemeId: string;
  isOfficer: boolean;
  onChange: () => void;
}) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["work-orders", schemeId],
    queryFn: async () =>
      unwrap<{ workOrders: WorkOrder[] }>(
        await api.schemes[":schemeId"]["work-orders"].$get({ param: { schemeId } }),
      ),
    refetchInterval: 3000,
  });
  const complete = useMutation({
    mutationFn: async (workOrderId: string) =>
      unwrap(
        await api.schemes[":schemeId"]["work-orders"][":workOrderId"].complete.$post({
          param: { schemeId, workOrderId },
        }),
      ),
    onSuccess: () => {
      toast.success("Work order completed");
      onChange();
    },
  });

  return (
    <section>
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Wrench aria-hidden="true" className="size-4 text-muted-foreground" /> Work orders
      </h2>
      <div className="mt-3 space-y-2.5">
        {isLoading && <Skeleton className="h-16" />}
        {isError && (
          <ErrorState message="Couldn't load work orders." onRetry={() => void refetch()} />
        )}
        {data?.workOrders.length === 0 && (
          <EmptyState
            icon={ClipboardCheck}
            title="No work orders yet"
            description="A work order is raised once a quote is approved for a triaged request."
          />
        )}
        {data?.workOrders.map((wo) => {
          const completing = complete.isPending && complete.variables === wo.id;
          return (
            <Card key={wo.id} className="py-3">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4 text-sm">
                <div className="min-w-0">
                  <p>{wo.scope}</p>
                  <Money cents={wo.approvedAmountCents} className="text-xs text-muted-foreground" />
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={wo.status} />
                  {isOfficer && COMPLETABLE_STATUSES.includes(wo.status) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => complete.mutate(wo.id)}
                      pending={completing}
                      disabled={complete.isPending}
                    >
                      Mark completed
                    </Button>
                  )}
                </div>
                {complete.isError && complete.variables === wo.id && (
                  <p role="alert" className="w-full text-[13px] text-critical">
                    {complete.error.message}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

const contractorSchema = z.object({
  businessName: z.string().trim().min(1, "Enter the business name."),
  email: z.union([z.literal(""), z.email("Enter a valid email, like trades@example.com.")]),
  trades: z
    .string()
    .trim()
    .refine(
      (v) => v.split(",").some((t) => t.trim().length > 0),
      "List at least one trade, separated by commas.",
    ),
});

function ContractorSection({ schemeId, onChange }: { schemeId: string; onChange: () => void }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["contractors", schemeId],
    queryFn: async () =>
      unwrap<{ contractors: Contractor[] }>(
        await api.schemes[":schemeId"].contractors.$get({ param: { schemeId } }),
      ),
  });
  const [open, setOpen] = useState(false);
  const create = useMutation({
    mutationFn: async (values: { businessName: string; email: string; trades: string }) =>
      unwrap(
        await api.schemes[":schemeId"].contractors.$post({
          param: { schemeId },
          json: {
            businessName: values.businessName,
            email: values.email || undefined,
            tradeCategories: values.trades
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          },
        }),
      ),
    onSuccess: () => {
      setOpen(false);
      form.reset();
      toast.success("Contractor added to the pool");
      onChange();
    },
  });
  const form = useAppForm({
    schema: contractorSchema,
    defaultValues: { businessName: "", email: "", trades: "" },
    onSubmit: (values) => create.mutateAsync(values),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>Contractor pool</CardTitle>
            <CardDescription>The dispatch agent quotes jobs against these trades.</CardDescription>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="shrink-0">
                <Plus aria-hidden="true" className="size-4" /> New contractor
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Add a contractor</DialogTitle>
                <DialogDescription>Your regular trades, ready for dispatch.</DialogDescription>
              </DialogHeader>
              <form
                id="contractor-form"
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void form.handleSubmit();
                }}
              >
                <form.Field name="businessName">
                  {(field) => (
                    <Field
                      label="Business name"
                      required
                      error={fieldError(field.state.meta.errors)}
                    >
                      {(controlProps) => (
                        <Input
                          {...controlProps}
                          data-testid="contractor-name"
                          placeholder="e.g. Northcote Plumbing"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                      )}
                    </Field>
                  )}
                </form.Field>
                <form.Field name="email">
                  {(field) => (
                    <Field
                      label="Email"
                      hint="Optional — used to send quote requests."
                      error={fieldError(field.state.meta.errors)}
                    >
                      {(controlProps) => (
                        <Input
                          {...controlProps}
                          data-testid="contractor-email"
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          placeholder="trades@example.com"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                      )}
                    </Field>
                  )}
                </form.Field>
                <form.Field name="trades">
                  {(field) => (
                    <Field
                      label="Trades"
                      required
                      hint="Comma-separated, e.g. plumbing, drainage."
                      error={fieldError(field.state.meta.errors)}
                    >
                      {(controlProps) => (
                        <Input
                          {...controlProps}
                          data-testid="contractor-trades"
                          placeholder="plumbing, drainage"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                      )}
                    </Field>
                  )}
                </form.Field>
                <FormError form={form} />
              </form>
              <DialogFooter>
                <SubmitButton form={form} formId="contractor-form">
                  Add contractor
                </SubmitButton>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton className="h-10" />}
        {isError && (
          <ErrorState message="Couldn't load the contractor pool." onRetry={() => void refetch()} />
        )}
        {data?.contractors.length === 0 && (
          <EmptyState
            icon={HardHat}
            title="No contractors yet"
            description="Add your regular trades so the dispatch agent can request quotes."
          />
        )}
        {data && data.contractors.length > 0 && (
          <ul className="divide-y">
            {data.contractors.map((c) => (
              <li
                key={c.id}
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{c.businessName}</p>
                  {c.email && <p className="truncate text-xs text-muted-foreground">{c.email}</p>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {c.tradeCategories.map((trade) => (
                    <Badge key={trade} tone="info">
                      {trade}
                    </Badge>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
