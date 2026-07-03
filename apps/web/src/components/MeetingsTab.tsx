import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import {
  Bot,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  Gavel,
  Plus,
  Video,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Markdown } from "@/components/Markdown";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Field, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, unwrap } from "@/lib/api";
import { FormError, fieldError, SubmitButton, useAppForm } from "@/lib/form";
import { formatDateTime, formatTime } from "@/lib/format";
import { useIsOfficer } from "@/lib/roles";
import { useIsMobile } from "@/lib/use-mobile";
import { cn } from "@/lib/utils";

interface Meeting {
  id: string;
  kind: string;
  title: string;
  scheduledAt: string;
  status: string;
  quorumMet: boolean | null;
  minutesDocumentId: string | null;
}
interface Motion {
  id: string;
  title: string;
  text: string;
  resolutionType: string;
  status: string;
  result: { forWeight: number; againstWeight: number; abstainWeight: number } | null;
}
/** AI Chair timeline entry — the backend adds these as the feature lands. */
interface ChairLogEntry {
  at: string;
  kind: string;
  note: string;
}

interface MeetingDetail {
  meeting: Meeting;
  agenda: { id: string; order: number; title: string }[];
  motions: Motion[];
  quorum: { representedEntitlement: number; totalEntitlement: number; quorate: boolean };
  /** Optional until the AI Chair backend ships — render gracefully when absent. */
  chairLog?: ChairLogEntry[] | null;
  transcriptionStarted?: boolean;
}

const MEETING_KINDS = ["agm", "sgm", "committee"] as const;
type MeetingKind = (typeof MEETING_KINDS)[number];

const RESOLUTION_TYPES = ["ordinary", "special"] as const;
type ResolutionType = (typeof RESOLUTION_TYPES)[number];

/** Short type label for the meeting eyebrow (AGM / SGM / Committee). */
function kindLabel(kind: string): string {
  if (kind === "agm") return "AGM";
  if (kind === "sgm") return "SGM";
  if (kind === "committee") return "Committee";
  return kind;
}

const scheduleMeetingSchema = z.object({
  kind: z.enum(MEETING_KINDS),
  title: z.string().min(3, "Give the meeting a title of at least 3 characters."),
  when: z
    .string()
    .refine((v) => v.length > 0 && !Number.isNaN(Date.parse(v)), "Choose a valid date and time."),
  agenda: z.string(),
});
type ScheduleMeetingValues = z.infer<typeof scheduleMeetingSchema>;

const addMotionSchema = z.object({
  title: z.string().min(3, "Give the motion a title of at least 3 characters."),
  text: z.string().min(3, "Describe the motion in at least 3 characters."),
  resolutionType: z.enum(RESOLUTION_TYPES),
});
type AddMotionValues = z.infer<typeof addMotionSchema>;

const routeApi = getRouteApi("/schemes/$schemeId");

export function MeetingsTab({ schemeId }: { schemeId: string }) {
  // Selection lives in the URL (?meeting=…) so deep links and the browser
  // back button work (DESIGN.md §6.1).
  const { meeting } = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const openMeeting = (id: string) =>
    void navigate({ search: (prev) => ({ ...prev, meeting: id }) });
  const back = () => void navigate({ search: (prev) => ({ ...prev, meeting: undefined }) });

  return meeting ? (
    <MeetingDetailView schemeId={schemeId} meetingId={meeting} onBack={back} />
  ) : (
    <MeetingList schemeId={schemeId} onOpen={openMeeting} />
  );
}

/** Side sheet on desktop, bottom sheet on mobile (DESIGN.md §7.2, > 2 fields). */
function useSheetSide() {
  const isMobile = useIsMobile();
  return {
    side: isMobile ? ("bottom" as const) : ("right" as const),
    className: cn(
      "overflow-y-auto",
      isMobile ? "max-h-[85dvh] rounded-t-xl" : "w-full sm:max-w-md",
    ),
  };
}

