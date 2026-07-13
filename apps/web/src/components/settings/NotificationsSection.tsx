import {
  NOTIFICATION_PREF_CHANNELS,
  type NotificationPrefChannel,
  type NotificationType,
} from "@goodstrata/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Smartphone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { updateUser, useSession } from "@/lib/auth";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Types (mirror the GET /profile/notification-preferences contract)          */
/* -------------------------------------------------------------------------- */

type ChannelMatrix = Record<NotificationPrefChannel, boolean>;

interface PrefType {
  type: NotificationType;
  label: string;
  help: string;
  channels: ChannelMatrix;
}

interface PrefGroup {
  key: string;
  label: string;
  types: PrefType[];
}

interface PrefsPayload {
  smsAvailable: boolean;
  phone: string | null;
  groups: PrefGroup[];
}

const QUERY_KEY = ["notification-preferences"] as const;

const CHANNEL_LABELS: Record<NotificationPrefChannel, string> = {
  in_app: "In-app",
  email: "Email",
  sms: "SMS",
  push: "Push",
};

/** Single fixed grid track so column headers align down every group. */
const GRID = "grid grid-cols-[1fr_2.75rem_2.75rem_2.75rem_2.75rem] gap-x-2 gap-y-3 items-center";

async function fetchPrefs(): Promise<PrefsPayload> {
  const res = await fetch("/api/profile/notification-preferences", { credentials: "include" });
  if (!res.ok) throw new Error(`Preferences request failed (${res.status})`);
  return (await res.json()) as PrefsPayload;
}

/* -------------------------------------------------------------------------- */
/* Section                                                                    */
/* -------------------------------------------------------------------------- */

export function NotificationsSection() {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchPrefs,
    retry: false,
  });

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>
              Choose what reaches you, and how. In-app shows in your bell; add email or text for the
              things you don't want to miss.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {isPending ? (
              <MatrixSkeleton />
            ) : isError || !data ? (
              <Alert tone="critical">
                <AlertTitle>Couldn't load your preferences</AlertTitle>
                <AlertDescription>
                  <button
                    type="button"
                    onClick={() => void refetch()}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Try again
                  </button>
                </AlertDescription>
              </Alert>
            ) : (
              <NotificationsMatrix data={data} />
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}

/* -------------------------------------------------------------------------- */
/* Matrix                                                                      */
/* -------------------------------------------------------------------------- */

