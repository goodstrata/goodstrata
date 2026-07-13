import {
  type UseMutationResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  HandCoins,
  Landmark,
  Plus,
  Receipt,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { LotStatementDialog } from "@/components/LotStatementDialog";
import { PdfDownloadButton } from "@/components/PdfDownloadButton";
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
import { formatDate, formatDateTime } from "@/lib/format";
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
interface PaymentRow {
  id: string;
  provider: string;
  providerRef: string;
  payid: string | null;
  amountCents: number;
  paidAt: string;
  payerName: string | null;
  status: string;
  receiptNumber: string | null;
  levyNoticeId: string | null;
  noticeNumber: string | null;
  lotId: string | null;
}
interface PaymentsStatusData {
  provider: string;
  trustAccount: {
    status: string;
    bsb: string | null;
    accountNumber: string | null;
    payidRoot: string | null;
    provider: string;
  } | null;
  unmatchedCount: number;
  lastPaymentAt: string | null;
  webhookLastSeenAt: string | null;
  unprocessedWebhooks: number;
}
interface FinancialStatement {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  requiredReviewKind: "audit" | "independent_review" | null;
  review: { kind: string; outcome: string } | null;
}
interface InterestAuthorisation {
  id: string;
  rateBps: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
}

const OPEN_NOTICE_STATUSES = ["issued", "partially_paid", "overdue"];

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
const paymentsQuery = (schemeId: string) => ({
  queryKey: ["payments", schemeId] as const,
  queryFn: async () =>
    unwrap<{ payments: PaymentRow[] }>(
      await api.schemes[":schemeId"].payments.$get({ param: { schemeId } }),
    ),
});
const paymentsStatusQuery = (schemeId: string) => ({
  queryKey: ["payments-status", schemeId] as const,
  queryFn: async () =>
    unwrap<{ status: PaymentsStatusData }>(
      await api.schemes[":schemeId"].payments.status.$get({ param: { schemeId } }),
    ),
});
const financialStatementsQuery = (schemeId: string) => ({
  queryKey: ["financial-statements", schemeId] as const,
  queryFn: async () =>
    unwrap<{ statements: FinancialStatement[] }>(
      await api.schemes[":schemeId"]["financial-statements"].$get({ param: { schemeId } }),
    ),
});
const interestAuthorisationsQuery = (schemeId: string) => ({
  queryKey: ["interest-authorisations", schemeId] as const,
  queryFn: async () =>
    unwrap<{ authorisations: InterestAuthorisation[] }>(
      await api.schemes[":schemeId"]["interest-authorisations"].$get({ param: { schemeId } }),
    ),
});

export function FinanceTab({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const isOfficer = useIsOfficer(schemeId);
  const invalidate = () => {
    for (const key of [
      "budgets",
      "schedules",
      "notices",
      "arrears",
      "decisions",
      "payments",
      "payments-status",
      "financial-statements",
      "interest-authorisations",
    ]) {
      void queryClient.invalidateQueries({ queryKey: [key, schemeId] });
    }
    void queryClient.invalidateQueries({ queryKey: ["lot-statement", schemeId] });
  };

  return (
    <div className="space-y-6">
      <FinanceStats schemeId={schemeId} />
      <ArrearsSection schemeId={schemeId} isOfficer={isOfficer} />
      <HowToPaySection schemeId={schemeId} isOfficer={isOfficer} />
      <PaymentsSection schemeId={schemeId} isOfficer={isOfficer} onChange={invalidate} />
      <BudgetsSection schemeId={schemeId} isOfficer={isOfficer} onChange={invalidate} />
      {isOfficer && <StatutoryFinanceSection schemeId={schemeId} onChange={invalidate} />}
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

// ------------------------------ How to pay ------------------------------

/**
 * Owner-facing payment details (BSB/account + reference guidance) plus, for
 * officers, a compact payments-provider status line (provider, webhook
 * liveness, suspense-queue size).
 */
function HowToPaySection({ schemeId, isOfficer }: { schemeId: string; isOfficer: boolean }) {
  const status = useQuery(paymentsStatusQuery(schemeId));

  if (status.isPending) return null;
  // Owners only see this card once there's an account, so stay quiet for them;
  // officers get a visible "temporarily unavailable" instead of a missing card.
  if (status.isError) {
    if (!isOfficer) return null;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="size-4" aria-hidden="true" /> How to pay
          </CardTitle>
          <CardDescription>
            Payment status didn't load just now. Refresh the page to try again.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  const s = status.data.status;
  const account = s.trustAccount;
  if (!account && !isOfficer) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark className="size-4" aria-hidden="true" /> How to pay
        </CardTitle>
        <CardDescription>
          Each levy notice carries its own PayID (on the emailed notice and PDF) — payments to it
          are matched automatically. Bank transfers work too: quote your notice number.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {account?.status === "active" && account.bsb && account.accountNumber ? (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">BSB</dt>
              <dd className="font-mono tabular-nums">{account.bsb}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Account number</dt>
              <dd className="font-mono tabular-nums">{account.accountNumber}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Reference</dt>
              <dd>Your levy notice number</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            {account
              ? "The scheme's collection account is still being provisioned — pay using the details on your levy notice, or contact the treasurer."
              : "Payment details appear once the first levy run issues."}
          </p>
        )}
        {isOfficer && (
          <p className="border-t pt-3 text-xs text-muted-foreground">
            Provider <span className="font-mono">{s.provider}</span>
            {" · webhook last seen "}
            {s.webhookLastSeenAt ? formatDateTime(s.webhookLastSeenAt) : "never"}
            {s.unmatchedCount > 0 && (
              <>
                {" · "}
                <span className="font-medium text-critical">
                  {s.unmatchedCount} unmatched {s.unmatchedCount === 1 ? "payment" : "payments"}
                </span>
              </>
            )}
            {s.unprocessedWebhooks > 0 && (
              <>
                {" · "}
                <span className="font-medium text-critical">
                  {s.unprocessedWebhooks} webhook{" "}
                  {s.unprocessedWebhooks === 1 ? "delivery" : "deliveries"} pending
                </span>
              </>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------- Payments -------------------------------

function PaymentsSection({
  schemeId,
  isOfficer,
  onChange,
}: {
  schemeId: string;
  isOfficer: boolean;
  onChange: () => void;
}) {
  const payments = useQuery(paymentsQuery(schemeId));
  const notices = useQuery(noticesQuery(schemeId));
  const lots = useQuery(lotsQuery(schemeId));
  const isMobile = useIsMobile();
  const lotNumber = (lotId: string | null) =>
    lots.data?.lots.find((l) => l.id === lotId)?.lotNumber ?? "—";

  const list = payments.data?.payments ?? [];
  const unmatchedCount = list.filter((p) => p.status === "unmatched").length;
  const openNotices = (notices.data?.notices ?? []).filter((n) =>
    OPEN_NOTICE_STATUSES.includes(n.status),
  );

  // Owners see nothing until money has moved.
  if (!isOfficer && (payments.isPending || list.length === 0)) return null;

  const receiptLink = (p: PaymentRow, className?: string) =>
    p.receiptNumber ? (
      <PdfDownloadButton
        href={`/api/schemes/${schemeId}/documents/payments/${p.id}/receipt.pdf`}
        fallbackFilename={`Receipt-${p.receiptNumber}.pdf`}
        className={className}
        title={`Download receipt ${p.receiptNumber}`}
        data-testid={`receipt-pdf-${p.id}`}
      >
        Receipt
      </PdfDownloadButton>
    ) : null;

  const matchButton = (p: PaymentRow, className?: string) =>
    isOfficer && p.status === "unmatched" ? (
      <MatchPaymentDialog
        schemeId={schemeId}
        payment={p}
        openNotices={openNotices}
        lotNumber={lotNumber}
        onChange={onChange}
        className={className}
      />
    ) : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle>Payments</CardTitle>
            <CardDescription>
              {isOfficer && unmatchedCount > 0 ? (
                <span className="font-medium text-critical">
                  {unmatchedCount === 1
                    ? "1 payment needs matching to a notice."
                    : `${unmatchedCount} payments need matching to a notice.`}
                </span>
              ) : (
                "Every payment received, with its receipt."
              )}
            </CardDescription>
          </div>
          {isOfficer && (
            <RecordPaymentDialog
              schemeId={schemeId}
              openNotices={openNotices}
              lotNumber={lotNumber}
              onChange={onChange}
            />
          )}
        </div>
      </CardHeader>
      <CardContent>
        {payments.isPending && <Skeleton className="h-24" />}
        {payments.isError && (
          <ErrorState
            message="We couldn't load the payments."
            onRetry={() => void payments.refetch()}
          />
        )}
        {payments.data && list.length === 0 && (
          <EmptyState
            icon={HandCoins}
            title="No payments yet"
            description="Payments appear here as they arrive — or record a bank transfer manually."
          />
        )}
        {list.length > 0 &&
          (isMobile ? (
            <ul className="space-y-3">
              {list.map((p) => (
                <li key={p.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">{formatDate(p.paidAt)}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <div className="min-w-0 text-sm">
                      <div className="truncate">{p.payerName ?? "Unknown payer"}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.noticeNumber ? (
                          <span className="font-mono">{p.noticeNumber}</span>
                        ) : (
                          `via ${p.provider}`
                        )}
                      </div>
                    </div>
                    <Money cents={p.amountCents} className="text-base" />
                  </div>
                  {receiptLink(p, "mt-3 w-full")}
                  {matchButton(p, "mt-3 w-full")}
                </li>
              ))}
            </ul>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>Applied to</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(p.paidAt)}
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[14rem] truncate">{p.payerName ?? "Unknown payer"}</div>
                      <div className="text-xs text-muted-foreground">via {p.provider}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {p.noticeNumber ? (
                        <>
                          {p.noticeNumber}
                          <span className="block text-muted-foreground">
                            Lot {lotNumber(p.lotId)}
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Money cents={p.amountCents} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {receiptLink(p)}
                        {matchButton(p)}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ))}
      </CardContent>
    </Card>
  );
}

const manualPaymentSchema = z.object({
  levyNoticeId: z.string().min(1, "Select the notice this payment pays."),
  amount: z
    .string()
    .refine(
      (v) => v.trim() !== "" && Number.isFinite(Number(v)),
      "Enter the amount in dollars, like 250.00.",
    )
    .refine((v) => Number(v) > 0, "Enter an amount greater than zero."),
  paidAt: z
    .string()
    .refine(
      (v) => v.trim() !== "" && !Number.isNaN(new Date(v).getTime()),
      "Enter the date the money arrived.",
    ),
  payerName: z.string(),
  reference: z.string(),
});
type ManualPaymentValues = z.infer<typeof manualPaymentSchema>;

/** Treasurer records a bank transfer that arrived outside the provider rail. */
function RecordPaymentDialog({
  schemeId,
  openNotices,
  lotNumber,
  onChange,
}: {
  schemeId: string;
  openNotices: Notice[];
  lotNumber: (lotId: string | null) => string;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const form = useAppForm({
    schema: manualPaymentSchema,
    defaultValues: {
      levyNoticeId: "",
      amount: "",
      paidAt: "",
      payerName: "",
      reference: "",
    } as ManualPaymentValues,
    onSubmit: async (values) => {
      await unwrap(
        await api.schemes[":schemeId"].payments.manual.$post({
          param: { schemeId },
          json: {
            levyNoticeId: values.levyNoticeId,
            amountCents: Math.round(Number(values.amount) * 100),
            paidAt: values.paidAt,
            payerName: values.payerName.trim() || undefined,
            reference: values.reference.trim() || undefined,
          },
        }),
      );
      toast.success("Payment recorded — receipt issued");
      onChange();
      setOpen(false);
      form.reset();
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" /> Record payment
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Record a bank transfer</DialogTitle>
          <DialogDescription>
            For money that arrived outside PayID — it runs the same allocation and receipt chain,
            and lands on the audit log.
          </DialogDescription>
        </DialogHeader>
        <form
          id="manual-payment-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="levyNoticeId">
            {(field) => (
              <Field label="Levy notice" required error={fieldError(field.state.meta.errors)}>
                {(control) => (
                  <Select value={field.state.value} onValueChange={(v) => field.handleChange(v)}>
                    <SelectTrigger
                      id={control.id}
                      aria-invalid={control["aria-invalid"]}
                      aria-describedby={control["aria-describedby"]}
                      className="w-full"
                      data-testid="manual-payment-notice"
                    >
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {openNotices.map((n) => (
                        <SelectItem key={n.id} value={n.id}>
                          {n.noticeNumber} · Lot {lotNumber(n.lotId)} · {formatMoney(n.totalCents)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            )}
          </form.Field>
          <form.Field name="amount">
            {(field) => (
              <Field label="Amount ($)" required error={fieldError(field.state.meta.errors)}>
                <Input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  data-testid="manual-payment-amount"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="paidAt">
            {(field) => (
              <Field label="Date received" required error={fieldError(field.state.meta.errors)}>
                <Input
                  type="date"
                  data-testid="manual-payment-date"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="payerName">
            {(field) => (
              <Field label="Payer" hint="Optional — as it appears on the bank statement.">
                <Input
                  data-testid="manual-payment-payer"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="reference">
            {(field) => (
              <Field
                label="Bank reference"
                hint="Optional — stops the same statement line being recorded twice."
              >
                <Input
                  data-testid="manual-payment-reference"
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
          <SubmitButton form={form} formId="manual-payment-form">
            Record payment
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Resolve a parked (unmatched) payment onto an open notice. */
function MatchPaymentDialog({
  schemeId,
  payment,
  openNotices,
  lotNumber,
  onChange,
  className,
}: {
  schemeId: string;
  payment: PaymentRow;
  openNotices: Notice[];
  lotNumber: (lotId: string | null) => string;
  onChange: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [noticeId, setNoticeId] = useState("");

  const match = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.schemes[":schemeId"].payments[":paymentId"].match.$post({
          param: { schemeId, paymentId: payment.id },
          json: { levyNoticeId: noticeId },
        }),
      ),
    onSuccess: () => {
      toast.success("Payment matched — receipt issued");
      onChange();
      setOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className={className}>
          Match
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Match payment to a notice</DialogTitle>
          <DialogDescription>
            {formatMoney(payment.amountCents)} from {payment.payerName ?? "an unknown payer"} on{" "}
            {formatDate(payment.paidAt)}
            {payment.payid ? ` (reference ${payment.payid})` : ""}.
          </DialogDescription>
        </DialogHeader>
        <Field label="Levy notice" required>
          {(control) => (
            <Select value={noticeId} onValueChange={setNoticeId}>
              <SelectTrigger
                id={control.id}
                className="w-full"
                data-testid={`match-payment-notice-${payment.id}`}
              >
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {openNotices.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.noticeNumber} · Lot {lotNumber(n.lotId)} · {formatMoney(n.totalCents)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
        <DialogFooter>
          <Button
            pending={match.isPending}
            disabled={!noticeId}
            onClick={() => match.mutate()}
            data-testid={`match-payment-submit-${payment.id}`}
          >
            Match payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
                <div className="flex items-center gap-2">
                  <StatusBadge status={b.status} />
                  {isOfficer && b.status === "committee_review" ? (
                    <AdoptBudgetDialog schemeId={schemeId} budgetId={b.id} onChange={onChange} />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AdoptBudgetDialog({
  schemeId,
  budgetId,
  onChange,
}: {
  schemeId: string;
  budgetId: string;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [motionId, setMotionId] = useState("");
  const adopt = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.schemes[":schemeId"].budgets[":budgetId"].adopt.$post({
          param: { schemeId, budgetId },
          json: { motionId },
        }),
      ),
    onSuccess: () => {
      toast.success("Budget adoption linked to the carried general-meeting resolution");
      onChange();
      setOpen(false);
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Record adoption
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Record budget adoption</DialogTitle>
          <DialogDescription>
            Link the carried ordinary motion from the AGM or SGM. A treasurer approval alone cannot
            adopt the budget.
          </DialogDescription>
        </DialogHeader>
        <Field label="Carried motion ID" required>
          <Input value={motionId} onChange={(event) => setMotionId(event.target.value)} />
        </Field>
        <DialogFooter>
          <Button disabled={!motionId} pending={adopt.isPending} onClick={() => adopt.mutate()}>
            Adopt budget
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function StatutoryFinanceSection({
  schemeId,
  onChange,
}: {
  schemeId: string;
  onChange: () => void;
}) {
  const statements = useQuery(financialStatementsQuery(schemeId));
  const interest = useQuery(interestAuthorisationsQuery(schemeId));
  const [action, setAction] = useState<"statement" | "special" | "interest" | "review" | null>(
    null,
  );
  const [targetStatement, setTargetStatement] = useState<FinancialStatement | null>(null);
  const [motionId, setMotionId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [rate, setRate] = useState("10");
  const [reviewer, setReviewer] = useState("");
  const [reportDocumentId, setReportDocumentId] = useState("");
  const [completedAt, setCompletedAt] = useState("");

  const close = () => {
    setAction(null);
    setTargetStatement(null);
  };
  const save = useMutation({
    mutationFn: async () => {
      if (action === "statement") {
        return unwrap(
          await api.schemes[":schemeId"]["financial-statements"].$post({
            param: { schemeId },
            json: { periodStart, periodEnd, accountingBasis: "special_purpose_accrual" },
          }),
        );
      }
      if (action === "special") {
        return unwrap(
          await api.schemes[":schemeId"]["special-fees"].$post({
            param: { schemeId },
            json: {
              description,
              totalCents: Math.round(Number(amount) * 100),
              fundKind: "admin",
              dueOn,
              motionId,
              allocationMethod: "liability",
            },
          }),
        );
      }
      if (action === "interest") {
        return unwrap(
          await api.schemes[":schemeId"]["interest-authorisations"].$post({
            param: { schemeId },
            json: { motionId, rateBps: Math.round(Number(rate) * 100), effectiveFrom: periodStart },
          }),
        );
      }
      if (action === "review" && targetStatement) {
        const kind = targetStatement.requiredReviewKind ?? "independent_review";
        return unwrap(
          await api.schemes[":schemeId"]["financial-statements"][":statementId"].review.$post({
            param: { schemeId, statementId: targetStatement.id },
            json: {
              kind,
              reviewerName: reviewer,
              professionalBody: kind === "audit" ? "ASIC" : "CA ANZ",
              independentDeclaration:
                "I declare that I have no direct or indirect personal or financial interest in this owners corporation.",
              outcome: "unmodified",
              reportDocumentId,
              completedAt: `${completedAt}T00:00:00.000Z`,
            },
          }),
        );
      }
      throw new Error("Choose a statutory finance action");
    },
    onSuccess: () => {
      toast.success("Statutory finance record saved");
      onChange();
      close();
    },
    onError: (error) => toast.error(error.message),
  });
  const activeInterest = interest.data?.authorisations[0];
  const disabled =
    action === "statement"
      ? !periodStart || !periodEnd
      : action === "special"
        ? !motionId || description.trim().length < 3 || Number(amount) <= 0 || !dueOn
        : action === "interest"
          ? !motionId || !periodStart || Number(rate) < 0 || Number(rate) > 10
          : action === "review"
            ? !reviewer || !reportDocumentId || !completedAt
            : true;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Statutory finance</CardTitle>
            <CardDescription>
              Annual statements, independent review, special fees and resolution-authorised
              interest.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setAction("statement")}>
              Prepare statements
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAction("special")}>
              Special fee
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAction("interest")}>
              Interest authority
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {activeInterest
            ? `${activeInterest.rateBps / 100}% p.a. authorised from ${formatDate(activeInterest.effectiveFrom)}`
            : "No active interest authority recorded — penalty interest will not accrue."}
        </p>
        {(statements.data?.statements ?? []).map((statement) => (
          <div
            key={statement.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
          >
            <div>
              <p className="text-sm font-medium">
                {formatDate(statement.periodStart)} – {formatDate(statement.periodEnd)}
              </p>
              <StatusBadge status={statement.status} />
            </div>
            {statement.requiredReviewKind && !statement.review ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setTargetStatement(statement);
                  setAction("review");
                }}
              >
                Record {statement.requiredReviewKind.replaceAll("_", " ")}
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>

      <Dialog open={action !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {action === "statement"
                ? "Prepare annual statements"
                : action === "special"
                  ? "Create special fee"
                  : action === "interest"
                    ? "Record interest authority"
                    : "Record independent report"}
            </DialogTitle>
            <DialogDescription>
              These records carry statutory consequences and preserve the authorising evidence.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {action === "statement" ? (
              <>
                <Field label="Period start">
                  <Input
                    type="date"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                  />
                </Field>
                <Field label="Period end">
                  <Input
                    type="date"
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                  />
                </Field>
              </>
            ) : null}
            {action === "special" ? (
              <>
                <Field label="Carried motion ID">
                  <Input value={motionId} onChange={(e) => setMotionId(e.target.value)} />
                </Field>
                <Field label="Purpose">
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} />
                </Field>
                <Field label="Total ($)">
                  <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
                <Field label="Due date">
                  <Input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
                </Field>
              </>
            ) : null}
            {action === "interest" ? (
              <>
                <Field label="Carried motion ID">
                  <Input value={motionId} onChange={(e) => setMotionId(e.target.value)} />
                </Field>
                <Field label="Rate (% p.a., maximum 10)">
                  <Input type="number" value={rate} onChange={(e) => setRate(e.target.value)} />
                </Field>
                <Field label="Effective from">
                  <Input
                    type="date"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                  />
                </Field>
              </>
            ) : null}
            {action === "review" ? (
              <>
                <Field label="Reviewer name">
                  <Input value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
                </Field>
                <Field label="Report document ID">
                  <Input
                    value={reportDocumentId}
                    onChange={(e) => setReportDocumentId(e.target.value)}
                  />
                </Field>
                <Field label="Completed date">
                  <Input
                    type="date"
                    value={completedAt}
                    onChange={(e) => setCompletedAt(e.target.value)}
                  />
                </Field>
              </>
            ) : null}
          </div>
          <DialogFooter>
            <Button disabled={disabled} pending={save.isPending} onClick={() => save.mutate()}>
              Save statutory record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
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

  const noticePdfButton = (n: Notice, className?: string) => (
    <PdfDownloadButton
      href={`/api/schemes/${schemeId}/documents/levy-notices/${n.id}/pdf`}
      fallbackFilename={`Levy-Notice-${n.noticeNumber}.pdf`}
      className={className}
      title={`Download levy notice ${n.noticeNumber}`}
      data-testid={`notice-pdf-${n.id}`}
    >
      PDF
    </PdfDownloadButton>
  );

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
                  {n.payid && n.status !== "paid" && (
                    <div
                      className="mt-2 truncate font-mono text-[11px] text-muted-foreground"
                      title={n.payid}
                    >
                      PayID {n.payid}
                    </div>
                  )}
                  {noticePdfButton(n, "mt-3 w-full")}
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
                    <TableCell className="font-mono text-xs">
                      {n.noticeNumber}
                      {n.payid && n.status !== "paid" && (
                        <span
                          className="block max-w-[16rem] truncate text-[11px] text-muted-foreground"
                          title={`PayID ${n.payid}`}
                        >
                          PayID {n.payid}
                        </span>
                      )}
                    </TableCell>
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
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {noticePdfButton(n)}
                        {simulateButton(n)}
                      </div>
                    </TableCell>
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

function ArrearsSection({ schemeId, isOfficer }: { schemeId: string; isOfficer: boolean }) {
  const arrears = useQuery(arrearsQuery(schemeId));
  const issueFinal = useMutation({
    mutationFn: async (lotId: string) =>
      unwrap(
        await api.schemes[":schemeId"].lots[":lotId"]["final-fee-notice"].$post({
          param: { schemeId, lotId },
          json: { serviceMethod: "email" },
        }),
      ),
    onSuccess: () => toast.success("Approved final fee notice issued and served"),
    onError: (error) => toast.error(error.message),
  });

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
                {isOfficer && a.stage >= 3 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    pending={issueFinal.isPending && issueFinal.variables === a.lotId}
                    onClick={() => issueFinal.mutate(a.lotId)}
                  >
                    Issue final notice
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