function ScheduleMeetingSheet({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const sheet = useSheetSide();

  const form = useAppForm({
    schema: scheduleMeetingSchema,
    defaultValues: { kind: "agm", title: "", when: "", agenda: "" } as ScheduleMeetingValues,
    onSubmit: async (values) => {
      await unwrap(
        await api.schemes[":schemeId"].meetings.$post({
          param: { schemeId },
          json: {
            kind: values.kind,
            title: values.title,
            scheduledAt: new Date(values.when).toISOString(),
            agenda: values.agenda
              .split("\n")
              .map((t) => t.trim())
              .filter(Boolean)
              .map((t) => ({ title: t })),
          },
        }),
      );
      toast.success("Meeting scheduled");
      void queryClient.invalidateQueries({ queryKey: ["meetings", schemeId] });
      setOpen(false);
      form.reset();
    },
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> New meeting
        </Button>
      </SheetTrigger>
      <SheetContent side={sheet.side} className={sheet.className}>
        <SheetHeader>
          <SheetTitle>Schedule a meeting</SheetTitle>
          <SheetDescription>
            Notices go out to every member with the agenda attached.
          </SheetDescription>
        </SheetHeader>
        <form
          id="meeting-form"
          className="flex flex-col gap-5 px-4 pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.Field name="kind">
              {(field) => (
                <Field
                  label="Kind"
                  htmlFor="meeting-kind"
                  error={fieldError(field.state.meta.errors)}
                >
                  {(control) => (
                    <Select
                      value={field.state.value}
                      onValueChange={(v) => field.handleChange(v as MeetingKind)}
                    >
                      <SelectTrigger
                        id={control.id}
                        aria-invalid={control["aria-invalid"]}
                        aria-describedby={control["aria-describedby"]}
                        data-testid="meeting-kind"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="agm">Annual general meeting</SelectItem>
                        <SelectItem value="sgm">Special general meeting</SelectItem>
                        <SelectItem value="committee">Committee meeting</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </Field>
              )}
            </form.Field>

            <form.Field name="title">
              {(field) => (
                <Field
                  label="Title"
                  required
                  htmlFor="meeting-title"
                  error={fieldError(field.state.meta.errors)}
                >
                  <Input
                    data-testid="meeting-title"
                    placeholder="e.g. 2026 annual general meeting"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </Field>
              )}
            </form.Field>

            <form.Field name="when">
              {(field) => (
                <Field
                  label="When"
                  required
                  htmlFor="meeting-when"
                  error={fieldError(field.state.meta.errors)}
                >
                  <Input
                    type="datetime-local"
                    data-testid="meeting-when"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </Field>
              )}
            </form.Field>

            <form.Field name="agenda">
              {(field) => (
                <Field
                  label="Agenda"
                  htmlFor="meeting-agenda"
                  hint="One item per line."
                  error={fieldError(field.state.meta.errors)}
                >
                  <Textarea
                    data-testid="meeting-agenda"
                    className="min-h-24"
                    placeholder={"Financial statements\nBudget adoption\nCommittee election"}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </Field>
              )}
            </form.Field>
          </FieldGroup>

          <FormError form={form} />
          <SubmitButton form={form} className="w-full">
            Schedule meeting
          </SubmitButton>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function MeetingList({ schemeId, onOpen }: { schemeId: string; onOpen: (id: string) => void }) {
  const isOfficer = useIsOfficer(schemeId);
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["meetings", schemeId],
    queryFn: async () =>
      unwrap<{ meetings: Meeting[] }>(
        await api.schemes[":schemeId"].meetings.$get({ param: { schemeId } }),
      ),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        as="h2"
        title="Meetings"
        description="AGMs, special general meetings and committee meetings."
        actions={isOfficer ? <ScheduleMeetingSheet schemeId={schemeId} /> : undefined}
      />

      {isPending ? (
        <div className="space-y-2.5">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : isError ? (
        <ErrorState
          message="We couldn't load the meetings for this scheme."
          onRetry={() => void refetch()}
        />
      ) : data.meetings.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No meetings yet"
          description={
            isOfficer
              ? "Schedule the AGM to start the scheme's governance calendar."
              : "You'll be notified when a meeting is scheduled."
          }
        />
      ) : (
        <div className="space-y-2.5">
          {data.meetings.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onOpen(m.id)}
              className="group flex w-full items-center gap-3 rounded-xl border bg-card px-4 py-3.5 text-left shadow-sm outline-none transition-colors hover:border-primary/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <CalendarDays className="size-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <Eyebrow>{kindLabel(m.kind)}</Eyebrow>
                <p className="truncate font-medium">{m.title}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(m.scheduledAt)}</p>
              </div>
              <span className="flex shrink-0 items-center gap-2">
                <StatusBadge status={m.status} />
                <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Video calls: contract-first UI; hides itself if the API doesn't support it yet. */
function VideoCallButtons({
  schemeId,
  meetingId,
  isOfficer,
}: {
  schemeId: string;
  meetingId: string;
  isOfficer: boolean;
}) {
  const [unavailable, setUnavailable] = useState(false);

  const start = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/schemes/${schemeId}/meetings/${meetingId}/video/start`, {
        method: "POST",
        credentials: "include",
      });
      if (res.status === 404) {
        setUnavailable(true);
        throw new Error("Video meetings aren't available yet");
      }
      if (!res.ok) throw new Error(`Could not start the video meeting (${res.status})`);
      return (await res.json()) as { url: string };
    },
    onSuccess: () => toast.success("Video meeting started — members can now join"),
    onError: (e) => toast.error(e.message),
  });

  const join = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/schemes/${schemeId}/meetings/${meetingId}/video/join`, {
        method: "POST",
        credentials: "include",
      });
      if (res.status === 404) {
        setUnavailable(true);
        throw new Error("Video meetings aren't available yet");
      }
      if (!res.ok) throw new Error(`Could not join the video call (${res.status})`);
      return (await res.json()) as { url: string; token: string };
    },
    onSuccess: ({ url, token }) => {
      window.open(`${url}?t=${encodeURIComponent(token)}`, "_blank", "noopener");
    },
    onError: (e) => toast.error(e.message),
  });

  if (unavailable) return null;

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {isOfficer && (
        <Button
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
          onClick={() => start.mutate()}
          pending={start.isPending}
        >
          <Video className="size-4" /> Start video meeting
        </Button>
      )}
      <Button
        size="sm"
        className="w-full sm:w-auto"
        onClick={() => join.mutate()}
        pending={join.isPending}
      >
        <Video className="size-4" /> Join video call
      </Button>
    </div>
  );
}

/**
 * The AI Chair's live timeline: what it observed and did during the meeting.
 * Renders nothing until the backend starts sending chairLog entries.
 */
function ChairLogCard({
  chairLog,
  transcriptionStarted,
}: {
  chairLog: ChairLogEntry[];
  transcriptionStarted: boolean;
}) {
  if (chairLog.length === 0 && !transcriptionStarted) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex size-7 items-center justify-center rounded-lg bg-agent/10 text-agent">
            <Bot className="size-4" />
          </span>
          AI Chair
        </CardTitle>
        {transcriptionStarted && (
          <CardDescription aria-live="polite" className="flex items-center gap-2 text-critical">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-critical opacity-75 motion-reduce:animate-none" />
              <span className="relative inline-flex size-2 rounded-full bg-critical" />
            </span>
            Transcribing the meeting
          </CardDescription>
        )}
      </CardHeader>
      {chairLog.length > 0 && (
        <CardContent>
          <ol aria-live="polite" className="relative space-y-4 border-l border-border pl-5">
            {chairLog.map((entry, i) => (
              <li key={`${entry.at}-${i}`} className="relative space-y-1">
                <span
                  aria-hidden="true"
                  className="absolute top-1 -left-[23px] size-2 rounded-full bg-agent ring-4 ring-card"
                />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge tone="agent" className="capitalize">
                    {entry.kind.replace(/_/g, " ")}
                  </Badge>
                  <time
                    dateTime={entry.at}
                    className="font-mono text-xs text-muted-foreground tabular-nums"
                  >
                    {formatTime(entry.at)}
                  </time>
                </div>
                <Markdown className="text-sm prose-p:my-0">{entry.note}</Markdown>
              </li>
            ))}
          </ol>
        </CardContent>
      )}
    </Card>
  );
}

/** Minutes rendering: probes for a content endpoint and shows a designed state. */
function MinutesSection({ schemeId, documentId }: { schemeId: string; documentId: string }) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["document-content", schemeId, documentId],
    retry: false,
    queryFn: async (): Promise<string | null> => {
      const contentRes = await fetch(`/api/schemes/${schemeId}/documents/${documentId}/content`, {
        credentials: "include",
      });
      if (contentRes.ok) return await contentRes.text();
      const docRes = await fetch(`/api/schemes/${schemeId}/documents/${documentId}`, {
        credentials: "include",
      });
      if (docRes.ok) {
        const body = (await docRes.json()) as {
          document?: { content?: string; contentMd?: string };
        };
        return body.document?.contentMd ?? body.document?.content ?? null;
      }
      if (docRes.status === 403 || docRes.status === 404) return null;
      throw new Error("We couldn't load the minutes.");
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Minutes</CardTitle>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : isError ? (
          <ErrorState
            message="We couldn't load the minutes for this meeting."
            onRetry={() => void refetch()}
          />
        ) : data ? (
          <Markdown>{data}</Markdown>
        ) : (
          <EmptyState
            icon={FileText}
            title="Minutes unavailable"
            description="They may still be in preparation, or you may not have access to them."
          />
        )}
      </CardContent>
    </Card>
  );
}

