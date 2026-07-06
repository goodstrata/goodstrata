import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ClipboardCheck, FileSearch, HardHat, Plus, Wrench } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  ownerStatusLabel,
  ownerStatusTone,
  ReportIssueDialog,
} from "@/components/maintenance/ReportIssueDialog";
import { RequestQuotesButton, RfqSection } from "@/components/RfqSection";
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
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, unwrap } from "@/lib/api";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";
import { useIsOfficer, useIsOwnerView } from "@/lib/roles";

interface Request {
  id: string;
  title: string;
  description: string;
  category: string | null;
  urgency: string | null;
  isCommonProperty: boolean | null;
  aiTriage: { reasoning?: string; declineExplanation?: string } | null;
  status: string;
  createdAt: string;
}
interface WorkOrder {
  id: string;
  scope: string;
  approvedAmountCents: number;
  status: string;
  contractorId: string;
  contractorName: string | null;
  requestTitle: string | null;
}
interface Contractor {
  id: string;
  businessName: string;
  tradeCategories: string[];
  email: string | null;
}

/** Officer statuses where a work order can still be marked completed. */
const COMPLETABLE_STATUSES = ["dispatched", "accepted", "scheduled", "in_progress"];

const URGENCY_TONES: Record<string, "critical" | "caution" | "neutral"> = {
  emergency: "critical",
  high: "caution",
  routine: "neutral",
};

