import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronDown, ChevronUp, FileSearch, Gavel, HardHat, Plus, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Markdown } from "@/components/Markdown";
import { StatusBadge } from "@/components/StatusBadge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { Money } from "@/components/ui/money";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";
import { formatDate } from "@/lib/format";

// ---------------------------------------------------------------------------
// Types mirroring tradeRfqService's read shapes (listRfqs / getRfq).
// ---------------------------------------------------------------------------

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

/** Comparison row — the fee columns are always present, never optional. */
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

interface Contractor {
  id: string;
  businessName: string;
  tradeCategories: string[];
  email: string | null;
}

/**
 * The RFQ endpoints ship in a parallel API workstream, so they are not in the
 * typed `Api` client yet. Same-origin fetch matches the hc() runtime exactly;
 * swap to `api.schemes[":schemeId"].rfqs…` once the routes land in `Api`.
 */
async function rfqRequest<T>(path: string, body?: unknown): Promise<T> {
  return unwrap<T>(
    await fetch(`/api/schemes/${path}`, {
      credentials: "include",
      ...(body !== undefined
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    }),
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  scheme_book: "contractor book",
  email_rfq: "email invite",
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider.replace(/_/g, " ");
}

function useContractors(schemeId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["contractors", schemeId],
    queryFn: async () =>
      unwrap<{ contractors: Contractor[] }>(
        await api.schemes[":schemeId"].contractors.$get({ param: { schemeId } }),
      ),
    enabled,
  });
}

// ---------------------------------------------------------------------------
// "Get quotes" — creates the RFQ (the agent starts drafting the anonymized
// scope immediately) and opens the review-and-send dialog on it.
// ---------------------------------------------------------------------------

