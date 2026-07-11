import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  Button,
  Card,
  FormField,
  PressableScale,
  radius,
  Screen,
  StatusPill,
  space,
  type as t,
  useTheme,
} from "../src/components";
import { apiPost } from "../src/lib/api";

const STEP_LABELS = ["Your building", "Add lots", "Invite people"] as const;

const ROLE_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "committee_member", label: "Committee member" },
  { value: "chair", label: "Chair" },
  { value: "secretary", label: "Secretary" },
  { value: "treasurer", label: "Treasurer" },
] as const;

type InviteRole = (typeof ROLE_OPTIONS)[number]["value"];
type Step = 0 | 1 | 2 | 3;

interface CreatedScheme {
  id: string;
  name: string;
}

interface SchemeForm {
  name: string;
  planOfSubdivision: string;
  addressLine1: string;
  suburb: string;
  postcode: string;
}

interface SentInvite {
  email: string;
  role: InviteRole;
}

const EMPTY_SCHEME: SchemeForm = {
  name: "",
  planOfSubdivision: "",
  addressLine1: "",
  suburb: "",
  postcode: "",
};

function equalLotsCsv(count: number): string {
  let csv = "lot_number,entitlement,liability\n";
  for (let lot = 1; lot <= count; lot += 1) csv += `${lot},1,1\n`;
  return csv;
}

function schemeFormError(values: SchemeForm): string | null {
  if (values.name.trim().length < 3) return "Give your building a name of at least 3 characters.";
  if (!/^PS\d{4,7}[A-Z]?$/i.test(values.planOfSubdivision.trim()))
    return "Plan numbers look like PS543210V.";
  if (values.addressLine1.trim().length < 3) return "Enter the building's street address.";
  if (values.suburb.trim().length < 2) return "Enter the suburb.";
  if (!/^\d{4}$/.test(values.postcode.trim())) return "Victorian postcodes have 4 digits.";
  return null;
}

function ProgressHeader({ step }: { step: Exclude<Step, 3> }) {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: space(5) }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={[t.label, { color: theme.muted }]}>Step {step + 1} of 3</Text>
        <Text style={[t.bodySmall, { color: theme.muted }]}>{STEP_LABELS[step]}</Text>
      </View>
      <View
        style={{
          flexDirection: "row",
          gap: space(2),
          marginTop: space(3),
        }}
        accessibilityLabel={`Onboarding progress: step ${step + 1} of 3`}
      >
        {STEP_LABELS.map((label, index) => (
          <View
            key={label}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: index <= step ? theme.accent : theme.line,
            }}
          />
        ))}
      </View>
    </View>
  );
}

function QuietAction({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}
    >
      <Text style={[t.label, { color: theme.accent, fontSize: 15 }]}>{label}</Text>
    </PressableScale>
  );
}

function ErrorMessage({ children }: { children?: string | null }) {
  const theme = useTheme();
  if (!children) return null;
  return <Text style={[t.bodySmall, { color: theme.crit }]}>{children}</Text>;
}

