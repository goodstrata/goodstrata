import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Layers } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { LotStatementDialog } from "@/components/LotStatementDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api, unwrap } from "@/lib/api";
import { useIsOfficer } from "@/lib/roles";
import { useIsMobile } from "@/lib/use-mobile";

interface LotRow {
  id: string;
  lotNumber: string;
  unitNumber: string | null;
  lotType: string;
  entitlement: number;
  liability: number;
  owners: {
    personId: string;
    givenName: string | null;
    familyName: string | null;
    email: string | null;
  }[];
}

const SAMPLE_CSV = `lot_number,entitlement,liability,lot_type,owner_name,owner_email
1,20,20,commercial,Sam Shopkeeper,sam@example.com
2,10,10,residential,Alex Owner,alex@example.com`;

function ownerNames(lot: LotRow): string {
  return (
    lot.owners
      .map((o) => `${o.givenName ?? ""} ${o.familyName ?? ""}`.trim() || o.email)
      .join(", ") || "—"
  );
}

export function LotsSection({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const isOfficer = useIsOfficer(schemeId);
  const isMobile = useIsMobile();
  const { data, isError, error, refetch } = useQuery({
    queryKey: ["lots", schemeId],
    queryFn: async () =>
      unwrap<{ lots: LotRow[] }>(await api.schemes[":schemeId"].lots.$get({ param: { schemeId } })),
  });
  const [csv, setCsv] = useState("");
  const importMutation = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.schemes[":schemeId"].lots.import.$post({ param: { schemeId }, json: { csv } }),
      ),
    onSuccess: () => {
      setCsv("");
      toast.success("Lots imported");
      void queryClient.invalidateQueries({ queryKey: ["lots", schemeId] });
      void queryClient.invalidateQueries({ queryKey: ["people", schemeId] });
      void queryClient.invalidateQueries({ queryKey: ["onboarding", schemeId] });
      void queryClient.invalidateQueries({ queryKey: ["overview", schemeId] });
      void queryClient.invalidateQueries({ queryKey: ["scheme", schemeId] });
    },
  });

  const lots = useMemo(
    () =>
      [...(data?.lots ?? [])].sort((a, b) =>
        a.lotNumber.localeCompare(b.lotNumber, undefined, { numeric: true }),
      ),
    [data],
  );

  return (
    <div className="space-y-6">
      {isError ? (
        <ErrorState
          message={error instanceof Error ? error.message : "Couldn't load the lot register."}
          onRetry={() => void refetch()}
        />
      ) : !data ? (
        <Skeleton className="h-40" />
      ) : lots.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No lots yet"
          description={
            isOfficer
              ? "Import the plan of subdivision below to create the lot register."
              : "An office holder will import the plan of subdivision."
          }
        />
      ) : isMobile ? (
        <ul className="space-y-3">
          {lots.map((lot) => (
            <li key={lot.id} className="rounded-lg border bg-card p-4 shadow-xs">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-medium">Lot {lot.lotNumber}</p>
                  <p className="text-sm text-muted-foreground capitalize">{lot.lotType}</p>
                </div>
                <LotStatementDialog
                  schemeId={schemeId}
                  lotId={lot.id}
                  lotNumber={lot.lotNumber}
                  triggerVariant="outline"
                />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="eyebrow text-muted-foreground">Entitlement</dt>
                  <dd className="mt-0.5 font-mono tabular-nums">{lot.entitlement}</dd>
                </div>
                <div>
                  <dt className="eyebrow text-muted-foreground">Liability</dt>
                  <dd className="mt-0.5 font-mono tabular-nums">{lot.liability}</dd>
                </div>
              </dl>
              <p className="mt-3 truncate text-sm text-muted-foreground">{ownerNames(lot)}</p>
            </li>
          ))}
        </ul>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lot</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Entitlement</TableHead>
                <TableHead className="text-right">Liability</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lots.map((lot) => (
                <TableRow key={lot.id}>
                  <TableCell className="font-mono font-medium">{lot.lotNumber}</TableCell>
                  <TableCell className="capitalize">{lot.lotType}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {lot.entitlement}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {lot.liability}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{ownerNames(lot)}</TableCell>
                  <TableCell className="text-right">
                    <LotStatementDialog
                      schemeId={schemeId}
                      lotId={lot.id}
                      lotNumber={lot.lotNumber}
                      triggerVariant="ghost"
                      triggerClassName="text-muted-foreground"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {isOfficer && (
        <Card>
          <CardHeader>
            <CardTitle>Import lots (CSV)</CardTitle>
            <CardDescription>
              Columns: lot_number, entitlement, liability[, lot_type, unit_number, owner_name,
              owner_email]
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              data-testid="csv-input"
              aria-label="Paste lot CSV"
              className="h-36 font-mono text-xs"
              placeholder={SAMPLE_CSV}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
            />
            <p className="mt-2 text-[13px] text-muted-foreground">
              Owners are created from owner_name and owner_email when present; existing lots are
              matched by lot number.
            </p>
            {importMutation.error && (
              <p className="mt-2 flex items-start gap-1.5 text-[13px] text-critical">
                <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>{importMutation.error.message}</span>
              </p>
            )}
            <Button
              className="mt-4"
              disabled={!csv || importMutation.isPending}
              pending={importMutation.isPending}
              onClick={() => importMutation.mutate()}
            >
              Import lots
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