export function RequestQuotesButton({
  schemeId,
  requestId,
  onChange,
}: {
  schemeId: string;
  requestId: string;
  onChange: () => void;
}) {
  const [rfqId, setRfqId] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: async () =>
      rfqRequest<{ rfq: { id: string } }>(`${schemeId}/requests/${requestId}/rfq`, {}),
    onSuccess: ({ rfq }) => {
      toast.success("Request for quotes created — the agent is drafting the scope");
      setRfqId(rfq.id);
      onChange();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        data-testid="rfq-get-quotes"
        onClick={() => create.mutate()}
        pending={create.isPending}
      >
        <Send aria-hidden="true" className="size-4" /> Get quotes
      </Button>
      {rfqId && (
        <SendRfqDialog
          schemeId={schemeId}
          rfqId={rfqId}
          open
          expectDrafting
          onOpenChange={(open) => {
            if (!open) setRfqId(null);
          }}
          onChange={onChange}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Review and send — editable scope preview plus channel checkboxes. The scope
// is scrubbed server-side; only suburb-level location leaves the platform.
// ---------------------------------------------------------------------------

const EMAIL_LIKE = /^\S+@\S+\.\S+$/;

/**
 * A freshly-created RFQ carries a stub scope (built straight from the request)
 * until the maintenance agent redrafts it. The stub always ends with this line,
 * which the agent's rewrite drops — so its presence is a reliable "still
 * drafting" signal without any new backend flag. Belt-and-braces: the overlay
 * also times out so a failed draft never leaves it spinning forever.
 */
const SPEC_STUB_MARKER = "exact address is shared with the successful contractor after award";
const specIsStub = (spec: string) => spec.includes(SPEC_STUB_MARKER);
const DRAFTING_TIMEOUT_MS = 40_000;

function SendRfqDialog({
  schemeId,
  rfqId,
  open,
  onOpenChange,
  onChange,
  expectDrafting = false,
}: {
  schemeId: string;
  rfqId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: () => void;
  /** True when opened right after creation, so the agent is actively drafting. */
  expectDrafting?: boolean;
}) {
  // Edits are overlays: null means "follow the server draft", so the agent's
  // spec streams into the preview until the officer starts typing.
  const [editedTitle, setEditedTitle] = useState<string | null>(null);
  const [editedSpec, setEditedSpec] = useState<string | null>(null);
  const [editedDueOn, setEditedDueOn] = useState<string | null>(null);
  const [selectedContractors, setSelectedContractors] = useState<string[]>([]);
  const [inviteText, setInviteText] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const dirty = editedTitle !== null || editedSpec !== null;
  const detail = useQuery({
    queryKey: ["rfq", schemeId, rfqId],
    queryFn: async () => rfqRequest<RfqDetailPayload>(`${schemeId}/rfqs/${rfqId}`),
    enabled: open,
    refetchInterval: open && !dirty ? 2000 : false,
  });
  const contractorsQuery = useContractors(schemeId, open);
  const pool = contractorsQuery.data?.contractors ?? [];

  const rfq = detail.data?.rfq;
  const title = editedTitle ?? rfq?.title ?? "";
  const spec = editedSpec ?? rfq?.specMd ?? "";
  const dueOn = editedDueOn ?? rfq?.quotesDueOn ?? "";

  // Show the generating overlay while the agent's real scope is still on its
  // way: only when we opened expecting a draft, the officer hasn't started
  // editing, and the spec is still the stub. Auto-clears when the redraft lands
  // (spec no longer stub), when they type, or after a timeout as a safety net.
  const [draftTimedOut, setDraftTimedOut] = useState(false);
  useEffect(() => {
    if (!expectDrafting) return;
    const t = setTimeout(() => setDraftTimedOut(true), DRAFTING_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [expectDrafting]);
  const drafting =
    expectDrafting &&
    !draftTimedOut &&
    editedSpec === null &&
    rfq?.status === "draft" &&
    specIsStub(spec);

  const send = useMutation({
    mutationFn: async () => {
      const invitedEmails = inviteText
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const invalid = invitedEmails.filter((e) => !EMAIL_LIKE.test(e));
      if (invalid.length > 0) {
        throw new Error(`Check these email addresses: ${invalid.join(", ")}`);
      }
      if (selectedContractors.length + invitedEmails.length === 0) {
        throw new Error("Pick at least one contractor or add an email to invite.");
      }
      if (title.trim().length < 3) throw new Error("Give the request a short title.");
      if (spec.trim().length < 20) {
        throw new Error("The scope of works needs more detail before it can be sent.");
      }
      if (dirty || (editedDueOn !== null && editedDueOn !== (rfq?.quotesDueOn ?? ""))) {
        await rfqRequest(`${schemeId}/rfqs/${rfqId}/spec`, {
          title: title.trim(),
          specMd: spec,
          category: rfq?.category ?? "general",
          ...(dueOn ? { quotesDueOn: dueOn } : {}),
        });
      }
      return rfqRequest<{ result: { channelsSent: number; channelsFailed: number } }>(
        `${schemeId}/rfqs/${rfqId}/dispatch`,
        { contractorIds: selectedContractors, invitedEmails, broadcastProviders: [] },
      );
    },
    onSuccess: ({ result: { channelsSent, channelsFailed } }) => {
      if (channelsFailed > 0) {
        toast.warning(
          `Request for quotes sent — ${channelsSent} delivered, ${channelsFailed} failed. Check the channel list.`,
        );
      } else {
        toast.success(
          `Request for quotes sent to ${channelsSent} recipient${channelsSent === 1 ? "" : "s"}`,
        );
      }
      onOpenChange(false);
      onChange();
    },
    onError: (e) => setFormError(e.message),
  });

  const toggleContractor = (id: string) => {
    setSelectedContractors((current) =>
      current.includes(id) ? current.filter((c) => c !== id) : [...current, id],
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Review and send the request for quotes</DialogTitle>
          <DialogDescription>
            Contractors see the scope and suburb only — no names, contact details or exact address
            until the committee awards the job.
          </DialogDescription>
        </DialogHeader>
        {detail.isLoading && <Skeleton className="h-48" />}
        {detail.isError && (
          <ErrorState
            message="Couldn't load the request for quotes."
            onRetry={() => void detail.refetch()}
          />
        )}
        {rfq && rfq.status !== "draft" && (
          <Alert tone="info">
            <Send aria-hidden="true" />
            <AlertTitle>Already sent</AlertTitle>
            <AlertDescription>This request has already gone out to contractors.</AlertDescription>
          </Alert>
        )}
        {rfq && rfq.status === "draft" && (
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
            <p className="flex items-center gap-1.5 text-xs text-agent">
              <Bot aria-hidden="true" className="size-3.5" />
              Drafted by the maintenance agent and scrubbed of personal details — edit anything
              before sending.
            </p>
            <Field label="Title" required>
              {(controlProps) => (
                <Input
                  {...controlProps}
                  data-testid="rfq-title"
                  value={title}
                  onChange={(e) => setEditedTitle(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Scope of works"
              required
              hint={`Sent as written. Trade: ${rfq.category} · Location shared: ${rfq.suburb} (suburb only).`}
            >
              {(controlProps) => (
                <MarkdownEditor
                  {...controlProps}
                  data-testid="rfq-spec"
                  textareaClassName="min-h-40 font-mono text-xs"
                  value={spec}
                  onValueChange={setEditedSpec}
                  loading={drafting}
                  loadingLabel="The agent is drafting the scope…"
                />
              )}
            </Field>
            <Field label="Quotes due" hint="Optional — a due date is included in the invitation.">
              {(controlProps) => (
                <Input
                  {...controlProps}
                  data-testid="rfq-due"
                  type="date"
                  value={dueOn}
                  onChange={(e) => setEditedDueOn(e.target.value)}
                />
              )}
            </Field>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-13 font-medium">Send to your contractors</legend>
              {contractorsQuery.isLoading && <Skeleton className="h-10" />}
              {!contractorsQuery.isLoading && pool.length === 0 && (
                <p className="text-13 text-muted-foreground">
                  No contractors in the pool yet — invite by email below.
                </p>
              )}
              {pool.map((c) => (
                <label
                  key={c.id}
                  className="flex items-start gap-2.5 text-sm has-disabled:opacity-60"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-primary"
                    data-testid={`rfq-contractor-${c.businessName}`}
                    checked={selectedContractors.includes(c.id)}
                    disabled={!c.email}
                    onChange={() => toggleContractor(c.id)}
                  />
                  <span>
                    {c.businessName}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {c.email ? c.tradeCategories.join(", ") : "no email on file"}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <Field
              label="Invite by email"
              hint="Optional — tradies outside your pool, separated by commas."
            >
              {(controlProps) => (
                <Input
                  {...controlProps}
                  data-testid="rfq-invite-emails"
                  inputMode="email"
                  placeholder="quotes@plumberco.example, sam@sparkies.example"
                  value={inviteText}
                  onChange={(e) => setInviteText(e.target.value)}
                />
              )}
            </Field>
            {formError && <FormMessage>{formError}</FormMessage>}
          </div>
        )}
        <DialogFooter>
          <Button
            data-testid="rfq-send"
            onClick={() => {
              setFormError(null);
              send.mutate();
            }}
            pending={send.isPending}
            disabled={rfq?.status !== "draft"}
          >
            <Send aria-hidden="true" className="size-4" /> Send request for quotes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Section — list of RFQs with expandable quote comparison.
// ---------------------------------------------------------------------------

export function RfqSection({
  schemeId,
  isOfficer,
  onChange,
}: {
  schemeId: string;
  isOfficer: boolean;
  onChange: () => void;
}) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["rfqs", schemeId],
    queryFn: async () => rfqRequest<{ rfqs: Rfq[] }>(`${schemeId}/rfqs`),
    refetchInterval: 3000,
  });

  return (
    <section>
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <FileSearch aria-hidden="true" className="size-4 text-muted-foreground" /> Requests for
        quotes
      </h2>
      <p className="text-sm text-muted-foreground">
        The agent drafts an anonymized scope; contractors quote; the committee awards.
      </p>
      <div className="mt-4 space-y-2.5">
        {isLoading && <Skeleton className="h-24" />}
        {isError && (
          <ErrorState message="Couldn't load requests for quotes." onRetry={() => void refetch()} />
        )}
        {data?.rfqs.length === 0 && (
          <EmptyState
            icon={FileSearch}
            title="No requests for quotes yet"
            description={
              isOfficer
                ? "Use “Get quotes” on a triaged request to invite competing quotes."
                : "When the committee requests quotes for a job, they appear here."
            }
          />
        )}
        {data?.rfqs.map((rfq) => (
          <RfqCard
            key={rfq.id}
            schemeId={schemeId}
            rfq={rfq}
            isOfficer={isOfficer}
            onChange={onChange}
          />
        ))}
      </div>
    </section>
  );
}

function RfqCard({
  schemeId,
  rfq,
  isOfficer,
  onChange,
}: {
  schemeId: string;
  rfq: Rfq;
  isOfficer: boolean;
  onChange: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const Chevron = expanded ? ChevronUp : ChevronDown;

  return (
    <Card data-testid={`rfq-${rfq.title}`} className="py-4">
      <CardContent className="px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{rfq.title}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span className="font-medium">{rfq.category}</span>
              <span>{rfq.suburb}</span>
              {rfq.requestTitle && <span className="truncate">for “{rfq.requestTitle}”</span>}
              {rfq.quotesDueOn && <span>quotes due {formatDate(rfq.quotesDueOn)}</span>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <StatusBadge status={rfq.status} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {isOfficer && rfq.status === "draft" && (
            <>
              <Button
                size="sm"
                variant="outline"
                data-testid="rfq-review-send"
                onClick={() => setSendOpen(true)}
              >
                <Send aria-hidden="true" className="size-4" /> Review and send
              </Button>
              {sendOpen && (
                <SendRfqDialog
                  schemeId={schemeId}
                  rfqId={rfq.id}
                  open={sendOpen}
                  onOpenChange={setSendOpen}
                  onChange={onChange}
                />
              )}
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            data-testid="rfq-toggle-detail"
            aria-expanded={expanded}
            onClick={() => setExpanded((e) => !e)}
          >
            <Chevron aria-hidden="true" className="size-4" />
            {rfq.quoteCount === 1 ? "1 quote" : `${rfq.quoteCount} quotes`}
          </Button>
        </div>
        {expanded && (
          <RfqDetail schemeId={schemeId} rfqId={rfq.id} isOfficer={isOfficer} onChange={onChange} />
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Detail — scope, channels, and the quote comparison table. Fee disclosure is
// unconditional: any nonzero fee renders loud and amber. No prop hides it.
// ---------------------------------------------------------------------------

function RfqDetail({
  schemeId,
  rfqId,
  isOfficer,
  onChange,
}: {
  schemeId: string;
  rfqId: string;
  isOfficer: boolean;
  onChange: () => void;
}) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["rfq", schemeId, rfqId],
    queryFn: async () => rfqRequest<RfqDetailPayload>(`${schemeId}/rfqs/${rfqId}`),
    refetchInterval: 3000,
  });

  if (isLoading) return <Skeleton className="mt-3 h-32" />;
  if (isError || !data) {
    return (
      <div className="mt-3">
        <ErrorState message="Couldn't load the quote detail." onRetry={() => void refetch()} />
      </div>
    );
  }

  const { rfq, channels, quotes } = data;
  const sentChannels = channels.filter((c) => c.status !== "failed");
  const quotesWithFees = quotes.filter((q) => q.platformFeeCents + q.referralFeeCents > 0);
  const quotable = rfq.status === "published" || rfq.status === "quoting";

  return (
    <div className="mt-4 space-y-4 border-t pt-4">
      <details className="group">
        <summary className="cursor-pointer text-13 font-medium text-muted-foreground select-none">
          Scope of works sent to contractors
        </summary>
        <div className="mt-2 rounded-md bg-muted/50 p-3">
          <Markdown className="prose-sm">{rfq.specMd}</Markdown>
        </div>
      </details>

      {channels.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-13 text-muted-foreground">Channels:</span>
          {channels.map((channel) => (
            <Badge
              key={channel.id}
              tone={
                channel.status === "failed"
                  ? "critical"
                  : channel.status === "responded"
                    ? "positive"
                    : "info"
              }
            >
              {providerLabel(channel.provider)} · {channel.status}
            </Badge>
          ))}
        </div>
      )}

      {quotesWithFees.length > 0 && (
        <Alert tone="caution" data-testid="rfq-fee-alert">
          <Gavel aria-hidden="true" />
          <AlertTitle>Fee disclosure</AlertTitle>
          <AlertDescription>
            {quotesWithFees.map((q) => (
              <p key={q.quoteId} className="font-medium text-caution">
                {q.contractorName}: {q.feeDisclosure}
              </p>
            ))}
            <p>These fees are shown to the committee on the award decision and the audit log.</p>
          </AlertDescription>
        </Alert>
      )}

      {quotes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {sentChannels.length > 0
            ? `No quotes yet — invitations sent to ${sentChannels.length} contractor${sentChannels.length === 1 ? "" : "s"}.`
            : "No quotes yet — this request hasn't been sent to anyone."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contractor</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Fees</TableHead>
              <TableHead>Checks</TableHead>
              <TableHead>Valid until</TableHead>
              <TableHead>Status</TableHead>
              {isOfficer && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotes.map((quote) => (
              <TableRow key={quote.quoteId} data-testid={`rfq-quote-${quote.contractorName}`}>
                <TableCell className="font-medium">{quote.contractorName}</TableCell>
                <TableCell className="text-right">
                  <Money cents={quote.amountCents} />
                </TableCell>
                <TableCell>
                  {quote.platformFeeCents + quote.referralFeeCents > 0 ? (
                    <Badge tone="caution" className="font-medium">
                      {quote.feeDisclosure}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">none</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1">
                    <Badge tone={quote.licenceConfirmed ? "positive" : "neutral"}>
                      {quote.licenceConfirmed ? "licensed" : "licence unconfirmed"}
                    </Badge>
                    <Badge tone={quote.insuranceConfirmed ? "positive" : "neutral"}>
                      {quote.insuranceConfirmed ? "insured" : "insurance unconfirmed"}
                    </Badge>
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {quote.validUntil ? formatDate(quote.validUntil) : "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge status={quote.status} />
                </TableCell>
                {isOfficer && (
                  <TableCell className="text-right">
                    {quotable && quote.status === "received" && (
                      <RequestAwardDialog
                        schemeId={schemeId}
                        rfqId={rfqId}
                        quote={quote}
                        onChange={onChange}
                      />
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {isOfficer && quotable && (
        <AddQuoteDialog
          schemeId={schemeId}
          rfqId={rfqId}
          category={rfq.category}
          onChange={onChange}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ask the committee to award — opens a decision request; the award itself only
// happens once the committee approves it in Decisions. There is no award
// button anywhere in this file.
// ---------------------------------------------------------------------------

function RequestAwardDialog({
  schemeId,
  rfqId,
  quote,
  onChange,
}: {
  schemeId: string;
  rfqId: string;
  quote: RfqQuote;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const request = useMutation({
    mutationFn: async () =>
      rfqRequest<{ result: { decisionId: string } }>(`${schemeId}/rfqs/${rfqId}/award`, {
        quoteId: quote.quoteId,
      }),
    onSuccess: () => {
      setOpen(false);
      toast.success("Award request sent to the committee for approval");
      void queryClient.invalidateQueries({ queryKey: ["decisions", schemeId] });
      onChange();
    },
    onError: (e) => toast.error(e.message),
  });
  const hasFees = quote.platformFeeCents + quote.referralFeeCents > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid="rfq-request-award">
          <Gavel aria-hidden="true" className="size-4" /> Ask the committee to award
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ask the committee to award this quote?</DialogTitle>
          <DialogDescription>
            This sends a decision request to the committee — nothing is awarded until a majority
            approves it under Decisions.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            Nominate <span className="font-medium">{quote.contractorName}</span> for{" "}
            <Money cents={quote.amountCents} className="font-medium" />. On approval, a work order
            is created for the quoted amount and the contractor receives the full property address.
          </p>
          {hasFees && (
            <Alert tone="caution">
              <Gavel aria-hidden="true" />
              <AlertTitle>Disclosed fees</AlertTitle>
              <AlertDescription>
                <p className="font-medium text-caution">{quote.feeDisclosure}</p>
                <p>The committee sees this on the decision.</p>
              </AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button
            data-testid="rfq-request-award-confirm"
            onClick={() => request.mutate()}
            pending={request.isPending}
          >
            Send to the committee
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Manual quote entry — phone/paper quotes. The fee fields are always in the
// form (defaulting to 0) so a quote with a referral kickback cannot be entered
// fee-blind.
// ---------------------------------------------------------------------------

const EXTERNAL = "external";

const dollarsField = (message: string, { positive = false } = {}) =>
  z
    .string()
    .trim()
    .refine(
      (v) =>
        v === ""
          ? !positive
          : Number.isFinite(Number(v)) && (positive ? Number(v) > 0 : Number(v) >= 0),
      message,
    );

const feeCents = (v: string) => (v.trim() === "" ? 0 : Math.round(Number(v) * 100));

const addQuoteSchema = z
  .object({
    source: z.string().min(1, "Choose who the quote is from."),
    businessName: z.string().trim(),
    email: z.union([z.literal(""), z.email("Enter a valid email, like trades@example.com.")]),
    phone: z.string().trim(),
    amount: dollarsField("Enter the quoted amount in dollars.", { positive: true }),
    validUntil: z.string(),
    notes: z.string().trim().max(5000, "Keep notes under 5,000 characters."),
    licenceConfirmed: z.boolean(),
    insuranceConfirmed: z.boolean(),
    platformFee: dollarsField("Enter the platform fee in dollars, or leave it empty."),
    referralFee: dollarsField("Enter the referral fee in dollars, or leave it empty."),
    feeRecipient: z.string().trim(),
  })
  .refine((v) => v.source !== EXTERNAL || v.businessName.length >= 2, {
    message: "Enter the tradie's business name.",
    path: ["businessName"],
  })
  .refine(
    (v) => feeCents(v.platformFee) + feeCents(v.referralFee) === 0 || v.feeRecipient.length >= 2,
    {
      message: "Name who receives the fee — fees can't be recorded without a recipient.",
      path: ["feeRecipient"],
    },
  );

function AddQuoteDialog({
  schemeId,
  rfqId,
  category,
  onChange,
}: {
  schemeId: string;
  rfqId: string;
  category: string;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const contractorsQuery = useContractors(schemeId, open);
  const pool = contractorsQuery.data?.contractors ?? [];

  const record = useMutation({
    mutationFn: async (values: z.infer<typeof addQuoteSchema>) =>
      rfqRequest(`${schemeId}/rfqs/${rfqId}/quotes`, {
        ...(values.source === EXTERNAL
          ? {
              contact: {
                businessName: values.businessName,
                ...(values.email ? { email: values.email } : {}),
                ...(values.phone ? { phone: values.phone } : {}),
              },
            }
          : { contractorId: values.source }),
        amountCents: Math.round(Number(values.amount) * 100),
        ...(values.validUntil ? { validUntil: values.validUntil } : {}),
        ...(values.notes ? { notes: values.notes } : {}),
        licenceConfirmed: values.licenceConfirmed,
        insuranceConfirmed: values.insuranceConfirmed,
        platformFeeCents: feeCents(values.platformFee),
        referralFeeCents: feeCents(values.referralFee),
        ...(values.feeRecipient ? { feeRecipient: values.feeRecipient } : {}),
      }),
    onSuccess: () => {
      setOpen(false);
      form.reset();
      toast.success("Quote recorded");
      onChange();
    },
  });
  const form = useAppForm({
    schema: addQuoteSchema,
    defaultValues: {
      source: "",
      businessName: "",
      email: "",
      phone: "",
      amount: "",
      validUntil: "",
      notes: "",
      licenceConfirmed: false,
      insuranceConfirmed: false,
      platformFee: "",
      referralFee: "",
      feeRecipient: "",
    },
    onSubmit: (values) => record.mutateAsync(values),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid="rfq-add-quote">
          <Plus aria-hidden="true" className="size-4" /> Add quote
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a quote</DialogTitle>
          <DialogDescription>
            Record a quote received by phone or email. Any platform or referral fee must be
            disclosed — it is shown to the committee and logged.
          </DialogDescription>
        </DialogHeader>
        <form
          id="rfq-quote-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="source">
            {(field) => (
              <Field label="Who is quoting?" required error={fieldError(field.state.meta.errors)}>
                {(controlProps) => (
                  <Select value={field.state.value} onValueChange={field.handleChange}>
                    <SelectTrigger {...controlProps} data-testid="rfq-quote-source">
                      <SelectValue
                        placeholder={
                          contractorsQuery.isLoading
                            ? "Loading contractors…"
                            : "Choose a contractor"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {pool.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.businessName}
                        </SelectItem>
                      ))}
                      <SelectItem value={EXTERNAL}>
                        Someone else (added to the pool as pending)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </Field>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.values.source}>
            {(source) =>
              source === EXTERNAL ? (
                <>
                  <form.Field name="businessName">
                    {(field) => (
                      <Field
                        label="Business name"
                        required
                        error={fieldError(field.state.meta.errors)}
                      >
                        {(controlProps) => (
                          <Input
                            {...controlProps}
                            data-testid="rfq-quote-business"
                            placeholder={`e.g. Westside ${category} Services`}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(e) => field.handleChange(e.target.value)}
                          />
                        )}
                      </Field>
                    )}
                  </form.Field>
                  <div className="grid grid-cols-2 gap-3">
                    <form.Field name="email">
                      {(field) => (
                        <Field label="Email" error={fieldError(field.state.meta.errors)}>
                          {(controlProps) => (
                            <Input
                              {...controlProps}
                              data-testid="rfq-quote-email"
                              type="email"
                              inputMode="email"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) => field.handleChange(e.target.value)}
                            />
                          )}
                        </Field>
                      )}
                    </form.Field>
                    <form.Field name="phone">
                      {(field) => (
                        <Field label="Phone" error={fieldError(field.state.meta.errors)}>
                          {(controlProps) => (
                            <Input
                              {...controlProps}
                              data-testid="rfq-quote-phone"
                              type="tel"
                              inputMode="tel"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) => field.handleChange(e.target.value)}
                            />
                          )}
                        </Field>
                      )}
                    </form.Field>
                  </div>
                </>
              ) : null
            }
          </form.Subscribe>
          <div className="grid grid-cols-2 gap-3">
            <form.Field name="amount">
              {(field) => (
                <Field
                  label="Quoted amount ($)"
                  required
                  error={fieldError(field.state.meta.errors)}
                >
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      data-testid="rfq-quote-amount"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      placeholder="e.g. 850"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  )}
                </Field>
              )}
            </form.Field>
            <form.Field name="validUntil">
              {(field) => (
                <Field label="Valid until" error={fieldError(field.state.meta.errors)}>
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      data-testid="rfq-quote-valid-until"
                      type="date"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  )}
                </Field>
              )}
            </form.Field>
          </div>
          <form.Field name="notes">
            {(field) => (
              <Field label="Notes" error={fieldError(field.state.meta.errors)}>
                {(controlProps) => (
                  <Textarea
                    {...controlProps}
                    data-testid="rfq-quote-notes"
                    className="min-h-16"
                    placeholder="Inclusions, exclusions, lead time…"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                )}
              </Field>
            )}
          </form.Field>
          <div className="flex flex-col gap-2">
            <form.Field name="licenceConfirmed">
              {(field) => (
                <label className="flex items-start gap-2.5 text-13 text-muted-foreground">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-primary"
                    data-testid="rfq-quote-licence"
                    checked={field.state.value}
                    onChange={(e) => field.handleChange(e.target.checked)}
                  />
                  <span>Trade licence sighted and current.</span>
                </label>
              )}
            </form.Field>
            <form.Field name="insuranceConfirmed">
              {(field) => (
                <label className="flex items-start gap-2.5 text-13 text-muted-foreground">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-primary"
                    data-testid="rfq-quote-insurance"
                    checked={field.state.value}
                    onChange={(e) => field.handleChange(e.target.checked)}
                  />
                  <span>Public liability insurance sighted and current.</span>
                </label>
              )}
            </form.Field>
          </div>
          <fieldset className="flex flex-col gap-3 rounded-md border border-caution/25 bg-caution/5 p-3">
            <legend className="px-1 text-13 font-medium">Fee disclosure</legend>
            <p className="text-xs text-muted-foreground">
              Zero hidden margin: if any platform or referral fee applies to this quote, record it
              here with its recipient. It appears on the committee decision and the audit log.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <form.Field name="platformFee">
                {(field) => (
                  <Field label="Platform fee ($)" error={fieldError(field.state.meta.errors)}>
                    {(controlProps) => (
                      <Input
                        {...controlProps}
                        data-testid="rfq-quote-platform-fee"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        placeholder="0"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    )}
                  </Field>
                )}
              </form.Field>
              <form.Field name="referralFee">
                {(field) => (
                  <Field label="Referral fee ($)" error={fieldError(field.state.meta.errors)}>
                    {(controlProps) => (
                      <Input
                        {...controlProps}
                        data-testid="rfq-quote-referral-fee"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        placeholder="0"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    )}
                  </Field>
                )}
              </form.Field>
            </div>
            <form.Field name="feeRecipient">
              {(field) => (
                <Field
                  label="Who receives the fee?"
                  hint="Required whenever either fee is above zero."
                  error={fieldError(field.state.meta.errors)}
                >
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      data-testid="rfq-quote-fee-recipient"
                      placeholder="e.g. TradeMatch Marketplace Pty Ltd"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  )}
                </Field>
              )}
            </form.Field>
          </fieldset>
          <FormError form={form} />
        </form>
        <DialogFooter>
          <SubmitButton form={form} formId="rfq-quote-form">
            <HardHat aria-hidden="true" className="size-4" /> Record quote
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