export default function OnboardingScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(0);
  const [scheme, setScheme] = useState<CreatedScheme | null>(null);
  const [schemeForm, setSchemeForm] = useState<SchemeForm>(EMPTY_SCHEME);
  const [schemeValidation, setSchemeValidation] = useState<string | null>(null);
  const [lotCount, setLotCount] = useState("");
  const [lotValidation, setLotValidation] = useState<string | null>(null);
  const [lotsAdded, setLotsAdded] = useState(0);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("owner");
  const [inviteValidation, setInviteValidation] = useState<string | null>(null);
  const [sentInvites, setSentInvites] = useState<SentInvite[]>([]);

  const createScheme = useMutation({
    mutationFn: () =>
      apiPost<{ scheme: CreatedScheme }>("/api/schemes", {
        name: schemeForm.name.trim(),
        planOfSubdivision: schemeForm.planOfSubdivision.trim().toUpperCase(),
        addressLine1: schemeForm.addressLine1.trim(),
        suburb: schemeForm.suburb.trim(),
        state: "VIC",
        postcode: schemeForm.postcode.trim(),
      }),
    onSuccess: ({ scheme: created }) => {
      setScheme(created);
      setStep(1);
      void queryClient.invalidateQueries({ queryKey: ["schemes"] });
    },
  });

  const importLots = useMutation({
    mutationFn: (count: number) => {
      if (!scheme) throw new Error("Create the building before adding lots.");
      return apiPost<{ imported: number }>(`/api/schemes/${scheme.id}/lots/import`, {
        csv: equalLotsCsv(count),
      });
    },
    onSuccess: (_, count) => {
      setLotsAdded(count);
      setStep(2);
      if (!scheme) return;
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["scheme", scheme.id, "lots"] }),
        queryClient.invalidateQueries({ queryKey: ["scheme", scheme.id, "overview"] }),
      ]);
    },
  });

  const sendInvite = useMutation({
    mutationFn: async ({ email, role }: SentInvite) => {
      if (!scheme) throw new Error("Create the building before inviting people.");
      const { person } = await apiPost<{ person: { id: string } }>(
        `/api/schemes/${scheme.id}/people`,
        { email },
      );
      await apiPost<{ linked: boolean; expiresAt: string | null }>(
        `/api/schemes/${scheme.id}/people/${person.id}/invite`,
        { role },
      );
      return { email, role };
    },
    onSuccess: (invite) => {
      setSentInvites((current) => [...current, invite]);
      setInviteEmail("");
      if (scheme) {
        void queryClient.invalidateQueries({ queryKey: ["scheme", scheme.id, "people"] });
      }
    },
  });

  const submitScheme = () => {
    const error = schemeFormError(schemeForm);
    setSchemeValidation(error);
    if (!error) createScheme.mutate();
  };

  const submitLots = () => {
    const count = Number(lotCount);
    const valid =
      /^\d+$/.test(lotCount.trim()) && Number.isInteger(count) && count >= 1 && count <= 9999;
    const error = valid ? null : "Enter how many lots the building has, from 1 to 9999.";
    setLotValidation(error);
    if (!error) importLots.mutate(count);
  };

  const submitInvite = () => {
    const email = inviteEmail.trim().toLowerCase();
    const error = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? null : "Enter a valid email address.";
    setInviteValidation(error);
    if (!error) sendInvite.mutate({ email, role: inviteRole });
  };

  const finish = () => {
    if (!scheme) return;
    void queryClient.invalidateQueries({ queryKey: ["schemes"] });
    router.replace({ pathname: "/scheme/[id]", params: { id: scheme.id } });
  };

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  };

  const title =
    step === 0
      ? "Set up your building"
      : step === 1
        ? "Add your lots"
        : step === 2
          ? "Invite people"
          : `${scheme?.name ?? "Your building"} is set up`;

  return (
    <Screen
      title={title}
      eyebrow={step < 3 ? "New owners corporation" : "Setup complete"}
      headerRight={
        <PressableScale
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Close setup"
          style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="close" size={24} color={theme.accent} />
        </PressableScale>
      }
    >
      {step === 0 || step === 1 || step === 2 ? <ProgressHeader step={step} /> : null}

      {step === 0 ? (
        <View style={{ gap: space(4) }}>
          <Text style={[t.bodySmall, { color: theme.muted }]}>
            Register the owners corporation from its plan of subdivision. You can refine the details
            later.
          </Text>
          <FormField
            label="Building name"
            value={schemeForm.name}
            onChangeText={(name) => setSchemeForm((current) => ({ ...current, name }))}
            placeholder="e.g. 48 Rose St Owners Corporation"
            autoCapitalize="words"
            editable={!createScheme.isPending}
          />
          <FormField
            label="Plan of subdivision"
            value={schemeForm.planOfSubdivision}
            onChangeText={(planOfSubdivision) =>
              setSchemeForm((current) => ({ ...current, planOfSubdivision }))
            }
            placeholder="e.g. PS543210V"
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!createScheme.isPending}
          />
          <FormField
            label="Street address"
            value={schemeForm.addressLine1}
            onChangeText={(addressLine1) =>
              setSchemeForm((current) => ({ ...current, addressLine1 }))
            }
            placeholder="Street address"
            autoCapitalize="words"
            textContentType="streetAddressLine1"
            editable={!createScheme.isPending}
          />
          <FormField
            label="Suburb"
            value={schemeForm.suburb}
            onChangeText={(suburb) => setSchemeForm((current) => ({ ...current, suburb }))}
            placeholder="Suburb"
            autoCapitalize="words"
            textContentType="addressCity"
            editable={!createScheme.isPending}
          />
          <FormField
            label="Postcode"
            value={schemeForm.postcode}
            onChangeText={(postcode) => setSchemeForm((current) => ({ ...current, postcode }))}
            placeholder="3000"
            keyboardType="number-pad"
            textContentType="postalCode"
            maxLength={4}
            editable={!createScheme.isPending}
          />
          <ErrorMessage>
            {schemeValidation ??
              (createScheme.error instanceof Error ? createScheme.error.message : null)}
          </ErrorMessage>
          <Button
            full
            label="Create building & continue"
            onPress={submitScheme}
            pending={createScheme.isPending}
          />
        </View>
      ) : null}

      {step === 1 ? (
        <View style={{ gap: space(4) }}>
          <Text style={[t.bodySmall, { color: theme.muted }]}>
            A lot is each separately owned unit, townhouse or shop. We'll start every lot with an
            equal entitlement and liability, ready to fine-tune in the lot register.
          </Text>
          {lotsAdded > 0 ? (
            <Card>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(3) }}>
                <Ionicons name="checkmark-circle" size={22} color={theme.ok} />
                <View style={{ flex: 1 }}>
                  <Text style={[t.label, { color: theme.text }]}>{lotsAdded} lots added</Text>
                  <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(1) }]}>
                    Each starts with an equal share. You can update the register later.
                  </Text>
                </View>
              </View>
            </Card>
          ) : (
            <>
              <Card>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(3) }}>
                  <Ionicons name="layers-outline" size={20} color={theme.accent} />
                  <Text style={[t.bodySmall, { color: theme.muted, flex: 1 }]}>
                    Lots will be numbered from 1 upward. Existing registers can be replaced with a
                    detailed CSV from the Lots screen.
                  </Text>
                </View>
              </Card>
              <FormField
                label="How many lots does the building have?"
                value={lotCount}
                onChangeText={setLotCount}
                placeholder="e.g. 8"
                keyboardType="number-pad"
                maxLength={4}
                editable={!importLots.isPending}
              />
              <ErrorMessage>
                {lotValidation ??
                  (importLots.error instanceof Error ? importLots.error.message : null)}
              </ErrorMessage>
            </>
          )}
          <Button
            full
            label={lotsAdded > 0 ? "Continue" : "Add lots & continue"}
            onPress={lotsAdded > 0 ? () => setStep(2) : submitLots}
            pending={importLots.isPending}
          />
          <QuietAction label="I'll add these later" onPress={() => setStep(2)} />
        </View>
      ) : null}

      {step === 2 ? (
        <View style={{ gap: space(4) }}>
          <Text style={[t.bodySmall, { color: theme.muted }]}>
            Send secure invitations to owners and committee members. You can add everyone else from
            the People register later.
          </Text>
          <FormField
            label="Email address"
            value={inviteEmail}
            onChangeText={setInviteEmail}
            placeholder="name@example.com"
            keyboardType="email-address"
            textContentType="emailAddress"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!sendInvite.isPending}
          />
          <View style={{ gap: space(2) }}>
            <Text style={[t.label, { color: theme.muted }]}>Role</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
              {ROLE_OPTIONS.map((role) => {
                const selected = inviteRole === role.value;
                return (
                  <PressableScale
                    key={role.value}
                    onPress={() => setInviteRole(role.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    style={{
                      minHeight: 44,
                      justifyContent: "center",
                      paddingHorizontal: space(3),
                      borderRadius: radius.pill,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: selected ? theme.accent : theme.line,
                      backgroundColor: selected ? theme.accentSoft : theme.surface,
                    }}
                  >
                    <Text style={[t.label, { color: selected ? theme.accent : theme.text }]}>
                      {role.label}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          </View>
          <ErrorMessage>
            {inviteValidation ??
              (sendInvite.error instanceof Error ? sendInvite.error.message : null)}
          </ErrorMessage>
          <Button
            variant="secondary"
            full
            label="Send invite"
            onPress={submitInvite}
            pending={sendInvite.isPending}
            disabled={!inviteEmail.trim()}
          />

          {sentInvites.length > 0 ? (
            <Card>
              <Text style={[t.label, { color: theme.muted, marginBottom: space(2) }]}>Invited</Text>
              <View style={{ gap: space(3) }}>
                {sentInvites.map((invite) => (
                  <View
                    key={`${invite.email}-${invite.role}`}
                    style={{ flexDirection: "row", alignItems: "center", gap: space(3) }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={[t.bodySmall, { color: theme.text }]}>
                        {invite.email}
                      </Text>
                    </View>
                    <StatusPill
                      tone="info"
                      label={
                        ROLE_OPTIONS.find((role) => role.value === invite.role)?.label ??
                        invite.role
                      }
                    />
                  </View>
                ))}
              </View>
            </Card>
          ) : null}

          <Button
            full
            label={sentInvites.length > 0 ? "Finish setup" : "I'll do this later"}
            onPress={() => setStep(3)}
          />
          <QuietAction label="Back to lots" onPress={() => setStep(1)} />
        </View>
      ) : null}

      {step === 3 ? (
        <View style={{ gap: space(5), alignItems: "stretch" }}>
          <View style={{ alignItems: "center" }}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.okSoft,
              }}
            >
              <Ionicons name="checkmark" size={30} color={theme.ok} />
            </View>
            <Text
              style={[
                t.bodySmall,
                { color: theme.muted, textAlign: "center", marginTop: space(3) },
              ]}
            >
              Your owners corporation is on the register. Add its current insurance certificate,
              confirm the lots, then activate it from the onboarding checklist.
            </Text>
          </View>

          <Card>
            <View style={{ gap: space(4) }}>
              <NextStep
                icon="sparkles-outline"
                title="Your agents start working"
                body="Finance, maintenance and governance activity is recorded in one place."
              />
              <NextStep
                icon="shield-checkmark-outline"
                title="Setup stays guided"
                body="The checklist shows exactly what remains before the building goes live."
              />
              <NextStep
                icon="people-outline"
                title="Invite people any time"
                body="The People register keeps owner and committee access together."
              />
            </View>
          </Card>
          <Button full label="Go to your building" onPress={finish} />
        </View>
      ) : null}
    </Screen>
  );
}

function NextStep({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(3) }}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.accentSoft,
        }}
      >
        <Ionicons name={icon} size={17} color={theme.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[t.label, { color: theme.text }]}>{title}</Text>
        <Text style={[t.bodySmall, { color: theme.muted, marginTop: 2 }]}>{body}</Text>
      </View>
    </View>
  );
}
