import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import { type ReactNode, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormField,
  formatDate,
  formatMoney,
  humanise,
  PressableScale,
  plate,
  radius,
  Screen,
  SectionHeader,
  Sheet,
  Skeleton,
  StatusPill,
  type StatusToneName,
  space,
  statusTone,
  type as t,
  useTheme,
} from "../../../src/components";
import { api, apiPost } from "../../../src/lib/api";
import { schemeQueryOptions, useIsOfficer } from "../../../src/lib/roles";

interface Request {
  id: string;
  title: string;
  description: string;
  category: string | null;
  urgency: string | null;
  isCommonProperty: boolean | null;
  aiTriage: { reasoning?: string; declineExplanation?: string } | null;
  status: string;
  createdAt: string;
}

interface WorkOrder {
  id: string;
  scope: string;
  approvedAmountCents: number;
  status: string;
  contractorId: string;
  contractorName: string | null;
  requestTitle: string | null;
}

interface Contractor {
  id: string;
  businessName: string;
  tradeCategories: string[];
  email: string | null;
}

interface Rfq {
  id: string;
  requestId: string;
  title: string;
  specMd: string;
  category: string;
  suburb: string;
  quotesDueOn: string | null;
  status: string;
  awardedQuoteId: string | null;
  decisionId: string | null;
  createdAt: string;
  quoteCount: number;
  requestTitle: string | null;
}

interface RfqChannel {
  id: string;
  provider: string;
  contractorId: string | null;
  status: string;
  sentAt: string | null;
}

interface RfqQuote {
  quoteId: string;
  contractorId: string;
  contractorName: string;
  amountCents: number;
  platformFeeCents: number;
  referralFeeCents: number;
  feeRecipient: string | null;
  feeDisclosure: string;
  licenceConfirmed: boolean;
  insuranceConfirmed: boolean;
  validUntil: string | null;
  notes: string | null;
  status: string;
}

interface RfqDetailPayload {
  rfq: Rfq;
  channels: RfqChannel[];
  quotes: RfqQuote[];
}

type MaintenanceSection = "requests" | "quotes" | "work_orders" | "contractors";

const COMPLETABLE_STATUSES = new Set(["dispatched", "accepted", "scheduled", "in_progress"]);
const QUOTABLE_STATUSES = new Set(["published", "quoting"]);
const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SECTIONS: { value: MaintenanceSection; label: string }[] = [
  { value: "requests", label: "Requests" },
  { value: "quotes", label: "Quotes" },
  { value: "work_orders", label: "Work orders" },
  { value: "contractors", label: "Contractors" },
];

const ROUTE_MESSAGES: Record<string, string> = {
  auto_dispatched: "Work order dispatched to the contractor.",
  awaiting_approval: "Work order raised for committee approval.",
  emergency_dispatched: "Emergency works dispatched for post-hoc review.",
};

const PROVIDER_LABELS: Record<string, string> = {
  scheme_book: "Contractor book",
  email_rfq: "Email invite",
};

function ownerLabel(status: string): string {
  switch (status) {
    case "open":
    case "reported":
    case "received":
      return "Reported";
    case "scheduled":
      return "Scheduled";
    case "completed":
      return "Done";
    case "rejected":
      return "Not proceeding";
    default:
      return "Being looked at";
  }
}

function ownerTone(status: string): StatusToneName {
  if (status === "completed") return "ok";
  if (status === "rejected") return "crit";
  return "warn";
}

function money(cents: number): string {
  const formatted = formatMoney(cents);
  return `${formatted.dollars}${formatted.cents}`;
}

