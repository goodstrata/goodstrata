import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormField,
  humanise,
  plate,
  Screen,
  SectionHeader,
  Skeleton,
  StatusPill,
  space,
  type as t,
  useTheme,
} from "../../../src/components";
import { ApiError, api, apiPost } from "../../../src/lib/api";
import { schemeQueryOptions, useIsOfficer } from "../../../src/lib/roles";

interface LotOwner {
  personId: string;
  givenName: string | null;
  familyName: string | null;
  email: string | null;
}

interface LotRow {
  id: string;
  lotNumber: string;
  unitNumber: string | null;
  lotType: string;
  entitlement: number;
  liability: number;
  owners: LotOwner[];
}

interface ImportResult {
  imported: number;
  ownersCreated: number;
  errors: { line: number; message: string }[];
}

const SAMPLE_CSV = `lot_number,entitlement,liability,lot_type,owner_name,owner_email
1,20,20,residential,Alex Owner,alex@example.com
2,10,10,commercial,Sam Shopkeeper,sam@example.com`;

function ownerNames(lot: LotRow): string {
  const names = lot.owners
    .map((owner) => {
      const fullName = `${owner.givenName ?? ""} ${owner.familyName ?? ""}`.trim();
      return fullName || owner.email;
    })
    .filter((name): name is string => !!name);
  return names.length > 0 ? names.join(", ") : "No owner recorded";
}

function importLineErrors(error: unknown): { line: number; message: string }[] {
  if (!(error instanceof ApiError) || typeof error.details !== "object" || !error.details)
    return [];
  const errors = (error.details as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];
  return errors.filter(
    (entry): entry is { line: number; message: string } =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { line?: unknown }).line === "number" &&
      typeof (entry as { message?: unknown }).message === "string",
  );
}

