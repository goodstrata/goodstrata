import {
  type UseMutationResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Plus, Receipt, Wallet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { LotStatementDialog } from "@/components/LotStatementDialog";
import { StatusBadge } from "@/components/StatusBadge";
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
import { formatMoney, Money } from "@/components/ui/money";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, unwrap } from "@/lib/api";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";
import { formatDate } from "@/lib/format";
import { useIsOfficer } from "@/lib/roles";
import { useIsMobile } from "@/lib/use-mobile";

interface Budget {
  id: string;
  fiscalYearStart: string;
  status: string;
  lines: { fundKind: string; amountCents: number }[];
}
interface Schedule {
  id: string;
  frequency: string;
  instalments: number;
  firstDueOn: string;
  budgetId: string;
}
interface Notice {
  id: string;
  noticeNumber: string;
  lotId: string;
  instalment: number;
  totalCents: number;
  dueOn: string;
  status: string;
  payid: string | null;
}
interface ArrearsRow {
  lotId: string;
  lotNumber: string;
  outstandingCents: number;
  daysOverdue: number;
  stage: number;
  interestAccruedCents: number;
}

// Shared query definitions (one key/fn each; sections and the stat row dedupe).
const budgetsQuery = (schemeId: string) => ({
  queryKey: ["budgets", schemeId] as const,
  queryFn: async () =>
    unwrap<{ budgets: Budget[] }>(
      await api.schemes[":schemeId"].budgets.$get({ param: { schemeId } }),
    ),
});
const schedulesQuery = (schemeId: string) => ({
  queryKey: ["schedules", schemeId] as const,
  queryFn: async () =>
    unwrap<{ schedules: Schedule[] }>(
      await api.schemes[":schemeId"]["levy-schedules"].$get({ param: { schemeId } }),
    ),
});
const noticesQuery = (schemeId: string) => ({
  queryKey: ["notices", schemeId] as const,
  queryFn: async () =>
    unwrap<{ notices: Notice[] }>(
      await api.schemes[":schemeId"]["levy-notices"].$get({ param: { schemeId } }),
    ),
});
const lotsQuery = (schemeId: string) => ({
  queryKey: ["lots", schemeId] as const,
  queryFn: async () =>
    unwrap<{ lots: { id: string; lotNumber: string }[] }>(
      await api.schemes[":schemeId"].lots.$get({ param: { schemeId } }),
    ),
});
const arrearsQuery = (schemeId: string) => ({
  queryKey: ["arrears", schemeId] as const,
  queryFn: async () =>
    unwrap<{ arrears: ArrearsRow[] }>(
      await api.schemes[":schemeId"].arrears.$get({ param: { schemeId } }),
    ),
});