function dollarsToCents(value: string): number {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function parseInviteEmails(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export default function MaintenanceScreen() {
  const params = useLocalSearchParams<{ id: string; focus?: string }>();
  const schemeId = String(params.id ?? "");
  const focus = String(params.focus ?? "");
  const isOfficer = useIsOfficer(schemeId);
  const queryClient = useQueryClient();
  const [section, setSection] = useState<MaintenanceSection>("requests");
  const [focusRouted, setFocusRouted] = useState(false);

  const schemeQuery = useQuery({ ...schemeQueryOptions(schemeId), enabled: !!schemeId });
  const requestsQuery = useQuery({
    queryKey: ["scheme", schemeId, "maintenance"],
    queryFn: () => api<{ requests: Request[] }>(`/api/schemes/${schemeId}/maintenance`),
    enabled: !!schemeId,
  });
  const workOrdersQuery = useQuery({
    queryKey: ["scheme", schemeId, "work-orders"],
    queryFn: () => api<{ workOrders: WorkOrder[] }>(`/api/schemes/${schemeId}/work-orders`),
    enabled: !!schemeId && isOfficer,
  });
  const contractorsQuery = useQuery({
    queryKey: ["scheme", schemeId, "contractors"],
    queryFn: () => api<{ contractors: Contractor[] }>(`/api/schemes/${schemeId}/contractors`),
    enabled: !!schemeId && isOfficer,
  });
  const rfqsQuery = useQuery({
    queryKey: ["scheme", schemeId, "rfqs"],
    queryFn: () => api<{ rfqs: Rfq[] }>(`/api/schemes/${schemeId}/rfqs`),
    enabled: !!schemeId && isOfficer,
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "maintenance"] }),
      queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "work-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "contractors"] }),
      queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "rfqs"] }),
      queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "rfq"] }),
      queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "decisions"] }),
      queryClient.invalidateQueries({ queryKey: ["scheme", schemeId, "overview"] }),
    ]);
  };

  const refresh = () =>
    Promise.all([
      requestsQuery.refetch(),
      ...(isOfficer
        ? [workOrdersQuery.refetch(), contractorsQuery.refetch(), rfqsQuery.refetch()]
        : []),
    ]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const report = useMutation({
    mutationFn: () =>
      apiPost(`/api/schemes/${schemeId}/maintenance`, {
        title: title.trim(),
        description: description.trim(),
      }),
    onSuccess: async () => {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTitle("");
      setDescription("");
      await invalidate();
    },
  });

  const requests = requestsQuery.data?.requests ?? [];
  const workOrders = workOrdersQuery.data?.workOrders ?? [];
  const contractors = contractorsQuery.data?.contractors ?? [];
  const rfqs = rfqsQuery.data?.rfqs ?? [];
  const canReport = title.trim().length >= 3 && description.trim().length >= 3 && !report.isPending;

  useEffect(() => {
    if (
      focusRouted ||
      !isOfficer ||
      !focus ||
      requestsQuery.isPending ||
      workOrdersQuery.isPending ||
      rfqsQuery.isPending
    ) {
      return;
    }
    if (workOrders.some((workOrder) => workOrder.id === focus)) {
      setSection("work_orders");
    } else if (rfqs.some((rfq) => rfq.id === focus)) {
      setSection("quotes");
    } else {
      setSection("requests");
    }
    setFocusRouted(true);
  }, [
    focus,
    focusRouted,
    isOfficer,
    requestsQuery.isPending,
    rfqs,
    rfqsQuery.isPending,
    workOrders,
    workOrdersQuery.isPending,
  ]);

  return (
    <Screen
      title={isOfficer ? "Maintenance" : "Report an issue"}
      topInset={false}
      eyebrow={plate(schemeQuery.data?.scheme)}
      reserveEyebrow
      onRefresh={refresh}
    >
      {isOfficer ? <SectionTabs section={section} onChange={setSection} /> : null}

      {section === "requests" || !isOfficer ? (
        <>
          <Card>
            <ReportForm
              title={title}
              description={description}
              onTitle={setTitle}
              onDescription={setDescription}
              onSubmit={() => report.mutate()}
              canSubmit={canReport}
              pending={report.isPending}
              error={
                report.isError
                  ? messageFrom(report.error, "Couldn't send that report. Try again.")
                  : null
              }
            />
          </Card>

          <SectionHeader label={isOfficer ? "Reported issues" : "What I've reported"} />
          {requestsQuery.isPending ? (
            <RequestSkeleton />
          ) : requestsQuery.isError && !requestsQuery.data ? (
            <ErrorState onRetry={() => requestsQuery.refetch()} />
          ) : requests.length === 0 ? (
            <EmptyState icon="construct-outline" title="Nothing reported yet" />
          ) : (
            <Card padded={false} style={{ paddingHorizontal: space(4) }}>
              {requests.map((request, index) => (
                <RequestRow
                  key={request.id}
                  schemeId={schemeId}
                  request={request}
                  contractors={contractors}
                  isOfficer={isOfficer}
                  highlighted={focus === request.id}
                  divider={index < requests.length - 1}
                  onChange={invalidate}
                />
              ))}
            </Card>
          )}
        </>
      ) : null}

      {isOfficer && section === "quotes" ? (
        <RfqSection
          schemeId={schemeId}
          rfqs={rfqs}
          contractors={contractors}
          query={rfqsQuery}
          focus={focus}
          onChange={invalidate}
        />
      ) : null}

      {isOfficer && section === "work_orders" ? (
        <WorkOrderSection
          schemeId={schemeId}
          workOrders={workOrders}
          query={workOrdersQuery}
          focus={focus}
          onChange={invalidate}
        />
      ) : null}

      {isOfficer && section === "contractors" ? (
        <ContractorSection
          schemeId={schemeId}
          contractors={contractors}
          query={contractorsQuery}
          onChange={invalidate}
        />
      ) : null}
    </Screen>
  );
}