export default function LotsScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const schemeId = String(params.id ?? "");
  const router = useRouter();
  const isOfficer = useIsOfficer(schemeId);
  const queryClient = useQueryClient();
  const theme = useTheme();
  const [csv, setCsv] = useState("");
  const [lastImport, setLastImport] = useState<ImportResult | null>(null);

  const schemeQuery = useQuery({ ...schemeQueryOptions(schemeId), enabled: !!schemeId });
  const lotsQuery = useQuery({
    queryKey: ["scheme", schemeId, "lots"],
    queryFn: () => api<{ lots: LotRow[] }>(`/api/schemes/${schemeId}/lots`),
    enabled: !!schemeId,
  });

  const importLots = useMutation({
    mutationFn: (value: string) =>
      apiPost<ImportResult>(`/api/schemes/${schemeId}/lots/import`, { csv: value }),
    onMutate: () => setLastImport(null),
    onSuccess: (result) => {
      setLastImport(result);
      setCsv("");
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "lots"] }),
        queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "people"] }),
        queryClient.invalidateQueries({ queryKey: ["scheme", schemeId] }),
        queryClient.invalidateQueries({ queryKey: ["overview", schemeId] }),
      ]);
    },
  });

  const lots = useMemo(
    () =>
      [...(lotsQuery.data?.lots ?? [])].sort((a, b) =>
        a.lotNumber.localeCompare(b.lotNumber, undefined, { numeric: true }),
      ),
    [lotsQuery.data?.lots],
  );
  const totals = useMemo(
    () =>
      lots.reduce(
        (sum, lot) => ({
          entitlement: sum.entitlement + lot.entitlement,
          liability: sum.liability + lot.liability,
        }),
        { entitlement: 0, liability: 0 },
      ),
    [lots],
  );

  const lineErrors = importLineErrors(importLots.error);

  return (
    <Screen
      title="Lots"
      topInset={false}
      eyebrow={plate(schemeQuery.data?.scheme)}
      reserveEyebrow
      refreshing={lotsQuery.isRefetching}
      onRefresh={() => lotsQuery.refetch()}
    >
      <SectionHeader label="Lot register" />
      {lotsQuery.isPending ? (
        <LotsSkeleton />
      ) : lotsQuery.isError && !lotsQuery.data ? (
        <ErrorState
          detail={
            lotsQuery.error instanceof Error
              ? lotsQuery.error.message
              : "The lot register could not be loaded."
          }
          onRetry={() => lotsQuery.refetch()}
        />
      ) : lots.length === 0 ? (
        <Card>
          <EmptyState
            icon="layers-outline"
            title="No lots yet"
            body={
              isOfficer
                ? "Import the plan of subdivision below to create the register."
                : "An office holder will import the plan of subdivision."
            }
          />
        </Card>
      ) : (
        <>
          <Card padded={false} style={{ paddingHorizontal: space(4) }}>
            {lots.map((lot, index) => (
              <LotRegisterRow
                key={lot.id}
                lot={lot}
                divider={index < lots.length - 1}
                onOpenStatement={() =>
                  router.push({
                    pathname: `/scheme/${schemeId}/finance-statement`,
                    params: { lotId: lot.id, lotNumber: lot.lotNumber },
                  })
                }
              />
            ))}
          </Card>
          <Card style={{ marginTop: space(3) }}>
            <View style={{ flexDirection: "row", gap: space(4) }}>
              <RegisterFigure label={lots.length === 1 ? "Lot" : "Lots"} value={lots.length} />
              <RegisterFigure label="Entitlements" value={totals.entitlement} />
              <RegisterFigure label="Liabilities" value={totals.liability} />
            </View>
          </Card>
        </>
      )}

      {isOfficer ? (
        <>
          <SectionHeader label="Officer tools" />
          <Card>
            <Text style={{ ...t.title, color: theme.text }}>Import lots</Text>
            <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: space(1) }}>
              Paste CSV with lot_number, entitlement and liability. Optional columns are lot_type,
              unit_number, owner_name and owner_email.
            </Text>
            <View style={{ marginTop: space(4) }}>
              <FormField
                label="Lot CSV"
                multiline
                numberOfLines={8}
                value={csv}
                onChangeText={setCsv}
                placeholder={SAMPLE_CSV}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                editable={!importLots.isPending}
                accessibilityLabel="Paste lot CSV"
              />
            </View>
            <Text style={{ ...t.caption, color: theme.muted, marginTop: space(2) }}>
              Each row adds a new lot. Owners are created when a name or email is supplied.
            </Text>

            {importLots.error ? (
              <View style={{ marginTop: space(3), gap: space(1) }}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(2) }}>
                  <Ionicons name="alert-circle-outline" size={18} color={theme.crit} />
                  <Text style={{ ...t.bodySmall, color: theme.crit, flex: 1 }}>
                    {importLots.error instanceof Error
                      ? importLots.error.message
                      : "The CSV could not be imported."}
                  </Text>
                </View>
                {lineErrors.map((error) => (
                  <Text
                    key={`${error.line}-${error.message}`}
                    style={{ ...t.caption, color: theme.crit, marginLeft: space(6) }}
                  >
                    Line {error.line}: {error.message}
                  </Text>
                ))}
              </View>
            ) : null}

            {lastImport ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: space(2),
                  marginTop: space(3),
                }}
              >
                <StatusPill tone="ok" label={`${lastImport.imported} imported`} />
                <Text style={{ ...t.caption, color: theme.muted }}>
                  {lastImport.ownersCreated} owner
                  {lastImport.ownersCreated === 1 ? "" : "s"} created
                </Text>
              </View>
            ) : null}

            <View style={{ marginTop: space(4) }}>
              <Button
                label="Import lots"
                onPress={() => importLots.mutate(csv.trim())}
                pending={importLots.isPending}
                disabled={!csv.trim()}
              />
            </View>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function LotRegisterRow({
  lot,
  divider,
  onOpenStatement,
}: {
  lot: LotRow;
  divider: boolean;
  onOpenStatement: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingVertical: space(4),
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: theme.line,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(3) }}>
        <View style={{ flex: 1 }}>
          <Text style={{ ...t.figureSmall, color: theme.text }}>Lot {lot.lotNumber}</Text>
          {lot.unitNumber ? (
            <Text style={{ ...t.caption, color: theme.muted, marginTop: 1 }}>
              Unit {lot.unitNumber}
            </Text>
          ) : null}
        </View>
        <StatusPill tone="neutral" label={humanise(lot.lotType)} />
      </View>

      <View style={{ flexDirection: "row", gap: space(4), marginTop: space(3) }}>
        <RegisterFigure label="Entitlement" value={lot.entitlement} />
        <RegisterFigure label="Liability" value={lot.liability} />
      </View>
      <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: space(3) }}>
        {ownerNames(lot)}
      </Text>
      <View style={{ alignItems: "flex-start", marginTop: space(3) }}>
        <Button variant="secondary" label="Open lot statement" onPress={onOpenStatement} />
      </View>
    </View>
  );
}

function RegisterFigure({ label, value }: { label: string; value: number }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ ...t.eyebrow, color: theme.muted }}>{label}</Text>
      <Text style={{ ...t.figureSmall, color: theme.text, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

function LotsSkeleton() {
  return (
    <Card padded={false} style={{ paddingHorizontal: space(4) }}>
      {[0, 1, 2].map((index) => (
        <View key={index} style={{ paddingVertical: space(4), gap: space(3) }}>
          <Skeleton width={index % 2 === 0 ? "38%" : "46%"} height={18} />
          <Skeleton width="72%" height={14} />
        </View>
      ))}
    </Card>
  );
}
