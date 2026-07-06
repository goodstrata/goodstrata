import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, ClipboardList, KeyRound, MapPin, Wallet } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DescriptionItem, DescriptionList } from "@/components/ui/description-list";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormMessage } from "@/components/ui/form-message";
import { RegistryPlate } from "@/components/ui/registry-plate";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/work-order/$token")({
  component: WorkOrderPage,
});

/** Statuses the backend reports for a work order (schema enum, contract §2.2). */
type WorkOrderStatus =
  | "draft"
  | "dispatched"
  | "accepted"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "verified"
  | "cancelled";

interface WorkOrderPreview {
  scope: string;
  /** Server-escaped + whitelisted HTML — safe to inject (see markdown.ts). */
  scopeHtml: string;
  /** Full post-award address reveal: "addressLine1, suburb". Null if unset. */
  address: string | null;
  /** "Lot N" or "Common property". */
  location: string;
  approvedAmountCents: number;
  approvedAmountFormatted: string;
  accessNotes: string | null;
  status: WorkOrderStatus;
}

type PostResult = { workOrder?: { workOrderId?: string; status?: WorkOrderStatus } };

/** Distinguishes an unknown/invalid token from a transient failure or a 429. */
type TokenErrorKind = "not_found" | "rate_limited" | "error";
class TokenError extends Error {
  kind: TokenErrorKind;
  constructor(kind: TokenErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

const ACCEPTED_STATUSES: readonly WorkOrderStatus[] = [
  "accepted",
  "scheduled",
  "in_progress",
  "completed",
  "verified",
];

/** Prose typography for the injected scope HTML, matching the app's Markdown. */
const SCOPE_PROSE = cn(
  "prose prose-sm prose-neutral max-w-none dark:prose-invert",
  "[--tw-prose-body:var(--color-foreground)] [--tw-prose-headings:var(--color-foreground)]",
  "[--tw-prose-invert-body:var(--color-foreground)] [--tw-prose-invert-headings:var(--color-foreground)]",
  "prose-headings:font-semibold prose-headings:tracking-tight",
  "prose-p:leading-relaxed prose-li:my-0.5 break-words",
);

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-xl space-y-6">{children}</div>;
}

function WorkOrderPage() {
  const { token } = Route.useParams();
  const [outcome, setOutcome] = useState<"accepted" | "declined" | null>(null);

  const {
    data: wo,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["work-order-preview", token],
    queryFn: async (): Promise<WorkOrderPreview> => {
      const res = await fetch(`/api/work-order/${encodeURIComponent(token)}`);
      if (res.status === 404)
        throw new TokenError("not_found", "This work-order link isn't valid.");
      if (res.status === 429)
        throw new TokenError("rate_limited", "Too many attempts. Wait a moment and try again.");
      if (!res.ok) throw new TokenError("error", "We couldn't load this work order.");
      return (await res.json()) as WorkOrderPreview;
    },
    retry: false,
  });

