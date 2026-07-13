import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormField,
  PressableScale,
  Screen,
  SectionHeader,
  Skeleton,
  StatusPill,
  space,
  type as t,
  useTheme,
} from "../../../src/components";
import { api, apiPost } from "../../../src/lib/api";

interface RegisterLot {
  id: string;
  lotNumber: string;
  liability: number;
  entitlement: number;
  owners: { personId: string; name: string }[];
}

interface RegisterResponse {
  register: {
    preparedAt: string;
    scheme: { name: string; planOfSubdivision: string; address: string };
    manager: { name: string; registrationNumber: string | null } | null;
    lots: RegisterLot[];
    rulesAmendments: { id: string; title: string }[];
    contracts: { id: string; title: string; kind: string }[];
    insurancePolicies: { id: string; insurer: string; kind: string; periodEnd: string }[];
  };
}

const STANDARD_CERTIFICATE_FEE_CENTS = Math.round(9.64 * 1727);

export default function RecordsScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const schemeId = typeof params.id === "string" ? params.id : "";
  const [search, setSearch] = useState("");
  const [selectedLotId, setSelectedLotId] = useState("");
  const [applicantName, setApplicantName] = useState("");
  const [applicantEmail, setApplicantEmail] = useState("");
  const [inspectionName, setInspectionName] = useState("");

  const registerQuery = useQuery({
    queryKey: ["scheme", schemeId, "oc-register"],
    queryFn: () => api<RegisterResponse>(`/api/schemes/${schemeId}/records/register`),
    enabled: !!schemeId,
  });
  const register = registerQuery.data?.register;
  const selectedLot = register?.lots.find((lot) => lot.id === selectedLotId);
  const filteredLots = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return register?.lots ?? [];
    return (register?.lots ?? []).filter(
      (lot) =>
        lot.lotNumber.toLocaleLowerCase().includes(needle) ||
        lot.owners.some((owner) => owner.name.toLocaleLowerCase().includes(needle)),
    );
  }, [register?.lots, search]);

  const certificate = useMutation({
    mutationFn: () =>
      apiPost(`/api/schemes/${schemeId}/records/certificates`, {
        lotId: selectedLotId,
        applicantName: applicantName.trim(),
        applicantEmail: applicantEmail.trim() || undefined,
        urgency: "standard_6_10_days",
        additionalCertificate: false,
        quotedFeeCents: STANDARD_CERTIFICATE_FEE_CENTS,
      }),
    onSuccess: () => {
      setApplicantName("");
      setApplicantEmail("");
      Alert.alert(
        "Request lodged",
        "The statutory service clock starts when the written request fee is received.",
      );
    },
    onError: (error) => Alert.alert("Couldn't lodge certificate request", error.message),
  });

  const inspection = useMutation({
    mutationFn: () =>
      apiPost(`/api/schemes/${schemeId}/records/inspections`, {
        requesterType: "lot_owner",
        requesterName: inspectionName.trim(),
        scope: "both",
        requestedDocumentIds: [],
        wantsCopies: false,
        commercialPurpose: false,
        quotedCopyFeeCents: 0,
      }),
    onSuccess: () => {
      setInspectionName("");
      Alert.alert(
        "Inspection requested",
        "Inspection of the register and records is free. The owners corporation will arrange supervised access.",
      );
    },
    onError: (error) => Alert.alert("Couldn't lodge inspection request", error.message),
  });

  return (
    <Screen
      title="OC records"
      topInset={false}
      eyebrow={register?.scheme.planOfSubdivision}
      reserveEyebrow
      onRefresh={() => registerQuery.refetch()}
    >
      {registerQuery.isError && !register ? (
        <ErrorState onRetry={() => registerQuery.refetch()} />
      ) : !register ? (
        <>
          <Skeleton width="70%" height={18} />
          <View style={{ marginTop: space(4) }}>
            <Skeleton width="100%" height={180} radius={12} />
          </View>
        </>
      ) : (
        <>
          <Card>
            <Text style={[t.label, { color: theme.muted }]}>Statutory register</Text>
            <Text style={[t.title, { color: theme.text, marginTop: space(1) }]}>
              {register.scheme.name}
            </Text>
            <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(1) }]}>
              {register.scheme.address}
            </Text>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: space(2),
                marginTop: space(3),
              }}
            >
              <StatusPill tone="neutral" label={`${register.lots.length} lots`} />
              <StatusPill
                tone={register.manager ? "info" : "neutral"}
                label={register.manager ? "Managed" : "Self managed"}
              />
              <StatusPill tone="neutral" label={`${register.insurancePolicies.length} policies`} />
            </View>
            {register.manager ? (
              <Text style={[t.caption, { color: theme.muted, marginTop: space(3) }]}>
                Manager: {register.manager.name}
                {register.manager.registrationNumber
                  ? ` · ${register.manager.registrationNumber}`
                  : ""}
              </Text>
            ) : null}
          </Card>

          <SectionHeader label="Search membership" />
          <FormField
            label="Lot or owner"
            value={search}
            onChangeText={setSearch}
            placeholder="Search the register"
            autoCapitalize="words"
            returnKeyType="search"
          />
          <View style={{ marginTop: space(3), gap: space(2) }}>
            {filteredLots.length === 0 ? (
              <EmptyState
                icon="search-outline"
                title="No matching lots"
                body="Try a lot number or owner name."
              />
            ) : (
              filteredLots.map((lot) => (
                <PressableScale
                  key={lot.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: lot.id === selectedLotId }}
                  accessibilityLabel={`Lot ${lot.lotNumber}, ${lot.owners.map((owner) => owner.name).join(", ")}`}
                  onPress={() => setSelectedLotId(lot.id)}
                >
                  <Card
                    style={
                      lot.id === selectedLotId
                        ? { borderColor: theme.accent, backgroundColor: theme.accentSoft }
                        : undefined
                    }
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: space(3),
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[t.body, { color: theme.text }]}>Lot {lot.lotNumber}</Text>
                        <Text style={[t.caption, { color: theme.muted, marginTop: space(1) }]}>
                          {lot.owners.map((owner) => owner.name).join(", ") || "No owner recorded"}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={[t.caption, { color: theme.muted }]}>
                          LE {lot.entitlement}
                        </Text>
                        <Text style={[t.caption, { color: theme.muted }]}>LL {lot.liability}</Text>
                      </View>
                    </View>
                  </Card>
                </PressableScale>
              ))
            )}
          </View>

          <SectionHeader label="Certificate request" />
          <Card>
            <View style={{ gap: space(3) }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                <Ionicons name="ribbon-outline" size={20} color={theme.accent} />
                <Text style={[t.body, { color: theme.text }]}>
                  {selectedLot ? `Lot ${selectedLot.lotNumber}` : "Select a lot above"}
                </Text>
              </View>
              <FormField
                label="Applicant name"
                value={applicantName}
                onChangeText={setApplicantName}
                autoCapitalize="words"
              />
              <FormField
                label="Applicant email"
                value={applicantEmail}
                onChangeText={setApplicantEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <Text style={[t.caption, { color: theme.muted }]}>
                Standard 6–10 business day maximum fee: $
                {(STANDARD_CERTIFICATE_FEE_CENTS / 100).toFixed(2)} ex GST (2026–27).
              </Text>
              <Button
                label="Lodge certificate request"
                full
                pending={certificate.isPending}
                disabled={!selectedLotId || !applicantName.trim()}
                onPress={() => certificate.mutate()}
              />
            </View>
          </Card>

          <SectionHeader label="Inspect the records" />
          <Card>
            <View style={{ gap: space(3) }}>
              <Text style={[t.bodySmall, { color: theme.muted }]}>
                Lot owners can inspect the register and records free of charge. Copy fees are
                assessed separately and capped.
              </Text>
              <FormField
                label="Requester name"
                value={inspectionName}
                onChangeText={setInspectionName}
                autoCapitalize="words"
              />
              <Button
                label="Request register and records inspection"
                variant="secondary"
                full
                pending={inspection.isPending}
                disabled={!inspectionName.trim()}
                onPress={() => inspection.mutate()}
              />
            </View>
          </Card>
        </>
      )}
    </Screen>
  );
}