function MeetingDetailView({
  schemeId,
  meetingId,
  onBack,
}: {
  schemeId: string;
  meetingId: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const isOfficer = useIsOfficer(schemeId);
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["meeting", schemeId, meetingId] });
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["meeting", schemeId, meetingId],
    queryFn: async () =>
      unwrap<MeetingDetail>(
        await api.schemes[":schemeId"].meetings[":meetingId"].$get({
          param: { schemeId, meetingId },
        }),
      ),
    // Poll for live quorum / chair log while the meeting is active; stop once
    // it's closed and nothing changes any more.
    refetchInterval: (query) => {
      const status = query.state.data?.meeting.status;
      return status === "closed" || status === "minutes_distributed" ? false : 3000;
    },
  });

  const sendNotice = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.schemes[":schemeId"].meetings[":meetingId"].notice.$post({
          param: { schemeId, meetingId },
        }),
      ),
    onSuccess: () => {
      toast.success("Notice sent to all members");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const attend = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.schemes[":schemeId"].meetings[":meetingId"].attend.$post({
          param: { schemeId, meetingId },
          json: { mode: "online" },
        }),
      ),
    onSuccess: () => {
      toast.success("Attendance recorded");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const closeMeeting = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.schemes[":schemeId"].meetings[":meetingId"].close.$post({
          param: { schemeId, meetingId },
        }),
      ),
    onSuccess: () => {
      toast.success("Meeting closed — minutes are being drafted");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const backButton = (
    <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
      <ChevronLeft className="size-4" /> All meetings
    </Button>
  );

  if (isPending) {
    return (
      <div className="space-y-5">
        {backButton}
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="space-y-5">
        {backButton}
        <ErrorState message="We couldn't load this meeting." onRetry={() => void refetch()} />
      </div>
    );
  }

  const m = data.meeting;
  const quorumPct =
    data.quorum.totalEntitlement > 0
      ? Math.round((data.quorum.representedEntitlement / data.quorum.totalEntitlement) * 100)
      : 0;
  const meetingOver = m.status === "closed" || m.status === "minutes_distributed";
  const videoEligible =
    (m.kind === "committee" || m.kind === "agm") &&
    (m.status === "notice_sent" || m.status === "in_progress");
  const quorumStatus = meetingOver
    ? data.quorum.quorate
      ? "quorate"
      : "quorum was not reached"
    : data.quorum.quorate
      ? "quorate"
      : "not yet quorate";
  const quorumTone = meetingOver
    ? "text-muted-foreground"
    : data.quorum.quorate
      ? "text-positive"
      : "text-caution";

  return (
    <div className="space-y-5">
      {backButton}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <Eyebrow>{kindLabel(m.kind)}</Eyebrow>
              <CardTitle className="font-display text-xl">{m.title}</CardTitle>
              <CardDescription>{formatDateTime(m.scheduledAt)}</CardDescription>
            </div>
            <StatusBadge status={m.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {m.status === "draft" && isOfficer && (
              <Button
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => sendNotice.mutate()}
                pending={sendNotice.isPending}
              >
                Send notice
              </Button>
            )}
            {m.status === "draft" && !isOfficer && (
              <p className="text-sm text-muted-foreground">
                This meeting is still a draft — the notice hasn't gone out yet.
              </p>
            )}
            {(m.status === "notice_sent" || m.status === "in_progress") && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => attend.mutate()}
                  pending={attend.isPending}
                >
                  I'm attending
                </Button>
                {isOfficer && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto"
                    onClick={() => closeMeeting.mutate()}
                    pending={closeMeeting.isPending}
                  >
                    Close meeting
                  </Button>
                )}
              </>
            )}
          </div>

          {videoEligible && (
            <div className="space-y-2.5 rounded-lg border bg-muted/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Video className="size-4 text-muted-foreground" /> Video call
                </span>
                <Badge tone="agent">
                  <Bot className="size-3" /> AI Chair
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                The AI Chair joins the call to guide the agenda and take the minutes.
              </p>
              <VideoCallButtons schemeId={schemeId} meetingId={meetingId} isOfficer={isOfficer} />
            </div>
          )}

          <div data-testid="quorum" className="space-y-1.5 rounded-lg border p-3">
            <div className="flex items-baseline justify-between gap-2">
              <Eyebrow>{meetingOver ? "Final quorum" : "Quorum"}</Eyebrow>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {quorumPct}%
              </span>
            </div>
            <p className={cn("text-sm", quorumTone)}>
              <span className="font-mono tabular-nums">
                {data.quorum.representedEntitlement}/{data.quorum.totalEntitlement}
              </span>{" "}
              entitlements represented — {quorumStatus}
            </p>
            <Progress value={quorumPct} aria-label={`Quorum ${quorumPct}%`} className="h-1.5" />
          </div>

          {data.agenda.length > 0 && (
            <div className="space-y-1.5">
              <Eyebrow>Agenda</Eyebrow>
              <ol className="list-inside list-decimal space-y-1 text-sm text-muted-foreground">
                {data.agenda.map((a) => (
                  <li key={a.id}>{a.title}</li>
                ))}
              </ol>
            </div>
          )}
        </CardContent>
      </Card>

      <ChairLogCard
        chairLog={data.chairLog ?? []}
        transcriptionStarted={data.transcriptionStarted ?? false}
      />

      {m.minutesDocumentId && (
        <MinutesSection schemeId={schemeId} documentId={m.minutesDocumentId} />
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold">Motions</h2>
          {isOfficer && !meetingOver && (
            <AddMotionSheet schemeId={schemeId} meetingId={meetingId} onChange={invalidate} />
          )}
        </div>
        {data.motions.length === 0 ? (
          <EmptyState
            icon={Gavel}
            title="No motions yet"
            description={
              isOfficer
                ? "Add the first motion for members to vote on."
                : "Motions appear here once the officers add them."
            }
          />
        ) : (
          <div className="space-y-2.5">
            {data.motions.map((motion) => (
              <MotionCard
                key={motion.id}
                schemeId={schemeId}
                motion={motion}
                isOfficer={isOfficer}
                onChange={invalidate}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AddMotionSheet({
  schemeId,
  meetingId,
  onChange,
}: {
  schemeId: string;
  meetingId: string;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const sheet = useSheetSide();

  const form = useAppForm({
    schema: addMotionSchema,
    defaultValues: { title: "", text: "", resolutionType: "ordinary" } as AddMotionValues,
    onSubmit: async (values) => {
      await unwrap(
        await api.schemes[":schemeId"].motions.$post({
          param: { schemeId },
          json: {
            meetingId,
            title: values.title,
            text: values.text,
            resolutionType: values.resolutionType,
          },
        }),
      );
      toast.success("Motion added");
      setOpen(false);
      form.reset();
      onChange();
    },
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" /> New motion
        </Button>
      </SheetTrigger>
      <SheetContent side={sheet.side} className={sheet.className}>
        <SheetHeader>
          <SheetTitle>Add a motion</SheetTitle>
          <SheetDescription>Motions are voted on by lot entitlement.</SheetDescription>
        </SheetHeader>
        <form
          id="motion-form"
          className="flex flex-col gap-5 px-4 pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.Field name="title">
              {(field) => (
                <Field
                  label="Title"
                  required
                  htmlFor="motion-title"
                  error={fieldError(field.state.meta.errors)}
                >
                  <Input
                    data-testid="motion-title"
                    placeholder="Motion title"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </Field>
              )}
            </form.Field>

            <form.Field name="text">
              {(field) => (
                <Field
                  label="Text"
                  required
                  htmlFor="motion-text"
                  error={fieldError(field.state.meta.errors)}
                >
                  <Textarea
                    data-testid="motion-text"
                    className="min-h-24"
                    placeholder="That the owners corporation resolves to…"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </Field>
              )}
            </form.Field>

            <form.Field name="resolutionType">
              {(field) => (
                <Field
                  label="Resolution type"
                  htmlFor="motion-resolution-type"
                  error={fieldError(field.state.meta.errors)}
                >
                  {(control) => (
                    <Select
                      value={field.state.value}
                      onValueChange={(v) => field.handleChange(v as ResolutionType)}
                    >
                      <SelectTrigger
                        id={control.id}
                        aria-invalid={control["aria-invalid"]}
                        aria-describedby={control["aria-describedby"]}
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ordinary">Ordinary resolution</SelectItem>
                        <SelectItem value="special">Special resolution (75%)</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </Field>
              )}
            </form.Field>
          </FieldGroup>

          <FormError form={form} />
          <SubmitButton form={form} className="w-full">
            Add motion
          </SubmitButton>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function MotionCard({
  schemeId,
  motion,
  isOfficer,
  onChange,
}: {
  schemeId: string;
  motion: Motion;
  isOfficer: boolean;
  onChange: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [lotId, setLotId] = useState("");

  const open = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.schemes[":schemeId"].motions[":motionId"].open.$post({
          param: { schemeId, motionId: motion.id },
        }),
      ),
    onMutate: () => setError(null),
    onSuccess: () => {
      toast.success("Voting opened");
      onChange();
    },
    onError: (e) => setError(e.message),
  });
  const close = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.schemes[":schemeId"].motions[":motionId"].close.$post({
          param: { schemeId, motionId: motion.id },
        }),
      ),
    onMutate: () => setError(null),
    onSuccess: () => {
      toast.success("Motion tallied");
      onChange();
    },
    onError: (e) => setError(e.message),
  });

  // Voting needs the caller's lot — the API resolves person + standing; we
  // just need a lotId. Owners typically hold one lot; fetch on demand.
  const { data: lotsData } = useQuery({
    queryKey: ["lots", schemeId],
    queryFn: async () =>
      unwrap<{ lots: { id: string; lotNumber: string }[] }>(
        await api.schemes[":schemeId"].lots.$get({ param: { schemeId } }),
      ),
  });
  const vote = useMutation({
    mutationFn: async (choice: "for" | "against" | "abstain") =>
      unwrap(
        await api.schemes[":schemeId"].votes.$post({
          param: { schemeId },
          json: { motionId: motion.id, lotId, choice },
        }),
      ),
    onMutate: () => setError(null),
    onSuccess: () => {
      toast.success("Vote recorded");
      onChange();
    },
    onError: (e) => setError(e.message),
  });

  return (
    <Card data-testid={`motion-${motion.title}`}>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium">{motion.title}</p>
            <Eyebrow>{motion.resolutionType} resolution</Eyebrow>
          </div>
          <StatusBadge status={motion.status} />
        </div>
        <p className="text-sm text-muted-foreground">{motion.text}</p>
        {motion.result && (
          <p className="font-mono text-xs text-muted-foreground tabular-nums">
            For {motion.result.forWeight} · Against {motion.result.againstWeight} · Abstain{" "}
            {motion.result.abstainWeight}
          </p>
        )}

        {motion.status === "draft" &&
          (isOfficer ? (
            <Button size="sm" onClick={() => open.mutate()} pending={open.isPending}>
              Open voting
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Voting hasn't opened yet.</p>
          ))}

        {motion.status === "open" && (
          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Select value={lotId} onValueChange={setLotId}>
                <SelectTrigger
                  size="sm"
                  data-testid="vote-lot"
                  aria-label="Choose your lot"
                  className="w-full sm:w-40"
                >
                  <SelectValue placeholder="My lot…" />
                </SelectTrigger>
                <SelectContent>
                  {lotsData?.lots.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      Lot {l.lotNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                {(["for", "against", "abstain"] as const).map((choice) => (
                  <Button
                    key={choice}
                    variant="outline"
                    size="sm"
                    className="flex-1 sm:flex-none"
                    disabled={!lotId || vote.isPending}
                    pending={vote.isPending && vote.variables === choice}
                    onClick={() => vote.mutate(choice)}
                  >
                    {choice}
                  </Button>
                ))}
              </div>
              {isOfficer && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full sm:ml-auto sm:w-auto"
                  onClick={() => close.mutate()}
                  pending={close.isPending}
                >
                  Close &amp; tally
                </Button>
              )}
            </div>
            {!lotId && (
              <p className="text-xs text-muted-foreground">Choose your lot to record a vote.</p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-critical">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