export function FinanceTab({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const isOfficer = useIsOfficer(schemeId);
  const invalidate = () => {
    for (const key of ["budgets", "schedules", "notices", "arrears", "decisions"]) {
      void queryClient.invalidateQueries({ queryKey: [key, schemeId] });
    }
    void queryClient.invalidateQueries({ queryKey: ["lot-statement", schemeId] });
  };

  return (
    <div className="space-y-6">
      <FinanceStats schemeId={schemeId} />
      <ArrearsSection schemeId={schemeId} />
      <BudgetsSection schemeId={schemeId} isOfficer={isOfficer} onChange={invalidate} />
      <SchedulesSection schemeId={schemeId} isOfficer={isOfficer} onChange={invalidate} />
      <NoticesSection schemeId={schemeId} isOfficer={isOfficer} onChange={invalidate} />
    </div>
  );
}

/** Headline figures derived from the budgets, notices and arrears queries. */
function FinanceStats({ schemeId }: { schemeId: string }) {
  const budgets = useQuery(budgetsQuery(schemeId));
  const notices = useQuery(noticesQuery(schemeId));
  const arrears = useQuery(arrearsQuery(schemeId));

  if (budgets.isPending || notices.isPending || arrears.isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {["admin", "maintenance", "levied", "arrears"].map((key) => (
          <Skeleton key={key} className="h-[4.75rem] rounded-lg" />
        ))}
      </div>
    );
  }

  const list = budgets.data?.budgets ?? [];
  const adopted = list.filter((b) => b.status === "adopted");
  const pool = adopted.length > 0 ? adopted : list;
  const current =
    pool.length > 0
      ? [...pool].sort((a, b) => b.fiscalYearStart.localeCompare(a.fiscalYearStart))[0]
      : undefined;
  let adminCents = 0;
  let maintenanceCents = 0;
  for (const line of current?.lines ?? []) {
    if (line.fundKind === "admin") adminCents += line.amountCents;
    else if (line.fundKind === "maintenance") maintenanceCents += line.amountCents;
  }

  const noticeList = notices.data?.notices ?? [];
  const levied = noticeList.reduce((sum, n) => sum + n.totalCents, 0);
  const arrearsList = arrears.data?.arrears ?? [];
  const arrearsTotal = arrearsList.reduce(
    (sum, a) => sum + a.outstandingCents + a.interestAccruedCents,
    0,
  );

  const budgetHint = budgets.isError
    ? "Unavailable"
    : current
      ? `FY from ${formatDate(current.fiscalYearStart)}`
      : "No budget yet";
  const budgetMissing = budgets.isError || !current;
  const noticeCount = noticeList.length;
  const arrearsCount = arrearsList.length;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        label="Admin fund"
        value={budgetMissing ? "—" : formatMoney(adminCents)}
        hint={budgetHint}
      />
      <StatCard
        label="Maintenance fund"
        value={budgetMissing ? "—" : formatMoney(maintenanceCents)}
        hint={budgetHint}
      />
      <StatCard
        label="Levied"
        value={notices.isError ? "—" : formatMoney(levied)}
        hint={
          notices.isError
            ? "Unavailable"
            : noticeCount === 0
              ? "No notices yet"
              : `${noticeCount} ${noticeCount === 1 ? "notice" : "notices"}`
        }
      />
      <StatCard
        label="Arrears"
        value={arrears.isError ? "—" : formatMoney(arrearsTotal)}
        tone={arrears.isError ? undefined : arrearsTotal > 0 ? "critical" : "positive"}
        hint={
          arrears.isError
            ? "Unavailable"
            : arrearsCount === 0
              ? "All lots up to date"
              : `${arrearsCount} ${arrearsCount === 1 ? "lot" : "lots"} overdue`
        }
      />
    </div>
  );
}

// ------------------------------- Budgets -------------------------------

const budgetSchema = z.object({
  fiscalYearStart: z
    .string()
    .refine(
      (v) => v.trim() !== "" && !Number.isNaN(new Date(v).getTime()),
      "Enter the fiscal year start date.",
    ),
  admin: z
    .string()
    .refine(
      (v) => v.trim() !== "" && Number.isFinite(Number(v)),
      "Enter the amount in dollars, like 250.00.",
    )
    .refine((v) => Number(v) > 0, "Enter an amount greater than zero."),
  maintenance: z
    .string()
    .refine(
      (v) => v.trim() === "" || (Number.isFinite(Number(v)) && Number(v) >= 0),
      "Enter zero or more, in dollars.",
    ),
});
type BudgetValues = z.infer<typeof budgetSchema>;

