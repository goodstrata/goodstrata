import { useQuery } from "@tanstack/react-query";
import { ReceiptText } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { formatMoney } from "@/components/ui/money";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, unwrap } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface LedgerEntry {
  id: string;
  kind: string;
  amountCents: number;
  note: string | null;
  effectiveOn: string;
}

const KIND_LABELS: Record<string, string> = {
  levy_charge: "Levy charge",
  payment: "Payment",
  interest: "Interest",
  adjustment: "Adjustment",
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
}

/**
 * Per-lot ledger: every charge, payment and interest accrual with a running
 * balance. Opened from the lots table and the arrears panel.
 */
export function LotStatementDialog({
  schemeId,
  lotId,
  lotNumber,
  triggerVariant = "outline",
  triggerClassName,
}: {
  schemeId: string;
  lotId: string;
  lotNumber: string;
  triggerVariant?: "outline" | "ghost";
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data, error, refetch } = useQuery({
    queryKey: ["lot-statement", schemeId, lotId],
    enabled: open,
    queryFn: async () =>
      unwrap<{ entries: LedgerEntry[]; balanceCents: number }>(
        await api.schemes[":schemeId"].lots[":lotId"].statement.$get({
          param: { schemeId, lotId },
        }),
      ),
  });

  // Running balance per row (entries arrive oldest-first).
  let running = 0;
  const rows = (data?.entries ?? []).map((e) => {
    running += e.amountCents;
    return { ...e, balanceCents: running };
  });

  const balanceTone =
    data && data.balanceCents > 0
      ? "text-critical"
      : data && data.balanceCents < 0
        ? "text-positive"
        : "text-muted-foreground";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={triggerVariant}
          size="sm"
          className={triggerClassName}
          data-testid={`statement-lot-${lotNumber}`}
        >
          <ReceiptText className="size-4" /> Statement
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Lot {lotNumber} statement</DialogTitle>
          <DialogDescription>
            Every levy charge, payment and interest accrual on this lot.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <ErrorState message="We couldn't load this statement." onRetry={() => void refetch()} />
        )}
        {!data && !error && <Skeleton className="h-32" />}
        {data && rows.length === 0 && (
          <EmptyState
            icon={ReceiptText}
            title="No ledger entries yet"
            description="Levies, payments and interest will appear here once they're issued."
          />
        )}
        {data && rows.length > 0 && (
          <div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(e.effectiveOn)}
                    </TableCell>
                    <TableCell>
                      {kindLabel(e.kind)}
                      {e.note && (
                        <span className="block text-xs text-muted-foreground">{e.note}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {/* A payment is a negative charge — show it as a credit, not an alarm. */}
                      <span className={cn(e.amountCents < 0 && "text-positive")}>
                        {formatMoney(e.amountCents)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-right font-mono tabular-nums sm:table-cell">
                      <span
                        className={cn(
                          e.balanceCents > 0 && "text-critical",
                          e.balanceCents < 0 && "text-positive",
                        )}
                      >
                        {formatMoney(e.balanceCents)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-3 flex items-center justify-between border-t pt-3 text-sm font-medium">
              <span>Outstanding balance</span>
              <span className={cn("font-mono tabular-nums", balanceTone)}>
                {formatMoney(data.balanceCents)}
              </span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
