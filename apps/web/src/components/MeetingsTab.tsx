import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap } from "../lib/api";

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

function MeetingList({ schemeId, onOpen }: { schemeId: string; onOpen: (id: string) => void }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["meetings", schemeId],
    queryFn: async () =>
      unwrap<{ meetings: Meeting[] }>(
        await api.schemes[":schemeId"].meetings.$get({ param: { schemeId } }),
      ),
  });
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [agenda, setAgenda] = useState("");
  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.schemes[":schemeId"].meetings.$post({
          param: { schemeId },
          json: {
            kind: "agm",
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
      setTitle("");
      setWhen("");
      setAgenda("");
      void queryClient.invalidateQueries({ queryKey: ["meetings", schemeId] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {data?.meetings.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onOpen(m.id)}
            className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-left hover:border-brand-600"
          >
            <div>
              <p className="text-sm font-medium">{m.title}</p>
              <p className="text-xs text-gray-500">
                {m.kind.toUpperCase()} · {new Date(m.scheduledAt).toLocaleString()}
              </p>
            </div>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
              {m.status.replace("_", " ")}
            </span>
          </button>
        ))}
        {data?.meetings.length === 0 && (
          <p className="text-sm text-gray-500">No meetings yet — schedule the AGM below.</p>
        )}
      </div>

      <form
        className="rounded-lg border border-gray-200 bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <h3 className="text-sm font-medium">Schedule an AGM</h3>
        <input
          data-testid="meeting-title"
          className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="Title (e.g. 2026 Annual General Meeting)"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          data-testid="meeting-when"
          type="datetime-local"
          className="mt-2 rounded-md border border-gray-300 px-3 py-2 text-sm"
          required
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
        <textarea
          data-testid="meeting-agenda"
          className="mt-2 h-20 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder={
            "Agenda items, one per line\nFinancial statements\nBudget adoption\nCommittee election"
          }
          value={agenda}
          onChange={(e) => setAgenda(e.target.value)}
        />
        {create.error && <p className="text-sm text-red-600">{create.error.message}</p>}
        <button
          type="submit"
          disabled={create.isPending}
          className="mt-2 rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-40"
        >
          Schedule meeting
        </button>
      </form>
    </div>
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

  const act = (fn: () => Promise<Response>) =>
    useMutation({ mutationFn: async () => unwrap(await fn()), onSuccess: invalidate });

  const sendNotice = act(() =>
    api.schemes[":schemeId"].meetings[":meetingId"].notice.$post({
      param: { schemeId, meetingId },
    }),
  );
  const attend = act(() =>
    api.schemes[":schemeId"].meetings[":meetingId"].attend.$post({
      param: { schemeId, meetingId },
      json: { mode: "online" },
    }),
  );
  const closeMeeting = act(() =>
    api.schemes[":schemeId"].meetings[":meetingId"].close.$post({
      param: { schemeId, meetingId },
    }),
  );

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
      setMotionTitle("");
      setMotionText("");
      invalidate();
    },
  });

  if (!data) return <p className="text-gray-500">Loading…</p>;
  const m = data.meeting;

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-sm text-brand-700 hover:underline">
        ← All meetings
      </button>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">{m.title}</h2>
            <p className="text-sm text-gray-500">
              {m.kind.toUpperCase()} · {new Date(m.scheduledAt).toLocaleString()} ·{" "}
              {m.status.replace("_", " ")}
            </p>
          </div>
          <div className="flex gap-2">
            {m.status === "draft" && (
              <button
                type="button"
                onClick={() => sendNotice.mutate()}
                className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800"
              >
                Send notice
              </button>
            )}
            {(m.status === "notice_sent" || m.status === "in_progress") && (
              <>
                <button
                  type="button"
                  onClick={() => attend.mutate()}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                >
                  I'm attending
                </button>
                <button
                  type="button"
                  onClick={() => closeMeeting.mutate()}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                >
                  Close meeting
                </button>
              </>
            )}
          </div>
        </div>
        {(sendNotice.error || closeMeeting.error || attend.error) && (
          <p className="mt-2 text-sm text-red-600">
            {(sendNotice.error ?? closeMeeting.error ?? attend.error)?.message}
          </p>
        )}
        <p
          className={`mt-2 text-sm ${data.quorum.quorate ? "text-green-700" : "text-amber-700"}`}
          data-testid="quorum"
        >
          Quorum: {data.quorum.representedEntitlement}/{data.quorum.totalEntitlement} entitlements
          represented — {data.quorum.quorate ? "quorate" : "not yet quorate"}
        </p>
        {data.agenda.length > 0 && (
          <ol className="mt-2 list-inside list-decimal text-sm text-gray-700">
            {data.agenda.map((a) => (
              <li key={a.id}>{a.title}</li>
            ))}
          </ol>
        )}
      </div>

      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Motions</h3>
        <div className="mt-2 space-y-2">
          {data.motions.map((motion) => (
            <MotionCard key={motion.id} schemeId={schemeId} motion={motion} onChange={invalidate} />
          ))}
        </div>

        {m.status !== "closed" && m.status !== "minutes_distributed" && (
          <form
            className="mt-3 rounded-lg border border-gray-200 bg-white p-4"
            onSubmit={(e) => {
              e.preventDefault();
              addMotion.mutate();
            }}
          >
            <h4 className="text-sm font-medium">Add motion</h4>
            <input
              data-testid="motion-title"
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="Motion title"
              required
              value={motionTitle}
              onChange={(e) => setMotionTitle(e.target.value)}
            />
            <textarea
              data-testid="motion-text"
              className="mt-2 h-16 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="That the owners corporation resolves to…"
              required
              value={motionText}
              onChange={(e) => setMotionText(e.target.value)}
            />
            <div className="mt-2 flex items-center gap-2">
              <select
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                value={resolutionType}
                onChange={(e) => setResolutionType(e.target.value as "ordinary" | "special")}
              >
                <option value="ordinary">Ordinary resolution</option>
                <option value="special">Special resolution (75%)</option>
              </select>
              <button
                type="submit"
                disabled={addMotion.isPending}
                className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-40"
              >
                Add motion
              </button>
            </div>
            {addMotion.error && (
              <p className="mt-1 text-sm text-red-600">{addMotion.error.message}</p>
            )}
          </form>
        )}
      </section>
    </div>
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
    onSuccess: onChange,
    onError: (e) => setError(e.message),
  });
  const close = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.schemes[":schemeId"].motions[":motionId"].close.$post({
          param: { schemeId, motionId: motion.id },
        }),
      ),
    onSuccess: onChange,
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
      onChange();
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div
      className="rounded-lg border border-gray-200 bg-white p-4"
      data-testid={`motion-${motion.title}`}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{motion.title}</p>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            motion.status === "carried"
              ? "bg-green-100 text-green-800"
              : motion.status === "lost"
                ? "bg-red-100 text-red-800"
                : motion.status === "open"
                  ? "bg-blue-100 text-blue-800"
                  : "bg-gray-100 text-gray-700"
          }`}
        >
          {motion.status}
        </span>
      </div>
      <p className="mt-1 text-xs text-gray-600">
        {motion.text} <i>({motion.resolutionType})</i>
      </p>
      {motion.result && (
        <p className="mt-1 text-xs text-gray-500">
          For {motion.result.forWeight} · Against {motion.result.againstWeight} · Abstain{" "}
          {motion.result.abstainWeight}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {motion.status === "draft" && (
          <button
            type="button"
            onClick={() => open.mutate()}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800"
          >
            Open voting
          </button>
        )}
        {motion.status === "open" && (
          <>
            <select
              className="rounded-md border border-gray-300 px-2 py-1 text-xs"
              value={lotId}
              data-testid="vote-lot"
              onChange={(e) => setLotId(e.target.value)}
            >
              <option value="">My lot…</option>
              {lotsData?.lots.map((l) => (
                <option key={l.id} value={l.id}>
                  Lot {l.lotNumber}
                </option>
              ))}
            </select>
            {(["for", "against", "abstain"] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                disabled={!lotId || vote.isPending}
                onClick={() => vote.mutate(choice)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs capitalize hover:bg-gray-50 disabled:opacity-40"
              >
                {choice}
              </button>
            ))}
            <button
              type="button"
              onClick={() => close.mutate()}
              className="ml-auto rounded-md border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50"
            >
              Close &amp; tally
            </button>
          </>
        )}
      </div>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
