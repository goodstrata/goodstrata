import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  formatDate,
  Screen,
  Skeleton,
  StatusPill,
  space,
  type as t,
  useTheme,
} from "../../../src/components";
import { api, apiPost } from "../../../src/lib/api";
import { useIsOfficer } from "../../../src/lib/roles";

interface Appointment {
  id: string;
  status: string;
  startsOn: string;
  endsOn: string;
  approvedFormName: string;
  delegatedPowers: string[];
  changeNotifiedAt: string | null;
}
export default function ManagerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const schemeId = String(id ?? "");
  const theme = useTheme();
  const isOfficer = useIsOfficer(schemeId);
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["scheme", schemeId, "manager-appointments"],
    queryFn: () =>
      api<{ appointments: Appointment[] }>(`/api/schemes/${schemeId}/manager/appointments`),
    enabled: !!schemeId,
  });
  const action = useMutation({
    mutationFn: ({
      appointmentId,
      action,
    }: {
      appointmentId: string;
      action: "activate" | "notify";
    }) => apiPost(`/api/schemes/${schemeId}/manager/appointments/${appointmentId}/${action}`),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["scheme", schemeId, "manager-appointments"] }),
  });
  if (query.isPending)
    return (
      <Screen title="Manager" topInset={false}>
        <Card>
          <Skeleton width="75%" height={20} />
        </Card>
      </Screen>
    );
  if (!query.data)
    return (
      <Screen title="Manager" topInset={false}>
        <ErrorState onRetry={() => query.refetch()} />
      </Screen>
    );
  return (
    <Screen title="Manager" topInset={false}>
      <Text style={[t.body, { color: theme.muted }]}>
        Registered-manager mode activates only after the approved-form appointment, delegation, BLA
        registration and continuous $2 million PI gates pass.
      </Text>
      {query.data.appointments.length === 0 ? (
        <EmptyState
          icon="briefcase-outline"
          title="No appointment"
          body="Use the web manager workspace to record the signed instruments and resolutions."
        />
      ) : (
        query.data.appointments.map((item) => (
          <Card key={item.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2) }}>
              <Text style={[t.title, { color: theme.text, flex: 1 }]}>{item.approvedFormName}</Text>
              <StatusPill tone={item.status === "active" ? "ok" : "neutral"} label={item.status} />
            </View>
            <Text style={[t.bodySmall, { color: theme.muted, marginTop: space(2) }]}>
              {formatDate(item.startsOn)}–{formatDate(item.endsOn)} · {item.delegatedPowers.length}{" "}
              delegated powers
            </Text>
            {isOfficer && item.status === "draft" ? (
              <Button
                label="Activate after eligibility check"
                onPress={() => action.mutate({ appointmentId: item.id, action: "activate" })}
              />
            ) : null}
            {isOfficer ? (
              <Button
                label={item.changeNotifiedAt ? "Notify owners again" : "Notify owners"}
                variant="secondary"
                onPress={() => action.mutate({ appointmentId: item.id, action: "notify" })}
              />
            ) : null}
          </Card>
        ))
      )}
    </Screen>
  );
}