  const action = useMutation({
    mutationFn: async (act: "accept" | "decline"): Promise<WorkOrderStatus> => {
      const res = await fetch(`/api/work-order/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: act }),
      });
      if (res.status === 429) throw new Error("Too many attempts. Wait a moment and try again.");
      if (!res.ok) throw new Error("We couldn't record that. Try again in a moment.");
      const data = (await res.json()) as PostResult;
      return data.workOrder?.status ?? (act === "accept" ? "accepted" : "cancelled");
    },
    onSuccess: (_status, act) => {
      setOutcome(act === "accept" ? "accepted" : "declined");
      void refetch();
    },
  });

  // Invalid / unknown token — neutral card, no hint whether it ever existed.
  if (isError && error instanceof TokenError && error.kind === "not_found") {
    return (
      <PageShell>
        <EmptyState
          icon={ClipboardList}
          title="This work-order link isn't valid"
          description="Check you opened the most recent link from your email. If you believe this is a mistake, contact the owners corporation."
        />
      </PageShell>
    );
  }
  if (isError) {
    return (
      <PageShell>
        <ErrorState
          title="Work order unavailable"
          message={error instanceof Error ? error.message : "We couldn't load this work order."}
          onRetry={() => void refetch()}
        />
      </PageShell>
    );
  }
  if (isPending || !wo) {
    return (
      <PageShell>
        <div className="space-y-3">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-8 w-64 max-w-full" />
        </div>
        <Skeleton className="h-56 w-full" />
      </PageShell>
    );
  }

  const isActionable = wo.status === "dispatched";
  const isAlreadyAccepted = ACCEPTED_STATUSES.includes(wo.status);
  const isCancelled = wo.status === "cancelled";
  // A leaked token that reaches the "draft" state is defensive only — the token
  // is emailed on dispatch, so in practice this is never reached in the wild.
  const isDraft = wo.status === "draft";

  // Terminal done states after this session's own accept/decline.
  const doneState = outcome
    ? outcome === "accepted"
      ? {
          tone: "positive" as const,
          title: "You've accepted this work order",
          body: "Thanks. Carry out the work as scoped, then invoice the owners corporation on completion, quoting this work order.",
        }
      : {
          tone: "critical" as const,
          title: "You've declined this work order",
          body: "The owners corporation has been notified and will make other arrangements.",
        }
    : null;

  return (
    <PageShell>
      <RegistryPlate
        eyebrow="Work order · awarded"
        name="Work order"
        meta={wo.location}
        badge={<StatusBadge status={wo.status} outcome={outcome} />}
      />

      {/* Post-award address reveal — the one place the exact address is shown. */}
      {wo.address && (
        <div className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3.5">
          <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Property address</p>
            <p className="font-medium break-words">{wo.address}</p>
            <p className="text-sm text-muted-foreground">{wo.location}</p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Scope of work</CardTitle>
          <CardDescription>What the owners corporation has approved for this job.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {wo.scopeHtml ? (
            // scopeHtml is server-side escaped + tag-whitelisted (markdown.ts) — safe to inject.
            <div className={SCOPE_PROSE} dangerouslySetInnerHTML={{ __html: wo.scopeHtml }} />
          ) : (
            <p className="text-sm whitespace-pre-wrap break-words">{wo.scope}</p>
          )}

          <DescriptionList>
            <DescriptionItem label="Approved amount">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <Wallet aria-hidden="true" className="size-3.5 text-muted-foreground" />
                {wo.approvedAmountFormatted}
              </span>
              <p className="mt-0.5 text-13 text-muted-foreground">
                Do not exceed this without written approval from the owners corporation.
              </p>
            </DescriptionItem>
            {wo.accessNotes && (
              <DescriptionItem label="Access">
                <span className="inline-flex items-start gap-1.5">
                  <KeyRound
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="break-words">{wo.accessNotes}</span>
                </span>
              </DescriptionItem>
            )}
          </DescriptionList>
        </CardContent>
      </Card>

      {/* Outcome / action states. */}
      {doneState ? (
        <DoneCard tone={doneState.tone} title={doneState.title} body={doneState.body} />
      ) : isActionable ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Do you accept this work order?</CardTitle>
            <CardDescription>
              Accepting confirms you'll carry out the work as scoped. Declining lets the owners
              corporation make other arrangements.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {action.error && <FormMessage>{action.error.message}</FormMessage>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="sm:flex-1"
                pending={action.isPending && action.variables === "accept"}
                disabled={action.isPending}
                onClick={() => action.mutate("accept")}
              >
                Accept work order
              </Button>
              <Button
                variant="outline"
                className="sm:flex-1"
                pending={action.isPending && action.variables === "decline"}
                disabled={action.isPending}
                onClick={() => action.mutate("decline")}
              >
                Decline
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : isAlreadyAccepted ? (
        <DoneCard
          tone="positive"
          title="This work order is already accepted"
          body="You're the awarded contractor. Carry out the work as scoped, then invoice the owners corporation on completion, quoting this work order."
        />
      ) : isCancelled ? (
        <DoneCard
          tone="critical"
          title="This work order is no longer active"
          body="Contact the owners corporation if you believe this is a mistake."
        />
      ) : isDraft ? (
        <DoneCard
          tone="neutral"
          title="This work order isn't ready to action yet"
          body="It hasn't been dispatched. Wait for the dispatch email, or contact the owners corporation."
        />
      ) : null}
    </PageShell>
  );
}

function StatusBadge({
  status,
  outcome,
}: {
  status: WorkOrderStatus;
  outcome: "accepted" | "declined" | null;
}) {
  if (outcome === "accepted" || ACCEPTED_STATUSES.includes(status))
    return <Badge tone="positive">Accepted</Badge>;
  if (outcome === "declined" || status === "cancelled")
    return <Badge tone="critical">Not active</Badge>;
  if (status === "dispatched") return <Badge tone="info">Awaiting your response</Badge>;
  return <Badge tone="neutral">Pending</Badge>;
}

function DoneCard({
  tone,
  title,
  body,
}: {
  tone: "positive" | "critical" | "neutral";
  title: string;
  body: string;
}) {
  const border =
    tone === "positive"
      ? "border-positive/25 bg-positive/8"
      : tone === "critical"
        ? "border-critical/25 bg-critical/8"
        : "border-neutral-tone/25 bg-neutral-tone/8";
  const iconColor =
    tone === "positive"
      ? "text-positive"
      : tone === "critical"
        ? "text-critical"
        : "text-neutral-tone";
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-4", border)}>
      <CheckCircle2 aria-hidden="true" className={cn("mt-0.5 size-5 shrink-0", iconColor)} />
      <div className="min-w-0 space-y-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