function BudgetsSection({
  schemeId,
  isOfficer,
  onChange,
}: {
  schemeId: string;
  isOfficer: boolean;
  onChange: () => void;
}) {
  const budgets = useQuery(budgetsQuery(schemeId));
  const list = budgets.data?.budgets ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle>Budgets</CardTitle>
            <CardDescription>
              {isOfficer
                ? "Drafting a budget opens a treasurer decision — see the Decisions tab."
                : "Annual admin and maintenance funds for the scheme."}
            </CardDescription>
          </div>
          {isOfficer && <NewBudgetDialog schemeId={schemeId} onChange={onChange} />}
        </div>
      </CardHeader>
      <CardContent>
        {budgets.isPending && <Skeleton className="h-10" />}
        {budgets.isError && (
          <ErrorState
            message="We couldn't load the budgets."
            onRetry={() => void budgets.refetch()}
          />
        )}
        {budgets.data && list.length === 0 && (
          <EmptyState
            icon={Wallet}
            title="No budgets yet"
            description={
              isOfficer
                ? "Draft the first annual budget to open a treasurer decision."
                : "The committee hasn't drafted a budget yet."
            }
          />
        )}
        {list.length > 0 && (
          <ul className="space-y-2.5">
            {list.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-medium">FY from {formatDate(b.fiscalYearStart)}</div>
                  <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-13 text-muted-foreground">
                    {b.lines.map((l) => (
                      <div key={l.fundKind} className="flex items-center gap-1.5">
                        <dt className="capitalize">{l.fundKind}</dt>
                        <dd>
                          <Money cents={l.amountCents} className="text-foreground" />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <StatusBadge status={b.status} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function NewBudgetDialog({ schemeId, onChange }: { schemeId: string; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const form = useAppForm({
    schema: budgetSchema,
    defaultValues: { fiscalYearStart: "", admin: "", maintenance: "" } as BudgetValues,
    onSubmit: async (values) => {
      await unwrap(
        await api.schemes[":schemeId"].budgets.$post({
          param: { schemeId },
          json: {
            fiscalYearStart: values.fiscalYearStart,
            adminCents: Math.round(Number(values.admin) * 100),
            maintenanceCents: Math.round(Number(values.maintenance || "0") * 100),
          },
        }),
      );
      toast.success("Budget drafted — a committee decision has been opened");
      onChange();
      setOpen(false);
      form.reset();
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" /> New budget
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Draft a budget</DialogTitle>
          <DialogDescription>
            Annual amounts for each fund, from the fiscal year start.
          </DialogDescription>
        </DialogHeader>
        <form
          id="budget-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="fiscalYearStart">
            {(field) => (
              <Field label="Fiscal year start" required error={fieldError(field.state.meta.errors)}>
                <Input
                  type="date"
                  data-testid="budget-fy"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="admin">
            {(field) => (
              <Field label="Admin fund ($/yr)" required error={fieldError(field.state.meta.errors)}>
                <Input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  data-testid="budget-admin"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="maintenance">
            {(field) => (
              <Field
                label="Maintenance fund ($/yr)"
                hint="Optional — defaults to zero."
                error={fieldError(field.state.meta.errors)}
              >
                <Input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  data-testid="budget-maintenance"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <FormError form={form} />
        </form>
        <DialogFooter>
          <SubmitButton form={form} formId="budget-form">
            Draft budget
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------ Schedules ------------------------------

const scheduleSchema = z.object({
  budgetId: z.string().min(1, "Select an adopted budget."),
  firstDueOn: z
    .string()
    .refine(
      (v) => v.trim() !== "" && !Number.isNaN(new Date(v).getTime()),
      "Enter the first due date.",
    ),
});
type ScheduleValues = z.infer<typeof scheduleSchema>;

function SchedulesSection({
  schemeId,
  isOfficer,
  onChange,
}: {
  schemeId: string;
  isOfficer: boolean;
  onChange: () => void;
}) {
  const budgets = useQuery(budgetsQuery(schemeId));
  const schedules = useQuery(schedulesQuery(schemeId));
  const adopted = (budgets.data?.budgets ?? []).filter((b) => b.status === "adopted");
  const list = schedules.data?.schedules ?? [];

  const issue = useMutation({
    mutationFn: async (vars: { scheduleId: string; instalment: number }) =>
      unwrap(
        await api.schemes[":schemeId"]["levy-schedules"][":scheduleId"].issue.$post({
          param: { schemeId, scheduleId: vars.scheduleId },
          json: { instalment: vars.instalment },
        }),
      ),
    onSuccess: () => {
      toast.success("Levy notices issued to all lots");
      onChange();
    },
    onError: (e) => toast.error(e.message),
  });

  // Owners see nothing actionable here until a schedule exists.
  if (!isOfficer && (schedules.isPending || list.length === 0)) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle>Levy schedules</CardTitle>
            <CardDescription>
              {isOfficer
                ? "Split an adopted budget into instalments and issue notices."
                : "How the adopted budget is split into instalments."}
            </CardDescription>
          </div>
          {isOfficer && adopted.length > 0 && (
            <NewScheduleDialog schemeId={schemeId} adopted={adopted} onChange={onChange} />
          )}
        </div>
      </CardHeader>
      <CardContent>
        {schedules.isPending && <Skeleton className="h-10" />}
        {schedules.isError && (
          <ErrorState
            message="We couldn't load the levy schedules."
            onRetry={() => void schedules.refetch()}
          />
        )}
        {schedules.data && list.length === 0 && (
          <EmptyState
            icon={CalendarClock}
            title="No schedules yet"
            description={
              adopted.length > 0
                ? "Create a quarterly schedule from an adopted budget."
                : "Adopt a budget first, then split it into instalments."
            }
          />
        )}
        {list.length > 0 && (
          <ul>
            {list.map((s) => (
              <ScheduleRow key={s.id} schedule={s} isOfficer={isOfficer} issue={issue} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ScheduleRow({
  schedule,
  isOfficer,
  issue,
}: {
  schedule: Schedule;
  isOfficer: boolean;
  issue: UseMutationResult<unknown, Error, { scheduleId: string; instalment: number }>;
}) {
  const [instalment, setInstalment] = useState("1");
  const pending = issue.isPending && issue.variables?.scheduleId === schedule.id;

  return (
    <li className="flex flex-col gap-2 border-t py-3 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm">
        <span className="font-medium">
          {schedule.frequency} × {schedule.instalments}
        </span>
        <span className="text-muted-foreground">
          {" "}
          · first due {formatDate(schedule.firstDueOn)}
        </span>
      </div>
      {isOfficer && (
        <div className="flex items-center gap-2">
          <Select value={instalment} onValueChange={setInstalment}>
            <SelectTrigger
              size="sm"
              className="w-[8.5rem]"
              aria-label="Instalment to issue"
              data-testid="issue-instalment"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: schedule.instalments }, (_, i) => (
                <SelectItem key={`${schedule.id}-${i + 1}`} value={String(i + 1)}>
                  Instalment {i + 1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            pending={pending}
            onClick={() =>
              issue.mutate({ scheduleId: schedule.id, instalment: Number(instalment) })
            }
          >
            Issue notices
          </Button>
        </div>
      )}
    </li>
  );
}

function NewScheduleDialog({
  schemeId,
  adopted,
  onChange,
}: {
  schemeId: string;
  adopted: Budget[];
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const form = useAppForm({
    schema: scheduleSchema,
    defaultValues: { budgetId: "", firstDueOn: "" } as ScheduleValues,
    onSubmit: async (values) => {
      await unwrap(
        await api.schemes[":schemeId"]["levy-schedules"].$post({
          param: { schemeId },
          json: {
            budgetId: values.budgetId,
            frequency: "quarterly",
            firstDueOn: values.firstDueOn,
          },
        }),
      );
      toast.success("Levy schedule created");
      onChange();
      setOpen(false);
      form.reset();
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" /> New schedule
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Create a levy schedule</DialogTitle>
          <DialogDescription>Quarterly instalments across the fiscal year.</DialogDescription>
        </DialogHeader>
        <form
          id="schedule-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="budgetId">
            {(field) => (
              <Field label="Adopted budget" required error={fieldError(field.state.meta.errors)}>
                {(control) => (
                  <Select value={field.state.value} onValueChange={(v) => field.handleChange(v)}>
                    <SelectTrigger
                      id={control.id}
                      aria-invalid={control["aria-invalid"]}
                      aria-describedby={control["aria-describedby"]}
                      className="w-full"
                      data-testid="schedule-budget"
                    >
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {adopted.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          FY {formatDate(b.fiscalYearStart)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            )}
          </form.Field>
          <form.Field name="firstDueOn">
            {(field) => (
              <Field label="First due" required error={fieldError(field.state.meta.errors)}>
                <Input
                  type="date"
                  data-testid="schedule-first-due"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <FormError form={form} />
        </form>
        <DialogFooter>
          <SubmitButton form={form} formId="schedule-form">
            Create quarterly schedule
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------- Notices -------------------------------

function NoticesSection({
  schemeId,
  isOfficer,
  onChange,
}: {
  schemeId: string;
  isOfficer: boolean;
  onChange: () => void;
}) {
  const notices = useQuery(noticesQuery(schemeId));
  const lots = useQuery(lotsQuery(schemeId));
  const isMobile = useIsMobile();
  const lotNumber = (lotId: string) =>
    lots.data?.lots.find((l) => l.id === lotId)?.lotNumber ?? "—";

  const simulate = useMutation({
    mutationFn: async (notice: Notice) => {
      const res = await fetch("/dev/simulate-payment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payid: notice.payid, amountCents: notice.totalCents }),
      });
      if (!res.ok) throw new Error("Simulation failed (dev server only)");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Payment received");
      onChange();
    },
    onError: (e) => toast.error(e.message),
  });

  const list = notices.data?.notices ?? [];
  // Owners with no notices see nothing (the stat row already summarises levies).
  if (!isOfficer && (notices.isPending || list.length === 0)) return null;

  const canSimulate = (n: Notice) => isOfficer && n.status !== "paid" && Boolean(n.payid);
  const simulateButton = (n: Notice, className?: string) =>
    canSimulate(n) ? (
      <Button
        variant="outline"
        size="sm"
        className={className}
        pending={simulate.isPending && simulate.variables?.id === n.id}
        onClick={() => simulate.mutate(n)}
        title="Dev only: post a signed mock webhook"
      >
        Simulate payment
      </Button>
    ) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Levy notices</CardTitle>
        <CardDescription>Issued to each lot with a unique PayID.</CardDescription>
      </CardHeader>
      <CardContent>
        {notices.isPending && <Skeleton className="h-24" />}
        {notices.isError && (
          <ErrorState
            message="We couldn't load the levy notices."
            onRetry={() => void notices.refetch()}
          />
        )}
        {notices.data && list.length === 0 && (
          <EmptyState
            icon={Receipt}
            title="No notices issued yet"
            description="Issue notices from a levy schedule to bill each lot."
          />
        )}
        {list.length > 0 &&
          (isMobile ? (
            <ul className="space-y-3">
              {list.map((n) => (
                <li key={n.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {n.noticeNumber}
                    </span>
                    <StatusBadge status={n.status} />
                  </div>
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <div className="text-sm">
                      <div>
                        Lot <span className="font-mono tabular-nums">{lotNumber(n.lotId)}</span>
                      </div>
                      <div className="text-muted-foreground">Due {formatDate(n.dueOn)}</div>
                    </div>
                    <Money cents={n.totalCents} className="text-base" />
                  </div>
                  {simulateButton(n, "mt-3 w-full")}
                </li>
              ))}
            </ul>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Notice</TableHead>
                  <TableHead>Lot</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell className="font-mono text-xs">{n.noticeNumber}</TableCell>
                    <TableCell className="tabular-nums">{lotNumber(n.lotId)}</TableCell>
                    <TableCell className="text-right">
                      <Money cents={n.totalCents} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(n.dueOn)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={n.status} />
                    </TableCell>
                    <TableCell className="text-right">{simulateButton(n)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ))}
      </CardContent>
    </Card>
  );
}

// ------------------------------- Arrears -------------------------------

function ArrearsSection({ schemeId }: { schemeId: string }) {
  const arrears = useQuery(arrearsQuery(schemeId));

  if (arrears.isError) {
    return (
      <ErrorState
        message="We couldn't load arrears — a lot may be overdue."
        onRetry={() => void arrears.refetch()}
      />
    );
  }
  if (arrears.isPending || !arrears.data || arrears.data.arrears.length === 0) return null;

  return (
    <Card role="region" aria-label="Arrears" className="border-critical/25 bg-critical/8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-critical">
          <AlertTriangle className="size-4" aria-hidden="true" /> Arrears
        </CardTitle>
        <CardDescription>Lots with overdue levies and accrued interest.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul>
          {arrears.data.arrears.map((a) => (
            <li
              key={a.lotId}
              className="flex flex-col gap-2 border-t border-critical/15 py-3 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="text-sm">
                <span className="font-medium">Lot {a.lotNumber}</span>
                <span className="text-muted-foreground">
                  {" "}
                  — {a.daysOverdue} days overdue (stage {a.stage})
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-sm">
                  <Money cents={a.outstandingCents} />
                  <span className="text-muted-foreground"> + </span>
                  <Money cents={a.interestAccruedCents} />
                  <span className="text-muted-foreground"> interest</span>
                </span>
                <LotStatementDialog schemeId={schemeId} lotId={a.lotId} lotNumber={a.lotNumber} />
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