function NotificationsMatrix({ data }: { data: PrefsPayload }) {
  const queryClient = useQueryClient();
  const smsAvailable = data.smsAvailable;

  // Per-toggle optimistic autosave: flip the cached value immediately, PATCH a
  // single { type, channel, enabled }, revert + toast on error.
  const mutation = useMutation({
    mutationFn: async (input: {
      type: NotificationType;
      channel: NotificationPrefChannel;
      enabled: boolean;
    }) => {
      const res = await fetch("/api/profile/notification-preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<PrefsPayload>(QUERY_KEY);
      queryClient.setQueryData<PrefsPayload>(QUERY_KEY, (old) =>
        old ? applyToggle(old, input) : old,
      );
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
      toast.error("Couldn't save that — try again.");
    },
  });

  return (
    <div className="space-y-6">
      <p role="status" aria-live="polite" className="sr-only">
        {mutation.isPending
          ? "Saving notification preference…"
          : mutation.isSuccess
            ? "Notification preference saved."
            : ""}
      </p>
      {!smsAvailable ? <NoPhoneAlert /> : null}

      {/* Column headers — once, aligned to the shared grid track. */}
      <div className={cn(GRID, "gap-y-0 border-b pb-2")}>
        {/* Occupies the 1fr label column so the channel headers line up over
            their toggles. Must NOT be sr-only (position:absolute drops the grid
            cell, shifting every header one column left). */}
        <span aria-hidden="true" />
        {NOTIFICATION_PREF_CHANNELS.map((channel) => (
          <span key={channel} className="text-center text-13 font-medium text-muted-foreground">
            {CHANNEL_LABELS[channel]}
          </span>
        ))}
      </div>

      {data.groups.map((group) => (
        <div key={group.key} className={GRID}>
          <h3 className="col-span-full text-13 font-semibold tracking-wide text-muted-foreground uppercase">
            {group.label}
          </h3>
          {group.types.map((row) => (
            <MatrixRow
              key={row.type}
              row={row}
              smsAvailable={smsAvailable}
              onToggle={(channel, enabled) => mutation.mutate({ type: row.type, channel, enabled })}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function MatrixRow({
  row,
  smsAvailable,
  onToggle,
}: {
  row: PrefType;
  smsAvailable: boolean;
  onToggle: (channel: NotificationPrefChannel, enabled: boolean) => void;
}) {
  return (
    <>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{row.label}</p>
        <p className="hidden text-13 text-muted-foreground sm:block">{row.help}</p>
      </div>
      {NOTIFICATION_PREF_CHANNELS.map((channel) => {
        const isSms = channel === "sms";
        const disabled = isSms && !smsAvailable;
        // No-phone: render the SMS switch off + disabled even if stored ON —
        // it can't send yet. The saved value is honoured once a number exists.
        const checked = disabled ? false : row.channels[channel];
        const name = `${row.label} — ${CHANNEL_LABELS[channel]}`;
        const control = (
          <Switch
            checked={checked}
            disabled={disabled}
            onCheckedChange={(next) => onToggle(channel, next)}
            aria-label={name}
          />
        );
        return (
          <div key={channel} className="flex h-11 items-center justify-center">
            {disabled ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">{control}</span>
                </TooltipTrigger>
                <TooltipContent>Add a mobile number first.</TooltipContent>
              </Tooltip>
            ) : (
              control
            )}
          </div>
        );
      })}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* No-phone alert + inline phone field                                        */
/* -------------------------------------------------------------------------- */

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normalise common Australian input to E.164 (what Twilio needs): a leading 0
 * becomes +61 (0432 541 123 → +61432541123), a bare 61 gets a +, and
 * spaces/dashes/parens are stripped. Anything already starting with + is kept.
 */
function normalizeAuPhone(raw: string): string {
  const digits = raw.replace(/[\s().-]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("0")) return `+61${digits.slice(1)}`;
  if (digits.startsWith("61")) return `+${digits}`;
  return digits;
}

function NoPhoneAlert() {
  const queryClient = useQueryClient();
  const { refetch: refetchSession } = useSession();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async (phone: string) => {
      // better-auth updateUser persists `phone` (registered as an additional
      // field server-side). Cast: the client type doesn't know the field.
      const res = await (updateUser as (input: { phone: string }) => ReturnType<typeof updateUser>)(
        { phone },
      );
      if (res.error) throw new Error(res.error.message ?? "Couldn't save your number");
    },
    onSuccess: () => {
      toast.success("Mobile number saved");
      setOpen(false);
      setValue("");
      void refetchSession();
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save your number"),
  });

  function submit() {
    const next = normalizeAuPhone(value);
    if (!E164.test(next)) {
      setError("Enter a valid mobile number, e.g. 0412 345 678.");
      return;
    }
    setError(null);
    save.mutate(next);
  }

  return (
    <Alert tone="info">
      <MessageSquare aria-hidden="true" />
      <AlertTitle>Turn on text messages</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>Add a mobile number and we can text you the things you don't want to miss.</p>
        {open ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
          >
            <Field
              label="Mobile number"
              htmlFor="settings-phone"
              error={error ?? undefined}
              className="max-w-xs flex-1"
            >
              <Input
                id="settings-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                enterKeyHint="done"
                placeholder="0412 345 678"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" size="sm" pending={save.isPending}>
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Smartphone aria-hidden="true" />
            Add mobile number
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Immutably flip one (type, channel) in the cached prefs payload. */
function applyToggle(
  data: PrefsPayload,
  input: { type: NotificationType; channel: NotificationPrefChannel; enabled: boolean },
): PrefsPayload {
  return {
    ...data,
    groups: data.groups.map((group) => ({
      ...group,
      types: group.types.map((row) =>
        row.type === input.type
          ? { ...row, channels: { ...row.channels, [input.channel]: input.enabled } }
          : row,
      ),
    })),
  };
}

function MatrixSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((g) => (
        <div key={g} className="space-y-3">
          <Skeleton className="h-4 w-32" />
          {[0, 1].map((r) => (
            <div key={r} className={GRID}>
              <Skeleton className="h-4 w-40" />
              {[0, 1, 2, 3].map((c) => (
                <Skeleton key={c} className="mx-auto h-5 w-9 rounded-full" />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