function SectionTabs({
  section,
  onChange,
}: {
  section: MaintenanceSection;
  onChange: (section: MaintenanceSection) => void;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginBottom: space(4) }}
    >
      {SECTIONS.map((item) => {
        const selected = item.value === section;
        return (
          <PressableScale
            key={item.value}
            onPress={() => onChange(item.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={{
              minHeight: 44,
              justifyContent: "center",
              paddingHorizontal: space(3),
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: selected ? theme.accent : theme.line,
              backgroundColor: selected ? theme.accentSoft : theme.surface,
            }}
          >
            <Text style={{ ...t.label, color: selected ? theme.accent : theme.text }}>
              {item.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

function ReportForm({
  title,
  description,
  onTitle,
  onDescription,
  onSubmit,
  canSubmit,
  pending,
  error,
}: {
  title: string;
  description: string;
  onTitle: (value: string) => void;
  onDescription: (value: string) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  pending: boolean;
  error: string | null;
}) {
  return (
    <View style={{ gap: space(3) }}>
      <FormField
        label="What's wrong?"
        value={title}
        onChangeText={onTitle}
        placeholder="e.g. Leaking tap in the car park"
        returnKeyType="next"
        maxLength={200}
      />
      <FormField
        label="Any detail that helps"
        value={description}
        onChangeText={onDescription}
        placeholder="Where it is, how bad, since when…"
        multiline
        maxLength={5000}
      />
      {error ? <InlineFeedback message={error} /> : null}
      <View style={{ alignItems: "flex-start", marginTop: space(1) }}>
        <Button label="Report issue" onPress={onSubmit} disabled={!canSubmit} pending={pending} />
      </View>
    </View>
  );
}

function RequestRow({
  schemeId,
  request,
  contractors,
  isOfficer,
  highlighted,
  divider,
  onChange,
}: {
  schemeId: string;
  request: Request;
  contractors: Contractor[];
  isOfficer: boolean;
  highlighted: boolean;
  divider: boolean;
  onChange: () => Promise<unknown>;
}) {
  const theme = useTheme();
  const meta: string[] = [formatDate(request.createdAt.slice(0, 10))];
  if (isOfficer && request.category) meta.push(humanise(request.category));
  if (isOfficer && request.urgency) meta.push(humanise(request.urgency));
  const triage =
    request.status === "rejected"
      ? request.aiTriage?.declineExplanation
      : isOfficer
        ? request.aiTriage?.reasoning
        : undefined;

  return (
    <View
      style={{
        marginHorizontal: highlighted ? -space(4) : 0,
        paddingHorizontal: highlighted ? space(4) : 0,
        paddingVertical: space(3),
        backgroundColor: highlighted ? theme.accentSoft : "transparent",
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: theme.line,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <Text style={{ ...t.body, color: theme.text, flex: 1 }} numberOfLines={2}>
          {request.title}
        </Text>
        <StatusPill
          tone={isOfficer ? statusTone(request.status) : ownerTone(request.status)}
          label={isOfficer ? humanise(request.status) : ownerLabel(request.status)}
        />
      </View>
      {request.description ? (
        <Text style={{ ...t.bodySmall, color: theme.muted, marginTop: 2 }} numberOfLines={3}>
          {request.description}
        </Text>
      ) : null}
      <Text style={{ ...t.caption, color: theme.muted, marginTop: space(1) }}>
        {meta.join(" · ")}
      </Text>
      {isOfficer && request.category ? (
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginTop: space(2) }}
        >
          <StatusPill tone="agent" label="Agent triaged" />
          <Text style={{ ...t.caption, color: theme.muted }}>
            {request.isCommonProperty ? "Common property" : "Lot responsibility"}
          </Text>
        </View>
      ) : null}
      {triage ? (
        <Text
          style={{ ...t.caption, color: theme.muted, marginTop: space(1), fontStyle: "italic" }}
        >
          {triage}
        </Text>
      ) : null}
      {isOfficer && request.status === "triaged" ? (
        <View
          style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(3) }}
        >
          <GetQuotesAction
            schemeId={schemeId}
            requestId={request.id}
            contractors={contractors}
            onChange={onChange}
          />
          <RaiseWorkOrderAction
            schemeId={schemeId}
            request={request}
            contractors={contractors}
            onChange={onChange}
          />
        </View>
      ) : null}
    </View>
  );
}

function RequestSkeleton() {
  return (
    <Card>
      <Skeleton width="70%" height={16} />
      <View style={{ marginTop: space(3) }}>
        <Skeleton width="50%" height={14} />
      </View>
    </Card>
  );
}

function GetQuotesAction({
  schemeId,
  requestId,
  contractors,
  onChange,
}: {
  schemeId: string;
  requestId: string;
  contractors: Contractor[];
  onChange: () => Promise<unknown>;
}) {
  const [rfqId, setRfqId] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      apiPost<{ rfq: { id: string } }>(`/api/schemes/${schemeId}/requests/${requestId}/rfq`, {}),
    onSuccess: async ({ rfq }) => {
      setRfqId(rfq.id);
      await onChange();
    },
  });

  return (
    <>
      <Button
        variant="secondary"
        label="Get quotes"
        onPress={() => create.mutate()}
        pending={create.isPending}
      />
      {create.isError ? (
        <InlineFeedback message={messageFrom(create.error, "Couldn't open the RFQ.")} />
      ) : null}
      {rfqId ? (
        <SendRfqSheet
          visible
          schemeId={schemeId}
          rfqId={rfqId}
          contractors={contractors}
          onClose={() => setRfqId(null)}
          onChange={onChange}
        />
      ) : null}
    </>
  );
}

function RaiseWorkOrderAction({
  schemeId,
  request,
  contractors,
  onChange,
}: {
  schemeId: string;
  request: Request;
  contractors: Contractor[];
  onChange: () => Promise<unknown>;
}) {
  const [visible, setVisible] = useState(false);
  const [contractorId, setContractorId] = useState("");
  const [scope, setScope] = useState("");
  const [estimate, setEstimate] = useState("");
  const [accessNotes, setAccessNotes] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const estimatedCents = dollarsToCents(estimate);

  const raise = useMutation({
    mutationFn: () =>
      apiPost<{ route: { mode: string } }>(`/api/schemes/${schemeId}/work-orders`, {
        requestId: request.id,
        contractorId,
        scope: scope.trim(),
        estimatedCents,
        ...(accessNotes.trim() ? { accessNotes: accessNotes.trim() } : {}),
      }),
    onSuccess: async ({ route }) => {
      setVisible(false);
      setResult(ROUTE_MESSAGES[route.mode] ?? "Work order raised.");
      setContractorId("");
      setScope("");
      setEstimate("");
      setAccessNotes("");
      await onChange();
    },
  });

  const disabled = !contractorId || scope.trim().length < 5 || estimatedCents <= 0;

  return (
    <>
      <Button variant="secondary" label="Raise work order" onPress={() => setVisible(true)} />
      {result ? <InlineFeedback message={result} tone="ok" /> : null}
      <Sheet visible={visible} onClose={() => setVisible(false)}>
        <SheetScroll>
          <SheetHeading
            title="Raise a work order"
            body={`For “${request.title}”. Small jobs dispatch immediately; larger jobs go to committee approval.`}
          />
          <ChoiceList
            label="Contractor"
            items={contractors}
            selected={contractorId}
            onSelect={setContractorId}
            itemLabel={(contractor) =>
              `${contractor.businessName} · ${contractor.tradeCategories.join(", ")}`
            }
            empty="Add a contractor to the pool first."
          />
          <FormField
            label="Scope of work"
            value={scope}
            onChangeText={setScope}
            placeholder="What exactly should the contractor do?"
            multiline
            maxLength={5000}
          />
          <FormField
            label="Estimated cost ($)"
            value={estimate}
            onChangeText={setEstimate}
            keyboardType="decimal-pad"
            placeholder="e.g. 450"
          />
          <FormField
            label="Access notes (optional)"
            value={accessNotes}
            onChangeText={setAccessNotes}
            placeholder="Keys, site contact, available hours…"
            maxLength={1000}
          />
          {raise.isError ? (
            <InlineFeedback message={messageFrom(raise.error, "Couldn't raise the work order.")} />
          ) : null}
          <Button
            full
            label="Raise work order"
            onPress={() => raise.mutate()}
            pending={raise.isPending}
            disabled={disabled}
          />
        </SheetScroll>
      </Sheet>
    </>
  );
}

function RfqSection({
  schemeId,
  rfqs,
  contractors,
  query,
  focus,
  onChange,
}: {
  schemeId: string;
  rfqs: Rfq[];
  contractors: Contractor[];
  query: ReturnType<typeof useQuery<{ rfqs: Rfq[] }>>;
  focus: string;
  onChange: () => Promise<unknown>;
}) {
  return (
    <>
      <SectionHeader label="Requests for quotes" />
      {query.isPending ? (
        <RequestSkeleton />
      ) : query.isError && !query.data ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : rfqs.length === 0 ? (
        <EmptyState
          icon="document-text-outline"
          title="No requests for quotes yet"
          body="Use Get quotes on a triaged request to invite competing quotes."
        />
      ) : (
        <View style={{ gap: space(3) }}>
          {rfqs.map((rfq) => (
            <RfqCard
              key={rfq.id}
              schemeId={schemeId}
              rfq={rfq}
              contractors={contractors}
              highlighted={focus === rfq.id}
              onChange={onChange}
            />
          ))}
        </View>
      )}
    </>
  );
}

function RfqCard({
  schemeId,
  rfq,
  contractors,
  highlighted,
  onChange,
}: {
  schemeId: string;
  rfq: Rfq;
  contractors: Contractor[];
  highlighted: boolean;
  onChange: () => Promise<unknown>;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [sendVisible, setSendVisible] = useState(false);
  const [quoteVisible, setQuoteVisible] = useState(false);
  const [awardQuote, setAwardQuote] = useState<RfqQuote | null>(null);
  const detail = useQuery({
    queryKey: ["scheme", schemeId, "rfq", rfq.id],
    queryFn: () => api<RfqDetailPayload>(`/api/schemes/${schemeId}/rfqs/${rfq.id}`),
    enabled: expanded,
    refetchInterval: expanded ? 3000 : false,
  });
  const requestAward = useMutation({
    mutationFn: (quoteId: string) =>
      apiPost(`/api/schemes/${schemeId}/rfqs/${rfq.id}/award`, { quoteId }),
    onSuccess: async () => {
      setAwardQuote(null);
      await onChange();
      await detail.refetch();
    },
  });

  const current = detail.data?.rfq ?? rfq;
  const quotes = detail.data?.quotes ?? [];
  const channels = detail.data?.channels ?? [];

  return (
    <Card style={{ backgroundColor: highlighted ? theme.accentSoft : theme.surface }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(3) }}>
        <View style={{ flex: 1 }}>
          <Text style={{ ...t.body, color: theme.text }}>{rfq.title}</Text>
          <Text style={{ ...t.caption, color: theme.muted, marginTop: space(1) }}>
            {[humanise(rfq.category), rfq.suburb, rfq.requestTitle && `for “${rfq.requestTitle}”`]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          {rfq.quotesDueOn ? (
            <Text style={{ ...t.caption, color: theme.muted, marginTop: 2 }}>
              Quotes due {formatDate(rfq.quotesDueOn)}
            </Text>
          ) : null}
        </View>
        <StatusPill tone={statusTone(rfq.status)} label={humanise(rfq.status)} />
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(3) }}>
        {rfq.status === "draft" ? (
          <Button
            variant="secondary"
            label="Review and send"
            onPress={() => setSendVisible(true)}
          />
        ) : null}
        <Button
          variant="secondary"
          label={
            expanded
              ? "Hide quote detail"
              : `${rfq.quoteCount} ${rfq.quoteCount === 1 ? "quote" : "quotes"}`
          }
          onPress={() => setExpanded((value) => !value)}
        />
      </View>

      {expanded ? (
        <View
          style={{
            marginTop: space(4),
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.line,
            paddingTop: space(4),
          }}
        >
          {detail.isPending ? (
            <Skeleton width="80%" height={18} />
          ) : detail.isError && !detail.data ? (
            <ErrorState onRetry={() => detail.refetch()} />
          ) : (
            <>
              <Text style={{ ...t.label, color: theme.muted }}>Scope sent to contractors</Text>
              <Text style={{ ...t.bodySmall, color: theme.text, marginTop: space(2) }}>
                {current.specMd}
              </Text>

              {channels.length > 0 ? (
                <View style={{ marginTop: space(4), gap: space(2) }}>
                  <Text style={{ ...t.label, color: theme.muted }}>Channels</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                    {channels.map((channel) => (
                      <StatusPill
                        key={channel.id}
                        tone={statusTone(channel.status)}
                        label={`${PROVIDER_LABELS[channel.provider] ?? humanise(channel.provider)} · ${humanise(channel.status)}`}
                      />
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={{ marginTop: space(4), gap: space(3) }}>
                <Text style={{ ...t.label, color: theme.muted }}>Quote comparison</Text>
                {quotes.length === 0 ? (
                  <Text style={{ ...t.bodySmall, color: theme.muted }}>
                    {channels.some((channel) => channel.status !== "failed")
                      ? "No quotes yet — invitations have been sent."
                      : "No quotes yet — this RFQ hasn't been sent."}
                  </Text>
                ) : (
                  quotes.map((quote, index) => (
                    <QuoteRow
                      key={quote.quoteId}
                      quote={quote}
                      divider={index < quotes.length - 1}
                      canNominate={
                        QUOTABLE_STATUSES.has(current.status) && quote.status === "received"
                      }
                      onNominate={() => setAwardQuote(quote)}
                    />
                  ))
                )}
              </View>

              {QUOTABLE_STATUSES.has(current.status) ? (
                <View style={{ marginTop: space(3) }}>
                  <Button
                    variant="secondary"
                    label="Add quote"
                    onPress={() => setQuoteVisible(true)}
                  />
                </View>
              ) : null}
            </>
          )}
        </View>
      ) : null}

      <SendRfqSheet
        visible={sendVisible}
        schemeId={schemeId}
        rfqId={rfq.id}
        contractors={contractors}
        onClose={() => setSendVisible(false)}
        onChange={onChange}
      />
      <AddQuoteSheet
        visible={quoteVisible}
        schemeId={schemeId}
        rfq={current}
        contractors={contractors}
        onClose={() => setQuoteVisible(false)}
        onChange={async () => {
          await onChange();
          await detail.refetch();
        }}
      />
      <Sheet visible={awardQuote !== null} onClose={() => setAwardQuote(null)}>
        <SheetScroll>
          <SheetHeading
            title="Ask the committee to award?"
            body="This opens a committee decision. The quote is not awarded until a majority approves it."
          />
          {awardQuote ? (
            <>
              <Text style={{ ...t.body, color: theme.text }}>
                {awardQuote.contractorName} · {money(awardQuote.amountCents)}
              </Text>
              <FeeDisclosure quote={awardQuote} />
            </>
          ) : null}
          {requestAward.isError ? (
            <InlineFeedback
              message={messageFrom(requestAward.error, "Couldn't send the award decision.")}
            />
          ) : null}
          <Button
            full
            label="Send to the committee"
            onPress={() => awardQuote && requestAward.mutate(awardQuote.quoteId)}
            pending={requestAward.isPending}
            disabled={!awardQuote}
          />
        </SheetScroll>
      </Sheet>
    </Card>
  );
}

function QuoteRow({
  quote,
  divider,
  canNominate,
  onNominate,
}: {
  quote: RfqQuote;
  divider: boolean;
  canNominate: boolean;
  onNominate: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingBottom: divider ? space(3) : 0,
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: theme.line,
        gap: space(2),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(2) }}>
        <View style={{ flex: 1 }}>
          <Text style={{ ...t.bodySmall, color: theme.text }}>{quote.contractorName}</Text>
          <Text style={{ ...t.figureSmall, color: theme.text, marginTop: 2 }}>
            {money(quote.amountCents)}
          </Text>
        </View>
        <StatusPill tone={statusTone(quote.status)} label={humanise(quote.status)} />
      </View>
      <FeeDisclosure quote={quote} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
        <StatusPill
          tone={quote.licenceConfirmed ? "ok" : "neutral"}
          label={quote.licenceConfirmed ? "Licence checked" : "Licence unconfirmed"}
        />
        <StatusPill
          tone={quote.insuranceConfirmed ? "ok" : "neutral"}
          label={quote.insuranceConfirmed ? "Insurance checked" : "Insurance unconfirmed"}
        />
      </View>
      {quote.validUntil ? (
        <Text style={{ ...t.caption, color: theme.muted }}>
          Valid until {formatDate(quote.validUntil)}
        </Text>
      ) : null}
      {quote.notes ? <Text style={{ ...t.caption, color: theme.muted }}>{quote.notes}</Text> : null}
      {canNominate ? (
        <Button variant="secondary" label="Ask committee to award" onPress={onNominate} />
      ) : null}
    </View>
  );
}

function FeeDisclosure({ quote }: { quote: RfqQuote }) {
  const theme = useTheme();
  const hasFees = quote.platformFeeCents + quote.referralFeeCents > 0;
  return (
    <View
      style={{
        borderRadius: radius.control,
        paddingHorizontal: space(3),
        paddingVertical: space(2),
        backgroundColor: hasFees ? theme.warnSoft : theme.neutralSoft,
      }}
    >
      <Text style={{ ...t.caption, color: hasFees ? theme.warn : theme.muted }}>
        Fees: {quote.feeDisclosure || "none"}
      </Text>
    </View>
  );
}

function SendRfqSheet({
  visible,
  schemeId,
  rfqId,
  contractors,
  onClose,
  onChange,
}: {
  visible: boolean;
  schemeId: string;
  rfqId: string;
  contractors: Contractor[];
  onClose: () => void;
  onChange: () => Promise<unknown>;
}) {
  const [editedTitle, setEditedTitle] = useState<string | null>(null);
  const [editedSpec, setEditedSpec] = useState<string | null>(null);
  const [editedDueOn, setEditedDueOn] = useState<string | null>(null);
  const [selectedContractors, setSelectedContractors] = useState<string[]>([]);
  const [inviteText, setInviteText] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["scheme", schemeId, "rfq", rfqId],
    queryFn: () => api<RfqDetailPayload>(`/api/schemes/${schemeId}/rfqs/${rfqId}`),
    enabled: visible,
    refetchInterval: visible && editedSpec === null ? 2000 : false,
  });
  const rfq = detail.data?.rfq;
  const title = editedTitle ?? rfq?.title ?? "";
  const spec = editedSpec ?? rfq?.specMd ?? "";
  const dueOn = editedDueOn ?? rfq?.quotesDueOn ?? "";

  const send = useMutation({
    mutationFn: async () => {
      const invitedEmails = parseInviteEmails(inviteText);
      const invalidEmails = invitedEmails.filter((email) => !EMAIL_LIKE.test(email));
      if (invalidEmails.length > 0) {
        throw new Error(`Check these email addresses: ${invalidEmails.join(", ")}`);
      }
      if (selectedContractors.length + invitedEmails.length === 0) {
        throw new Error("Pick a contractor or add an email invitation.");
      }
      if (title.trim().length < 3) throw new Error("Give the request a short title.");
      if (spec.trim().length < 20) throw new Error("Add more detail to the scope of works.");
      if (dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) {
        throw new Error("Enter the due date as YYYY-MM-DD.");
      }
      await apiPost(`/api/schemes/${schemeId}/rfqs/${rfqId}/spec`, {
        title: title.trim(),
        specMd: spec.trim(),
        category: rfq?.category ?? "general",
        ...(dueOn ? { quotesDueOn: dueOn } : {}),
      });
      return apiPost<{ result: { channelsSent: number; channelsFailed: number } }>(
        `/api/schemes/${schemeId}/rfqs/${rfqId}/dispatch`,
        { contractorIds: selectedContractors, invitedEmails, broadcastProviders: [] },
      );
    },
    onSuccess: async () => {
      setEditedTitle(null);
      setEditedSpec(null);
      setEditedDueOn(null);
      setSelectedContractors([]);
      setInviteText("");
      setLocalError(null);
      onClose();
      await onChange();
    },
    onError: (error) => setLocalError(messageFrom(error, "Couldn't send the RFQ.")),
  });

  const toggleContractor = (contractorId: string) => {
    setSelectedContractors((current) =>
      current.includes(contractorId)
        ? current.filter((id) => id !== contractorId)
        : [...current, contractorId],
    );
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetScroll>
        <SheetHeading
          title="Review and send the RFQ"
          body="Contractors receive the scope and suburb only. Names, contact details and the exact address stay private until award."
        />
        {detail.isPending ? (
          <RequestSkeleton />
        ) : detail.isError || !rfq ? (
          <ErrorState onRetry={() => detail.refetch()} />
        ) : rfq.status !== "draft" ? (
          <InlineFeedback message="This request for quotes has already been sent." tone="ok" />
        ) : (
          <>
            <FormField label="Title" value={title} onChangeText={setEditedTitle} maxLength={200} />
            <FormField
              label={`Scope of works · ${humanise(rfq.category)} · ${rfq.suburb}`}
              value={spec}
              onChangeText={setEditedSpec}
              multiline
              maxLength={20000}
            />
            <FormField
              label="Quotes due (YYYY-MM-DD, optional)"
              value={dueOn}
              onChangeText={setEditedDueOn}
              placeholder="2026-08-01"
            />
            <MultiChoiceList
              label="Send to your contractors"
              items={contractors}
              selected={selectedContractors}
              onToggle={toggleContractor}
              itemLabel={(contractor) =>
                contractor.email
                  ? `${contractor.businessName} · ${contractor.tradeCategories.join(", ")}`
                  : `${contractor.businessName} · no email on file`
              }
              disabled={(contractor) => !contractor.email}
              empty="No contractors in the pool. Invite someone by email below."
            />
            <FormField
              label="Invite by email (comma-separated)"
              value={inviteText}
              onChangeText={setInviteText}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="quotes@plumber.example, sam@sparkies.example"
            />
            {localError ? <InlineFeedback message={localError} /> : null}
            <Button
              full
              label="Send request for quotes"
              onPress={() => {
                setLocalError(null);
                send.mutate();
              }}
              pending={send.isPending}
            />
          </>
        )}
      </SheetScroll>
    </Sheet>
  );
}

function AddQuoteSheet({
  visible,
  schemeId,
  rfq,
  contractors,
  onClose,
  onChange,
}: {
  visible: boolean;
  schemeId: string;
  rfq: Rfq;
  contractors: Contractor[];
  onClose: () => void;
  onChange: () => Promise<unknown>;
}) {
  const [source, setSource] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [licenceConfirmed, setLicenceConfirmed] = useState(false);
  const [insuranceConfirmed, setInsuranceConfirmed] = useState(false);
  const [platformFee, setPlatformFee] = useState("");
  const [referralFee, setReferralFee] = useState("");
  const [feeRecipient, setFeeRecipient] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const amountCents = dollarsToCents(amount);
  const platformFeeCents = dollarsToCents(platformFee);
  const referralFeeCents = dollarsToCents(referralFee);
  const external = source === "external";

  const reset = () => {
    setSource("");
    setBusinessName("");
    setEmail("");
    setPhone("");
    setAmount("");
    setValidUntil("");
    setNotes("");
    setLicenceConfirmed(false);
    setInsuranceConfirmed(false);
    setPlatformFee("");
    setReferralFee("");
    setFeeRecipient("");
    setLocalError(null);
  };

  const record = useMutation({
    mutationFn: async () => {
      if (!source) throw new Error("Choose who supplied the quote.");
      if (external && businessName.trim().length < 2) {
        throw new Error("Enter the tradie's business name.");
      }
      if (email.trim() && !EMAIL_LIKE.test(email.trim())) {
        throw new Error("Enter a valid email address.");
      }
      if (amountCents <= 0) throw new Error("Enter a positive quoted amount.");
      if (platformFeeCents < 0 || referralFeeCents < 0) {
        throw new Error("Fees cannot be negative.");
      }
      if (platformFeeCents + referralFeeCents > 0 && feeRecipient.trim().length < 2) {
        throw new Error("Name who receives the disclosed fee.");
      }
      if (validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) {
        throw new Error("Enter the validity date as YYYY-MM-DD.");
      }
      return apiPost(`/api/schemes/${schemeId}/rfqs/${rfq.id}/quotes`, {
        ...(external
          ? {
              contact: {
                businessName: businessName.trim(),
                ...(email.trim() ? { email: email.trim().toLowerCase() } : {}),
                ...(phone.trim() ? { phone: phone.trim() } : {}),
              },
            }
          : { contractorId: source }),
        amountCents,
        ...(validUntil ? { validUntil } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        licenceConfirmed,
        insuranceConfirmed,
        platformFeeCents,
        referralFeeCents,
        ...(feeRecipient.trim() ? { feeRecipient: feeRecipient.trim() } : {}),
      });
    },
    onSuccess: async () => {
      reset();
      onClose();
      await onChange();
    },
    onError: (error) => setLocalError(messageFrom(error, "Couldn't record the quote.")),
  });

  const sources = [
    ...contractors.map((contractor) => ({ id: contractor.id, label: contractor.businessName })),
    { id: "external", label: "Someone else (new pending contractor)" },
  ];

  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetScroll>
        <SheetHeading
          title="Add a quote"
          body="Record a phone or email quote. Platform and referral fees are always disclosed to the committee."
        />
        <ChoiceList
          label="Who is quoting?"
          items={sources}
          selected={source}
          onSelect={setSource}
          itemLabel={(item) => item.label}
        />
        {external ? (
          <>
            <FormField
              label="Business name"
              value={businessName}
              onChangeText={setBusinessName}
              placeholder={`e.g. Westside ${humanise(rfq.category)} Services`}
              maxLength={200}
            />
            <FormField
              label="Email (optional)"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <FormField
              label="Phone (optional)"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
          </>
        ) : null}
        <FormField
          label="Quoted amount ($)"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="e.g. 850"
        />
        <FormField
          label="Valid until (YYYY-MM-DD, optional)"
          value={validUntil}
          onChangeText={setValidUntil}
        />
        <FormField
          label="Notes (optional)"
          value={notes}
          onChangeText={setNotes}
          multiline
          maxLength={5000}
          placeholder="Inclusions, exclusions, lead time…"
        />
        <ToggleOption
          label="Trade licence sighted and current"
          selected={licenceConfirmed}
          onPress={() => setLicenceConfirmed((value) => !value)}
        />
        <ToggleOption
          label="Insurance certificate sighted and current"
          selected={insuranceConfirmed}
          onPress={() => setInsuranceConfirmed((value) => !value)}
        />
        <FormField
          label="Platform fee ($)"
          value={platformFee}
          onChangeText={setPlatformFee}
          keyboardType="decimal-pad"
          placeholder="0"
        />
        <FormField
          label="Referral fee ($)"
          value={referralFee}
          onChangeText={setReferralFee}
          keyboardType="decimal-pad"
          placeholder="0"
        />
        {platformFeeCents + referralFeeCents > 0 ? (
          <FormField
            label="Fee recipient"
            value={feeRecipient}
            onChangeText={setFeeRecipient}
            placeholder="Who receives the fee?"
            maxLength={200}
          />
        ) : null}
        {localError ? <InlineFeedback message={localError} /> : null}
        <Button
          full
          label="Record quote"
          onPress={() => {
            setLocalError(null);
            record.mutate();
          }}
          pending={record.isPending}
        />
      </SheetScroll>
    </Sheet>
  );
}

function WorkOrderSection({
  schemeId,
  workOrders,
  query,
  focus,
  onChange,
}: {
  schemeId: string;
  workOrders: WorkOrder[];
  query: ReturnType<typeof useQuery<{ workOrders: WorkOrder[] }>>;
  focus: string;
  onChange: () => Promise<unknown>;
}) {
  const [completingId, setCompletingId] = useState<string | null>(null);
  const complete = useMutation({
    mutationFn: (workOrderId: string) =>
      apiPost(`/api/schemes/${schemeId}/work-orders/${workOrderId}/complete`, {}),
    onMutate: (workOrderId) => setCompletingId(workOrderId),
    onSettled: () => setCompletingId(null),
    onSuccess: onChange,
  });

  return (
    <>
      <SectionHeader label="Work orders" />
      {query.isPending ? (
        <RequestSkeleton />
      ) : query.isError && !query.data ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : workOrders.length === 0 ? (
        <EmptyState
          icon="clipboard-outline"
          title="No work orders yet"
          body="Raise one from a triaged request or approve an RFQ award."
        />
      ) : (
        <Card padded={false} style={{ paddingHorizontal: space(4) }}>
          {workOrders.map((workOrder, index) => (
            <WorkOrderRow
              key={workOrder.id}
              workOrder={workOrder}
              highlighted={focus === workOrder.id}
              completing={complete.isPending && completingId === workOrder.id}
              disabled={complete.isPending}
              error={
                complete.isError && complete.variables === workOrder.id
                  ? messageFrom(complete.error, "Couldn't complete this work order.")
                  : null
              }
              onComplete={() => complete.mutate(workOrder.id)}
              divider={index < workOrders.length - 1}
            />
          ))}
        </Card>
      )}
    </>
  );
}

function WorkOrderRow({
  workOrder,
  highlighted,
  completing,
  disabled,
  error,
  onComplete,
  divider,
}: {
  workOrder: WorkOrder;
  highlighted: boolean;
  completing: boolean;
  disabled: boolean;
  error: string | null;
  onComplete: () => void;
  divider: boolean;
}) {
  const theme = useTheme();
  const canComplete = COMPLETABLE_STATUSES.has(workOrder.status);
  return (
    <View
      style={{
        marginHorizontal: highlighted ? -space(4) : 0,
        paddingHorizontal: highlighted ? space(4) : 0,
        paddingVertical: space(3),
        backgroundColor: highlighted ? theme.accentSoft : "transparent",
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: theme.line,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <Text style={{ ...t.body, color: theme.text, flex: 1 }} numberOfLines={2}>
          {workOrder.requestTitle ?? "Work order"}
        </Text>
        <StatusPill tone={statusTone(workOrder.status)} label={humanise(workOrder.status)} />
      </View>
      <Text style={{ ...t.bodySmall, color: theme.text, marginTop: space(2) }}>
        {workOrder.scope}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", marginTop: space(2) }}>
        <Text style={{ ...t.bodySmall, color: theme.muted }}>
          {workOrder.contractorName ?? "Unassigned"} ·{" "}
        </Text>
        <Text style={{ ...t.figureSmall, color: theme.muted }}>
          {money(workOrder.approvedAmountCents)}
        </Text>
      </View>
      {canComplete ? (
        <View style={{ marginTop: space(3), alignItems: "flex-start" }}>
          <Button
            variant="secondary"
            label="Mark complete"
            onPress={onComplete}
            pending={completing}
            disabled={disabled}
          />
        </View>
      ) : null}
      {error ? <InlineFeedback message={error} /> : null}
    </View>
  );
}

function ContractorSection({
  schemeId,
  contractors,
  query,
  onChange,
}: {
  schemeId: string;
  contractors: Contractor[];
  query: ReturnType<typeof useQuery<{ contractors: Contractor[] }>>;
  onChange: () => Promise<unknown>;
}) {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [trades, setTrades] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const categories = trades
    .split(",")
    .map((trade) => trade.trim().toLowerCase())
    .filter(Boolean);

  const create = useMutation({
    mutationFn: async () => {
      if (businessName.trim().length < 2) throw new Error("Enter the business name.");
      if (email.trim() && !EMAIL_LIKE.test(email.trim())) {
        throw new Error("Enter a valid email address.");
      }
      if (categories.length === 0) throw new Error("List at least one trade.");
      return apiPost(`/api/schemes/${schemeId}/contractors`, {
        businessName: businessName.trim(),
        ...(email.trim() ? { email: email.trim().toLowerCase() } : {}),
        tradeCategories: categories,
      });
    },
    onSuccess: async () => {
      setBusinessName("");
      setEmail("");
      setTrades("");
      setLocalError(null);
      setVisible(false);
      await onChange();
    },
    onError: (error) => setLocalError(messageFrom(error, "Couldn't add the contractor.")),
  });

  return (
    <>
      <SectionHeader
        label="Contractor pool"
        right={<QuietAction label="New contractor" onPress={() => setVisible(true)} />}
      />
      {query.isPending ? (
        <RequestSkeleton />
      ) : query.isError && !query.data ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : contractors.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title="No contractors yet"
          body="Add your regular trades so the dispatch agent can request quotes."
        />
      ) : (
        <Card padded={false} style={{ paddingHorizontal: space(4) }}>
          {contractors.map((contractor, index) => (
            <View
              key={contractor.id}
              style={{
                paddingVertical: space(3),
                borderBottomWidth: index < contractors.length - 1 ? StyleSheet.hairlineWidth : 0,
                borderBottomColor: theme.line,
              }}
            >
              <Text style={{ ...t.body, color: theme.text }}>{contractor.businessName}</Text>
              <Text style={{ ...t.caption, color: theme.muted, marginTop: 2 }}>
                {contractor.email ?? "No email on file"}
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: space(2),
                  marginTop: space(2),
                }}
              >
                {contractor.tradeCategories.map((trade) => (
                  <StatusPill key={trade} tone="info" label={humanise(trade)} />
                ))}
              </View>
            </View>
          ))}
        </Card>
      )}

      <Sheet visible={visible} onClose={() => setVisible(false)}>
        <SheetScroll>
          <SheetHeading
            title="Add a contractor"
            body="Add a regular trade to the scheme pool, ready for RFQs and work orders."
          />
          <FormField
            label="Business name"
            value={businessName}
            onChangeText={setBusinessName}
            placeholder="e.g. Northcote Plumbing"
            maxLength={200}
          />
          <FormField
            label="Email (optional)"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="trades@example.com"
          />
          <FormField
            label="Trades (comma-separated)"
            value={trades}
            onChangeText={setTrades}
            placeholder="plumbing, drainage"
          />
          {localError ? <InlineFeedback message={localError} /> : null}
          <Button
            full
            label="Add contractor"
            onPress={() => {
              setLocalError(null);
              create.mutate();
            }}
            pending={create.isPending}
          />
        </SheetScroll>
      </Sheet>
    </>
  );
}

function ChoiceList<T extends { id: string }>({
  label,
  items,
  selected,
  onSelect,
  itemLabel,
  empty,
}: {
  label: string;
  items: T[];
  selected: string;
  onSelect: (id: string) => void;
  itemLabel: (item: T) => string;
  empty?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: space(2) }}>
      <Text style={{ ...t.label, color: theme.muted }}>{label}</Text>
      {items.length === 0 && empty ? (
        <Text style={{ ...t.bodySmall, color: theme.muted }}>{empty}</Text>
      ) : null}
      {items.map((item) => {
        const active = item.id === selected;
        return (
          <PressableScale
            key={item.id}
            onPress={() => onSelect(item.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            style={{
              minHeight: 48,
              justifyContent: "center",
              paddingHorizontal: space(3),
              borderRadius: radius.control,
              borderWidth: 1,
              borderColor: active ? theme.accent : theme.line,
              backgroundColor: active ? theme.accentSoft : theme.surface,
            }}
          >
            <Text style={{ ...t.bodySmall, color: active ? theme.accent : theme.text }}>
              {itemLabel(item)}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

function MultiChoiceList<T extends { id: string }>({
  label,
  items,
  selected,
  onToggle,
  itemLabel,
  disabled,
  empty,
}: {
  label: string;
  items: T[];
  selected: string[];
  onToggle: (id: string) => void;
  itemLabel: (item: T) => string;
  disabled?: (item: T) => boolean;
  empty?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: space(2) }}>
      <Text style={{ ...t.label, color: theme.muted }}>{label}</Text>
      {items.length === 0 && empty ? (
        <Text style={{ ...t.bodySmall, color: theme.muted }}>{empty}</Text>
      ) : null}
      {items.map((item) => {
        const active = selected.includes(item.id);
        const unavailable = disabled?.(item) ?? false;
        return (
          <PressableScale
            key={item.id}
            onPress={() => onToggle(item.id)}
            disabled={unavailable}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: active, disabled: unavailable }}
            style={{
              minHeight: 48,
              justifyContent: "center",
              paddingHorizontal: space(3),
              borderRadius: radius.control,
              borderWidth: 1,
              borderColor: active ? theme.accent : theme.line,
              backgroundColor: active ? theme.accentSoft : theme.surface,
              opacity: unavailable ? 0.55 : 1,
            }}
          >
            <Text style={{ ...t.bodySmall, color: active ? theme.accent : theme.text }}>
              {active ? "✓ " : ""}
              {itemLabel(item)}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

function ToggleOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      style={{
        minHeight: 48,
        justifyContent: "center",
        paddingHorizontal: space(3),
        borderRadius: radius.control,
        borderWidth: 1,
        borderColor: selected ? theme.accent : theme.line,
        backgroundColor: selected ? theme.accentSoft : theme.surface,
      }}
    >
      <Text style={{ ...t.bodySmall, color: selected ? theme.accent : theme.text }}>
        {selected ? "✓ " : ""}
        {label}
      </Text>
    </PressableScale>
  );
}

function QuietAction({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      style={{ minHeight: 44, justifyContent: "center" }}
    >
      <Text style={{ ...t.label, color: theme.accent }}>{label}</Text>
    </PressableScale>
  );
}

function SheetHeading({ title, body }: { title: string; body?: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: space(1) }}>
      <Text style={{ ...t.title, color: theme.text }}>{title}</Text>
      {body ? <Text style={{ ...t.bodySmall, color: theme.muted }}>{body}</Text> : null}
    </View>
  );
}

function SheetScroll({ children }: { children: ReactNode }) {
  const { height } = useWindowDimensions();
  return (
    <ScrollView
      style={{ maxHeight: height * 0.72 }}
      contentContainerStyle={{ gap: space(3) }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

function InlineFeedback({ message, tone = "crit" }: { message: string; tone?: "ok" | "crit" }) {
  const theme = useTheme();
  return (
    <Text
      accessibilityRole="alert"
      style={{ ...t.bodySmall, color: tone === "ok" ? theme.ok : theme.crit, marginTop: space(1) }}
    >
      {message}
    </Text>
  );
}