export function MaintenanceTab({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const isOfficer = useIsOfficer(schemeId);
  const isOwnerView = useIsOwnerView(schemeId);
  const [tab, setTab] = useState("requests");
  const invalidate = () => {
    for (const key of ["maintenance", "work-orders", "contractors", "decisions", "rfqs", "rfq"]) {
      void queryClient.invalidateQueries({ queryKey: [key, schemeId] });
    }
  };

  // The Requests surface is for everyone (owners get their own variant). It is
  // shared between the owner's untabbed view and the officer's first tab.
  const requests = (
    <RequestList
      schemeId={schemeId}
      isOfficer={isOfficer}
      isOwnerView={isOwnerView}
      onChange={invalidate}
    />
  );

  return (
    <div className="space-y-8">
      <PageHeader
        as="h2"
        title={isOwnerView ? "Report an issue" : "Maintenance"}
        description={
          isOwnerView
            ? "Report something wrong in the building. The maintenance agent triages every report automatically."
            : "Report issues, follow the agent's triage, and track work through to completion."
        }
        actions={
          <ReportIssueDialog
            schemeId={schemeId}
            onChange={invalidate}
            triggerLabel="Report an issue"
          />
        }
      />
      {/* Role gating preserved exactly: the committee-only ops surfaces (Quotes,
          Work orders, Contractors) live behind officer tabs and never render for
          non-officers. Owners keep their single, untabbed Requests view. */}
      {isOfficer ? (
        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <TabsList aria-label="Maintenance sections">
            <TabsTrigger value="requests" className="gap-2">
              <Wrench className="size-4" aria-hidden="true" />
              Requests
            </TabsTrigger>
            <TabsTrigger value="quotes" className="gap-2">
              <FileSearch className="size-4" aria-hidden="true" />
              Quotes
            </TabsTrigger>
            <TabsTrigger value="work-orders" className="gap-2">
              <ClipboardCheck className="size-4" aria-hidden="true" />
              Work orders
            </TabsTrigger>
            <TabsTrigger value="contractors" className="gap-2">
              <HardHat className="size-4" aria-hidden="true" />
              Contractors
            </TabsTrigger>
          </TabsList>
          <TabsContent value="requests">{requests}</TabsContent>
          <TabsContent value="quotes">
            <RfqSection schemeId={schemeId} isOfficer={isOfficer} onChange={invalidate} />
          </TabsContent>
          <TabsContent value="work-orders">
            <WorkOrderList schemeId={schemeId} isOfficer={isOfficer} onChange={invalidate} />
          </TabsContent>
          <TabsContent value="contractors">
            <ContractorSection schemeId={schemeId} onChange={invalidate} />
          </TabsContent>
        </Tabs>
      ) : (
        requests
      )}
    </div>
  );
}

function RequestList({
  schemeId,
  isOfficer,
  isOwnerView,
  onChange,
}: {
  schemeId: string;
  isOfficer: boolean;
  isOwnerView: boolean;
  onChange: () => void;
}) {
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
      <h2 className="text-base font-semibold">
        {isOwnerView ? "Requests in your building" : "Requests"}
      </h2>
      <p className="text-sm text-muted-foreground">
        {isOwnerView
          ? "Track what's been reported. Report anything new and the maintenance agent takes it from there."
          : "Maintenance reports from residents and owners."}
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
            title={isOwnerView ? "Nothing reported yet" : "No maintenance requests yet"}
            description={
              isOwnerView
                ? "If something's wrong in the building, report it and we'll take it from there."
                : "Report an issue and the maintenance agent triages it automatically."
            }
            action={
              <ReportIssueDialog
                schemeId={schemeId}
                onChange={onChange}
                triggerLabel="Report an issue"
              />
            }
          />
        )}
        {data?.requests.map((r) => (
          <Card key={r.id} data-testid={`mr-${r.title}`} className="py-4">
            <CardContent className="px-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium">{r.title}</p>
                <div className="flex shrink-0 items-center gap-1.5">
                  {!isOwnerView && r.urgency && (
                    <Badge tone={URGENCY_TONES[r.urgency] ?? "neutral"}>{r.urgency}</Badge>
                  )}
                  {isOwnerView ? (
                    <Badge tone={ownerStatusTone(r.status)}>{ownerStatusLabel(r.status)}</Badge>
                  ) : (
                    <StatusBadge status={r.status} />
                  )}
                </div>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{r.description}</p>
              {r.category && (
                <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 text-agent">
                    <Bot aria-hidden="true" className="size-3.5" />
                    triaged
                  </span>
                  <span className="font-medium">{r.category}</span>
                  <span>{r.isCommonProperty ? "common property" : "lot responsibility"}</span>
                </p>
              )}
              {r.aiTriage?.reasoning && (
                <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground italic">
                  {r.aiTriage.reasoning}
                </p>
              )}
              {r.status === "rejected" && r.aiTriage?.declineExplanation && (
                <p className="mt-2 text-13 text-muted-foreground">
                  <span className="font-medium text-foreground">Not proceeding: </span>
                  {r.aiTriage.declineExplanation}
                </p>
              )}
              {isOfficer && r.status === "triaged" && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <RequestQuotesButton schemeId={schemeId} requestId={r.id} onChange={onChange} />
                  <RaiseWorkOrderDialog schemeId={schemeId} request={r} onChange={onChange} />
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

const raiseSchema = z.object({
  contractorId: z.string().min(1, "Choose a contractor from the pool."),
  scope: z.string().trim().min(5, "Describe the scope of work (at least a sentence)."),
  estimate: z
    .string()
    .trim()
    .refine(
      (v) => v !== "" && Number.isFinite(Number(v)) && Number(v) > 0,
      "Enter the estimated cost in dollars.",
    ),
  accessNotes: z.string().trim().max(1000, "Keep access notes under 1,000 characters."),
});

const ROUTE_TOASTS: Record<string, string> = {
  auto_dispatched: "Work order dispatched to the contractor",
  awaiting_approval: "Work order raised — awaiting committee approval",
  emergency_dispatched: "Emergency works dispatched — the committee will review",
};

/**
 * Officer fallback when the agent couldn't propose works (e.g. no contractors
 * at triage time). Routing stays with the platform: small jobs dispatch
 * immediately, larger ones go to the committee, emergencies dispatch now with
 * a post-hoc review.
 */
function RaiseWorkOrderDialog({
  schemeId,
  request,
  onChange,
}: {
  schemeId: string;
  request: Request;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const contractorsQuery = useQuery({
    queryKey: ["contractors", schemeId],
    queryFn: async () =>
      unwrap<{ contractors: Contractor[] }>(
        await api.schemes[":schemeId"].contractors.$get({ param: { schemeId } }),
      ),
    enabled: open,
  });
  const raise = useMutation({
    mutationFn: async (values: z.infer<typeof raiseSchema>) =>
      unwrap<{ route: { mode: string } }>(
        await api.schemes[":schemeId"]["work-orders"].$post({
          param: { schemeId },
          json: {
            requestId: request.id,
            contractorId: values.contractorId,
            scope: values.scope,
            estimatedCents: Math.round(Number(values.estimate) * 100),
            accessNotes: values.accessNotes || undefined,
          },
        }),
      ),
    onSuccess: ({ route }) => {
      setOpen(false);
      form.reset();
      toast.success(ROUTE_TOASTS[route.mode] ?? "Work order raised");
      onChange();
    },
  });
  const form = useAppForm({
    schema: raiseSchema,
    defaultValues: { contractorId: "", scope: "", estimate: "", accessNotes: "" },
    onSubmit: (values) => raise.mutateAsync(values),
  });
  const pool = contractorsQuery.data?.contractors ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <HardHat aria-hidden="true" className="size-4" /> Raise work order
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Raise a work order</DialogTitle>
          <DialogDescription>
            For “{request.title}”. Small jobs dispatch immediately; larger ones go to the committee
            for approval.
          </DialogDescription>
        </DialogHeader>
        <form
          id="wo-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="contractorId">
            {(field) => (
              <Field label="Contractor" required error={fieldError(field.state.meta.errors)}>
                {(controlProps) => (
                  <Select value={field.state.value} onValueChange={field.handleChange}>
                    <SelectTrigger {...controlProps} data-testid="wo-contractor">
                      <SelectValue
                        placeholder={
                          contractorsQuery.isLoading
                            ? "Loading contractors…"
                            : pool.length === 0
                              ? "No contractors in the pool yet"
                              : "Choose a contractor"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {pool.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.businessName} — {c.tradeCategories.join(", ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            )}
          </form.Field>
          <form.Field name="scope">
            {(field) => (
              <Field label="Scope of work" required error={fieldError(field.state.meta.errors)}>
                {(controlProps) => (
                  <Textarea
                    {...controlProps}
                    data-testid="wo-scope"
                    className="min-h-20"
                    placeholder="What exactly should the contractor do?"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                )}
              </Field>
            )}
          </form.Field>
          <form.Field name="estimate">
            {(field) => (
              <Field
                label="Estimated cost ($)"
                required
                hint="The approved amount the contractor must not exceed."
                error={fieldError(field.state.meta.errors)}
              >
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    data-testid="wo-estimate"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="e.g. 450"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                )}
              </Field>
            )}
          </form.Field>
          <form.Field name="accessNotes">
            {(field) => (
              <Field
                label="Access notes"
                hint="Optional — keys, contact on site, hours."
                error={fieldError(field.state.meta.errors)}
              >
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    data-testid="wo-access"
                    placeholder="e.g. Key from lot 3, weekdays after 9am"
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
          <SubmitButton form={form} formId="wo-form">
            Raise work order
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <Money cents={wo.approvedAmountCents} />
                    {wo.contractorName && (
                      <span className="inline-flex items-center gap-1">
                        <HardHat aria-hidden="true" className="size-3" />
                        {wo.contractorName}
                      </span>
                    )}
                    {wo.requestTitle && <span className="truncate">for “{wo.requestTitle}”</span>}
                  </p>
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
                  <p role="alert" className="w-full text-13 text-critical">
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
