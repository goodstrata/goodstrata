import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, ChevronRight, Plus, Video } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/Markdown";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, unwrap } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

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
interface MeetingDetail {
  meeting: Meeting;
  agenda: { id: string; order: number; title: string }[];
  motions: Motion[];
  quorum: { representedEntitlement: number; totalEntitlement: number; quorate: boolean };
}

export function MeetingsTab({ schemeId }: { schemeId: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  return selected ? (
    <MeetingDetailView schemeId={schemeId} meetingId={selected} onBack={() => setSelected(null)} />
  ) : (
    <MeetingList schemeId={schemeId} onOpen={setSelected} />
  );
}

function ScheduleMeetingDialog({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"agm" | "sgm" | "committee">("agm");
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [agenda, setAgenda] = useState("");
  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.schemes[":schemeId"].meetings.$post({
          param: { schemeId },
          json: {
            kind,
            title,
            scheduledAt: new Date(when).toISOString(),
            agenda: agenda
              .split("\n")
              .map((t) => t.trim())
              .filter(Boolean)
              .map((t) => ({ title: t })),
          },
        }),
      ),
    onSuccess: () => {
      setOpen(false);
      setTitle("");
      setWhen("");
      setAgenda("");
      toast.success("Meeting scheduled");
      void queryClient.invalidateQueries({ queryKey: ["meetings", schemeId] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> New meeting
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule a meeting</DialogTitle>
          <DialogDescription>
            Notices go out to every member with the agenda attached.
          </DialogDescription>
        </DialogHeader>
        <form
          id="meeting-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label>Kind</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger className="w-full" data-testid="meeting-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="agm">Annual general meeting</SelectItem>
                <SelectItem value="sgm">Special general meeting</SelectItem>
                <SelectItem value="committee">Committee meeting</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="meeting-title">Title</Label>
            <Input
              id="meeting-title"
              data-testid="meeting-title"
              placeholder="Title (e.g. 2026 Annual General Meeting)"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="meeting-when">When</Label>
            <Input
              id="meeting-when"
              data-testid="meeting-when"
              type="datetime-local"
              required
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="meeting-agenda">Agenda (one item per line)</Label>
            <Textarea
              id="meeting-agenda"
              data-testid="meeting-agenda"
              className="h-24"
              placeholder={"Financial statements\nBudget adoption\nCommittee election"}
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
            />
          </div>
          {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
        </form>
        <DialogFooter>
          <Button type="submit" form="meeting-form" disabled={create.isPending}>
            Schedule meeting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MeetingList({ schemeId, onOpen }: { schemeId: string; onOpen: (id: string) => void }) {
  const { data } = useQuery({
    queryKey: ["meetings", schemeId],
    queryFn: async () =>
      unwrap<{ meetings: Meeting[] }>(
        await api.schemes[":schemeId"].meetings.$get({ param: { schemeId } }),
      ),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Meetings</h3>
          <p className="text-sm text-muted-foreground">
            AGMs, special general meetings and committee meetings.
          </p>
        </div>
        <ScheduleMeetingDialog schemeId={schemeId} />
      </div>

      <div className="space-y-2.5">
        {!data && <Skeleton className="h-24" />}
        {data?.meetings.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onOpen(m.id)}
            className="group flex w-full items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3.5 text-left shadow-sm transition-colors hover:border-brand-600/60"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                <CalendarDays className="size-4.5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{m.title}</p>
                <p className="text-xs text-muted-foreground">
                  {m.kind.toUpperCase()} · {formatDateTime(m.scheduledAt)}
                </p>
              </div>
            </div>
            <span className="flex shrink-0 items-center gap-2">
              <StatusBadge status={m.status} />
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </span>
          </button>
        ))}
        {data?.meetings.length === 0 && (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No meetings yet — schedule the AGM.
          </p>
        )}
      </div>
    </div>
  );
}

/** Video calls: contract-first UI; hides itself if the API doesn't support it yet. */
function VideoCallButtons({ schemeId, meetingId }: { schemeId: string; meetingId: string }) {
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
    <>
      <Button variant="outline" size="sm" onClick={() => start.mutate()} disabled={start.isPending}>
        <Video className="size-4" /> Start video meeting
      </Button>
      <Button size="sm" onClick={() => join.mutate()} disabled={join.isPending}>
        <Video className="size-4" /> Join video call
      </Button>
    </>
  );
}

/** Minutes rendering: probes for a content endpoint and hides when absent. */
function MinutesSection({ schemeId, documentId }: { schemeId: string; documentId: string }) {
  const { data } = useQuery({
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
      return null;
    },
  });

  if (!data) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Minutes</CardTitle>
      </CardHeader>
      <CardContent>
        <Markdown>{data}</Markdown>
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
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["meeting", schemeId, meetingId] });
  const { data } = useQuery({
    queryKey: ["meeting", schemeId, meetingId],
    queryFn: async () =>
      unwrap<MeetingDetail>(
        await api.schemes[":schemeId"].meetings[":meetingId"].$get({
          param: { schemeId, meetingId },
        }),
      ),
    refetchInterval: 3000,
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

  if (!data) return <Skeleton className="h-64" />;
  const m = data.meeting;
  const quorumPct =
    data.quorum.totalEntitlement > 0
      ? Math.round((data.quorum.representedEntitlement / data.quorum.totalEntitlement) * 100)
      : 0;
  const videoEligible =
    (m.kind === "committee" || m.kind === "agm") &&
    (m.status === "notice_sent" || m.status === "in_progress");

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft className="size-4" /> All meetings
      </Button>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-lg">{m.title}</CardTitle>
              <CardDescription>
                {m.kind.toUpperCase()} · {formatDateTime(m.scheduledAt)}
              </CardDescription>
            </div>
            <StatusBadge status={m.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {m.status === "draft" && (
              <Button size="sm" onClick={() => sendNotice.mutate()}>
                Send notice
              </Button>
            )}
            {(m.status === "notice_sent" || m.status === "in_progress") && (
              <>
                <Button variant="outline" size="sm" onClick={() => attend.mutate()}>
                  I'm attending
                </Button>
                {videoEligible && <VideoCallButtons schemeId={schemeId} meetingId={meetingId} />}
                <Button variant="outline" size="sm" onClick={() => closeMeeting.mutate()}>
                  Close meeting
                </Button>
              </>
            )}
          </div>

          <div data-testid="quorum" className="space-y-1.5">
            <p className={`text-sm ${data.quorum.quorate ? "text-green-700" : "text-amber-700"}`}>
              Quorum: {data.quorum.representedEntitlement}/{data.quorum.totalEntitlement}{" "}
              entitlements represented — {data.quorum.quorate ? "quorate" : "not yet quorate"}
            </p>
            <Progress value={quorumPct} className="h-1.5 max-w-sm" />
          </div>

          {data.agenda.length > 0 && (
            <div>
              <h4 className="text-sm font-medium">Agenda</h4>
              <ol className="mt-1.5 list-inside list-decimal space-y-1 text-sm text-muted-foreground">
                {data.agenda.map((a) => (
                  <li key={a.id}>{a.title}</li>
                ))}
              </ol>
            </div>
          )}
        </CardContent>
      </Card>

      {m.minutesDocumentId && (
        <MinutesSection schemeId={schemeId} documentId={m.minutesDocumentId} />
      )}

      <section>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold">Motions</h3>
          {m.status !== "closed" && m.status !== "minutes_distributed" && (
            <AddMotionDialog schemeId={schemeId} meetingId={meetingId} onChange={invalidate} />
          )}
        </div>
        <div className="mt-3 space-y-2.5">
          {data.motions.length === 0 && (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No motions yet.
            </p>
          )}
          {data.motions.map((motion) => (
            <MotionCard key={motion.id} schemeId={schemeId} motion={motion} onChange={invalidate} />
          ))}
        </div>
      </section>
    </div>
  );
}

function AddMotionDialog({
  schemeId,
  meetingId,
  onChange,
}: {
  schemeId: string;
  meetingId: string;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [motionTitle, setMotionTitle] = useState("");
  const [motionText, setMotionText] = useState("");
  const [resolutionType, setResolutionType] = useState<"ordinary" | "special">("ordinary");
  const addMotion = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.schemes[":schemeId"].motions.$post({
          param: { schemeId },
          json: { meetingId, title: motionTitle, text: motionText, resolutionType },
        }),
      ),
    onSuccess: () => {
      setOpen(false);
      setMotionTitle("");
      setMotionText("");
      toast.success("Motion added");
      onChange();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" /> New motion
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a motion</DialogTitle>
          <DialogDescription>Motions are voted on by lot entitlement.</DialogDescription>
        </DialogHeader>
        <form
          id="motion-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            addMotion.mutate();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="motion-title">Title</Label>
            <Input
              id="motion-title"
              data-testid="motion-title"
              placeholder="Motion title"
              required
              value={motionTitle}
              onChange={(e) => setMotionTitle(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="motion-text">Text</Label>
            <Textarea
              id="motion-text"
              data-testid="motion-text"
              className="h-20"
              placeholder="That the owners corporation resolves to…"
              required
              value={motionText}
              onChange={(e) => setMotionText(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Resolution type</Label>
            <Select
              value={resolutionType}
              onValueChange={(v) => setResolutionType(v as "ordinary" | "special")}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ordinary">Ordinary resolution</SelectItem>
                <SelectItem value="special">Special resolution (75%)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {addMotion.error && <p className="text-sm text-destructive">{addMotion.error.message}</p>}
        </form>
        <DialogFooter>
          <Button type="submit" form="motion-form" disabled={addMotion.isPending}>
            Add motion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MotionCard({
  schemeId,
  motion,
  onChange,
}: {
  schemeId: string;
  motion: Motion;
  onChange: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const open = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.schemes[":schemeId"].motions[":motionId"].open.$post({
          param: { schemeId, motionId: motion.id },
        }),
      ),
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
  const [lotId, setLotId] = useState("");
  const vote = useMutation({
    mutationFn: async (choice: "for" | "against" | "abstain") =>
      unwrap(
        await api.schemes[":schemeId"].votes.$post({
          param: { schemeId },
          json: { motionId: motion.id, lotId, choice },
        }),
      ),
    onSuccess: () => {
      setError(null);
      toast.success("Vote recorded");
      onChange();
    },
    onError: (e) => setError(e.message),
  });

  return (
    <Card className="py-4" data-testid={`motion-${motion.title}`}>
      <CardContent className="px-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium">{motion.title}</p>
          <StatusBadge status={motion.status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {motion.text} <i>({motion.resolutionType})</i>
        </p>
        {motion.result && (
          <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
            For {motion.result.forWeight} · Against {motion.result.againstWeight} · Abstain{" "}
            {motion.result.abstainWeight}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {motion.status === "draft" && (
            <Button size="sm" onClick={() => open.mutate()}>
              Open voting
            </Button>
          )}
          {motion.status === "open" && (
            <>
              <Select value={lotId} onValueChange={setLotId}>
                <SelectTrigger size="sm" data-testid="vote-lot" className="min-w-28">
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
              {(["for", "against", "abstain"] as const).map((choice) => (
                <Button
                  key={choice}
                  variant="outline"
                  size="sm"
                  className="capitalize"
                  disabled={!lotId || vote.isPending}
                  onClick={() => vote.mutate(choice)}
                >
                  {choice}
                </Button>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => close.mutate()}
              >
                Close &amp; tally
              </Button>
            </>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
