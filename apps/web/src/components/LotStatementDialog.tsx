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
import { dollars, formatDate } from "@/lib/format";
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
  const { data, error } = useQuery({
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
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Lot {lotNumber} statement</DialogTitle>
          <DialogDescription>
            Every levy charge, payment and interest accrual on this lot.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error.message}</p>}
        {!data && !error && <Skeleton className="h-32" />}
        {data && rows.length === 0 && (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No ledger entries yet — levies will appear here when issued.
          </p>
        )}
        {data && rows.length > 0 && (
          <div className="-mx-2 overflow-x-auto px-2">
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
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        e.amountCents < 0 && "text-green-700",
                      )}
                    >
                      {e.amountCents < 0 ? `−${dollars(-e.amountCents)}` : dollars(e.amountCents)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {dollars(e.balanceCents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-3 flex items-center justify-between border-t pt-3 text-sm font-medium">
              <span>Outstanding balance</span>
              <span className={cn("tabular-nums", data.balanceCents > 0 && "text-red-700")}>
                {dollars(data.balanceCents)}
              </span>
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
