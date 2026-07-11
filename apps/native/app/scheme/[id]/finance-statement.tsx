import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Figure,
  formatDate,
  humanise,
  ListRow,
  Screen,
  Skeleton,
  space,
  type as t,
  useTheme,
} from "../../../src/components";
import { api } from "../../../src/lib/api";
import { downloadAndShare } from "../../../src/lib/files";

interface LedgerEntry {
  id: string;
  kind: string;
  amountCents: number;
  note: string | null;
  effectiveOn: string;
}

export default function LotStatement() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string; lotId?: string; lotNumber?: string }>();
  const schemeId = String(params.id ?? "");
  const lotId = String(params.lotId ?? "");
  const lotNumber = String(params.lotNumber ?? "");
  const statement = useQuery({
    queryKey: ["scheme", schemeId, "lot-statement", lotId],
    queryFn: () =>
      api<{ entries: LedgerEntry[]; balanceCents: number }>(
        `/api/schemes/${schemeId}/lots/${lotId}/statement`,
      ),
    enabled: !!schemeId && !!lotId,
  });

  let running = 0;
  const rows = (statement.data?.entries ?? []).map((entry) => {
    running += entry.amountCents;
    return { ...entry, balanceCents: running };
  });

  return (
    <Screen
      title={lotNumber ? `Lot ${lotNumber} statement` : "Lot statement"}
      topInset={false}
      refreshing={statement.isRefetching}
      onRefresh={() => statement.refetch()}
    >
      {statement.isPending ? (
        <Card>
          <Skeleton width="70%" height={20} />
          <View style={{ marginTop: space(3) }}>
            <Skeleton width="45%" height={14} />
          </View>
        </Card>
      ) : statement.isError && !statement.data ? (
        <ErrorState onRetry={() => statement.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon="receipt-outline" title="No ledger entries yet" />
      ) : (
        <>
          <Card>
            <Text style={[t.label, { color: theme.muted }]}>Outstanding balance</Text>
            <View style={{ marginTop: space(1) }}>
              <Figure
                cents={statement.data?.balanceCents ?? 0}
                size="hero"
                tone={(statement.data?.balanceCents ?? 0) > 0 ? "crit" : "default"}
              />
            </View>
          </Card>
          <Card style={{ marginTop: space(4) }}>
            {rows.map((entry, index) => (
              <ListRow
                key={entry.id}
                title={humanise(entry.kind)}
                subtitle={[formatDate(entry.effectiveOn), entry.note].filter(Boolean).join(" · ")}
                right={
                  <View style={{ alignItems: "flex-end" }}>
                    <Figure cents={entry.amountCents} size="small" signed />
                    <Text style={[t.figureSmall, { color: theme.muted }]}>
                      {formatRunning(entry.balanceCents)}
                    </Text>
                  </View>
                }
                divider={index < rows.length - 1}
              />
            ))}
          </Card>
          <View style={{ marginTop: space(4) }}>
            <Button
              variant="secondary"
              full
              label="Open PDF statement"
              onPress={() =>
                void downloadAndShare(
                  `/api/schemes/${schemeId}/documents/lots/${lotId}/statement.pdf`,
                  `Statement-Lot-${lotNumber || lotId}.pdf`,
                )
              }
            />
          </View>
        </>
      )}
    </Screen>
  );
}

function formatRunning(cents: number): string {
  const sign = cents < 0 ? "credit " : "balance ";
  return `${sign}${Math.abs(cents / 100).toLocaleString("en-AU", {
    style: "currency",
    currency: "AUD",
  })}`;
}
