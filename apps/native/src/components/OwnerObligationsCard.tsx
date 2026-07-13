import { useQueries, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { summarizeOwnerObligations } from "../lib/ownerFinance";
import { space, type as t } from "../theme/tokens";
import { useTheme } from "../theme/useTheme";
import { Card } from "./ui/Card";
import { EmptyState } from "./ui/EmptyState";
import { ErrorState } from "./ui/ErrorState";
import { Figure } from "./ui/Figure";
import { ListRow } from "./ui/ListRow";
import { Skeleton } from "./ui/Skeleton";

interface OwnerLot {
  id: string;
  lotNumber: string;
  unitNumber: string | null;
}

interface OwnerStatement {
  balanceCents: number;
}

/** Personal lot balances only; never renders a partial or scheme-wide total. */
export function OwnerObligationsCard({
  schemeId,
  separated = false,
}: {
  schemeId: string;
  /** Add space when the card follows another card on the same screen. */
  separated?: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  const lotsQuery = useQuery({
    queryKey: ["scheme", schemeId, "lots", "mine"],
    queryFn: () => api<{ lots: OwnerLot[] }>(`/api/schemes/${schemeId}/lots/mine`),
    enabled: !!schemeId,
  });
  const myLots = lotsQuery.data?.lots ?? [];
  const statements = useQueries({
    queries: myLots.map((lot) => ({
      queryKey: ["scheme", schemeId, "lot-statement", lot.id] as const,
      queryFn: () => api<OwnerStatement>(`/api/schemes/${schemeId}/lots/${lot.id}/statement`),
      enabled: !!schemeId,
    })),
  });

  const statementFailed = statements.some((statement) => statement.isError);
  const failed = lotsQuery.isError || statementFailed;
  const loading = lotsQuery.isPending || statements.some((statement) => statement.isPending);
  const summary = summarizeOwnerObligations(
    statements.flatMap((statement) => (statement.data ? [statement.data.balanceCents] : [])),
  );
  const retry = () => {
    void Promise.all([lotsQuery.refetch(), ...statements.map((statement) => statement.refetch())]);
  };

  return (
    <Card style={separated ? { marginTop: space(3) } : undefined}>
      <Text style={[t.title, { color: theme.text }]}>My levies</Text>
      {failed ? (
        <ErrorState
          title="Couldn't load your levy balance"
          detail={
            statementFailed
              ? "One or more lot statements didn't load, so no total is shown."
              : "Your linked lots didn't load, so no balance is shown."
          }
          onRetry={retry}
        />
      ) : loading ? (
        <View style={{ marginTop: space(4), gap: space(3) }}>
          <Skeleton width="55%" height={40} radius={8} />
          <Skeleton width="100%" height={48} />
        </View>
      ) : myLots.length === 0 ? (
        <EmptyState
          icon="receipt-outline"
          title="No lot linked to your account yet"
          body="Once your lot is on the register, your levy balance will show here."
        />
      ) : (
        <>
          <View style={{ marginTop: space(3) }}>
            <Figure
              cents={summary.amountDueCents}
              size="hero"
              tone={summary.amountDueCents > 0 ? "crit" : "ok"}
            />
            <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(1) }]}>
              {summary.amountDueCents > 0
                ? "Amount due across your linked lots"
                : summary.lotsInCredit > 0
                  ? "Nothing due — one or more lots are in credit."
                  : "You're all paid up. Nothing due right now."}
            </Text>
          </View>
          <View
            style={{
              marginTop: space(4),
              paddingTop: space(1),
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: theme.line,
            }}
          >
            {myLots.map((lot, index) => {
              const balance = statements[index]?.data?.balanceCents ?? 0;
              return (
                <ListRow
                  key={lot.id}
                  title={`Lot ${lot.lotNumber}`}
                  subtitle={
                    lot.unitNumber ? `Unit ${lot.unitNumber} · Open statement` : "Open statement"
                  }
                  right={<Figure cents={balance} size="small" tone={balance > 0 ? "crit" : "ok"} />}
                  onPress={() =>
                    router.push({
                      pathname: "/scheme/[id]/finance-statement",
                      params: { id: schemeId, lotId: lot.id, lotNumber: lot.lotNumber },
                    })
                  }
                  divider={index < myLots.length - 1}
                />
              );
            })}
          </View>
        </>
      )}
    </Card>
  );
}
