import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, Landmark, Lock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { formatMoney, Money } from "@/components/ui/money";
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
import { ApiError, api, unwrap } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useIsOfficer } from "@/lib/roles";

interface StatementLine {
  date: string;
  kind: string;
  description: string;
  amountCents: number;
  balanceCents: number;
}
interface TrustStatement {
  schemeId: string;
  schemeName: string;
  bankAccountId: string | null;
  bankAccountStatus: string | null;
  period: { from: string | null; to: string | null };
  openingBalanceCents: number;
  receiptsCents: number;
  paymentsCents: number;
  closingBalanceCents: number;
  bankBalanceCents: number;
  reconciled: boolean;
  varianceCents: number;
  lines: StatementLine[];
  generatedAt: string;
}

const statementQuery = (schemeId: string) => ({
  queryKey: ["trust-statement", schemeId] as const,
  queryFn: async () =>
    unwrap<{ statement: TrustStatement }>(
      await api.schemes[":schemeId"].trust.statement.$get({ param: { schemeId }, query: {} }),
    ),
});

/**
 * Per-OC trust account view (OC Act s 122): the reconciled statement for the
 * scheme's own trust account, with a variance flag and an auditor CSV export.
 */
export function TrustAccountView({ schemeId }: { schemeId: string }) {
  const isOfficer = useIsOfficer(schemeId);
  const statement = useQuery({ ...statementQuery(schemeId), enabled: isOfficer });

  if (!isOfficer) {
    return (
      <Card>
        <CardContent className="py-10">
          <EmptyState
            icon={Lock}
            title="Officers only"
            description="Trust-account reconciliation and the audit export are restricted to scheme officers and the manager."
          />
        </CardContent>
      </Card>
    );
  }

  if (statement.isPending) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {["closing", "bank", "receipts", "variance"].map((k) => (
            <Skeleton key={k} className="h-[4.75rem] rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  if (statement.isError) {
    const err = statement.error;
    const forbidden = err instanceof ApiError && err.status === 403;
    return (
      <ErrorState
        message={
          forbidden
            ? "You don't have access to this scheme's trust account."
            : "We couldn't load the trust statement."
        }
        onRetry={forbidden ? undefined : () => void statement.refetch()}
      />
    );
  }

  const s = statement.data.statement;

  return (
    <div className="space-y-6">
      <ReconciliationBanner statement={s} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Closing balance"
          value={formatMoney(s.closingBalanceCents)}
          hint="Per the fund ledger"
        />
        <StatCard
          label="Bank balance"
          value={formatMoney(s.bankBalanceCents)}
          hint="Cash through the account"
        />
        <StatCard label="Receipts" value={formatMoney(s.receiptsCents)} hint="Money in (period)" />
        <StatCard
          label="Variance"
          value={formatMoney(s.varianceCents)}
          tone={s.reconciled ? "positive" : "critical"}
          hint={s.reconciled ? "Reconciled" : "Needs review"}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <CardTitle className="flex items-center gap-2">
                <Landmark className="size-4" aria-hidden="true" /> Trust account
              </CardTitle>
              <CardDescription>
                {s.bankAccountId ? (
                  <>
                    Account <span className="font-mono text-xs">{s.bankAccountId}</span>
                    {s.bankAccountStatus ? (
                      <>
                        {" · "}
                        <StatusBadge status={s.bankAccountStatus} />
                      </>
                    ) : null}
                  </>
                ) : (
                  "No segregated trust account is provisioned for this scheme yet."
                )}
              </CardDescription>
            </div>
            <DownloadAuditButton schemeId={schemeId} />
          </div>
        </CardHeader>
        <CardContent>
          <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Opening</dt>
              <dd>
                <Money cents={s.openingBalanceCents} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Receipts</dt>
              <dd>
                <Money cents={s.receiptsCents} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Payments</dt>
              <dd>
                <Money cents={s.paymentsCents} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Closing</dt>
              <dd>
                <Money cents={s.closingBalanceCents} />
              </dd>
            </div>
          </dl>

          {s.lines.length === 0 ? (
            <EmptyState
              icon={Landmark}
              title="No trust movements"
              description="This scheme's trust account has no ledger movements for the selected period."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Movement</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.lines.map((line, i) => (
                  <TableRow key={`${line.date}-${i}`}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(line.date)}
                    </TableCell>
                    <TableCell className="capitalize">{line.description}</TableCell>
                    <TableCell className="text-right">
                      <Money cents={line.amountCents} signed />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money cents={line.balanceCents} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ReconciliationBanner({ statement }: { statement: TrustStatement }) {
  if (statement.reconciled) {
    return (
      <Card
        role="region"
        aria-label="Reconciliation status"
        className="border-positive/25 bg-positive/8"
      >
        <CardContent className="flex items-center gap-3 py-4">
          <CheckCircle2 className="size-5 shrink-0 text-positive" aria-hidden="true" />
          <p className="text-sm">
            <span className="font-medium text-positive">Reconciled.</span> The fund ledger matches
            the cash held in this OC's trust account.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card
      role="region"
      aria-label="Reconciliation status"
      className="border-critical/25 bg-critical/8"
    >
      <CardContent className="flex items-center gap-3 py-4">
        <AlertTriangle className="size-5 shrink-0 text-critical" aria-hidden="true" />
        <p className="text-sm">
          <span className="font-medium text-critical">
            Variance of {formatMoney(statement.varianceCents)}.
          </span>{" "}
          The bank balance differs from the fund ledger — review before certifying the audit.
        </p>
      </CardContent>
    </Card>
  );
}

function DownloadAuditButton({ schemeId }: { schemeId: string }) {
  const [pending, setPending] = useState(false);

  const download = async () => {
    setPending(true);
    try {
      const res = await fetch(`/api/schemes/${schemeId}/trust/audit-export`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] ?? `trust-audit-${schemeId}.csv`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <Button size="sm" variant="outline" pending={pending} onClick={() => void download()}>
      <Download className="size-4" /> Audit export (CSV)
    </Button>
  );
}
