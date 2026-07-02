import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface AppNotification {
  id: string;
  title?: string | null;
  body?: string | null;
  message?: string | null;
  kind?: string | null;
  createdAt: string;
  readAt?: string | null;
  read?: boolean | null;
}

/**
 * Fetch notifications for a scheme. Returns null when the API doesn't have
 * the endpoint yet (404) so the whole feature hides gracefully.
 */
async function fetchNotifications(schemeId: string): Promise<AppNotification[] | null> {
  const res = await fetch(`/api/schemes/${schemeId}/notifications`, { credentials: "include" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Notifications request failed (${res.status})`);
  const data = (await res.json()) as { notifications?: AppNotification[] };
  return data.notifications ?? [];
}

function isUnread(n: AppNotification): boolean {
  if (typeof n.read === "boolean") return !n.read;
  return !n.readAt;
}

export function NotificationsBell({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["notifications", schemeId],
    queryFn: () => fetchNotifications(schemeId),
    refetchInterval: 30_000,
    retry: false,
  });

  const markRead = useMutation({
    mutationFn: async (input: { all: true } | { notificationId: string }) => {
      const res = await fetch(`/api/schemes/${schemeId}/notifications/read`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      });
      if (!res.ok && res.status !== 404) throw new Error(`Mark read failed (${res.status})`);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notifications", schemeId] }),
  });

  // Endpoint missing (pre-merge backend) — hide the feature entirely.
  if (data === null || data === undefined) return null;

  const unread = data.filter(isUnread);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`Notifications${unread.length > 0 ? ` (${unread.length} unread)` : ""}`}
          data-testid="notifications-bell"
        >
          <Bell className="size-5" />
          {unread.length > 0 && (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unread.length > 9 ? "9+" : unread.length}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(20rem,calc(100vw-1rem))] p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          {unread.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground"
              onClick={() => markRead.mutate({ all: true })}
              pending={markRead.isPending}
            >
              <CheckCheck className="size-3.5" /> Mark all read
            </Button>
          )}
        </div>
        <Separator />
        {data.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-3 py-8 text-center">
            <div className="flex size-9 items-center justify-center rounded-full bg-muted">
              <BellOff aria-hidden="true" className="size-4 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">You're all caught up</p>
            <p className="text-xs text-muted-foreground">
              New notices for this scheme will appear here.
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-80">
            <ul>
              {data.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => isUnread(n) && markRead.mutate({ notificationId: n.id })}
                    className={cn(
                      "flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-accent/50",
                      isUnread(n) && "bg-accent/40",
                    )}
                  >
                    <span className="flex items-start gap-2">
                      {isUnread(n) && (
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                      )}
                      <span className="text-sm font-medium leading-snug">
                        {n.title ?? n.message ?? "Notification"}
                      </span>
                    </span>
                    {n.body && n.body !== n.title && (
                      <span className="line-clamp-2 pl-3.5 text-xs text-muted-foreground">
                        {n.body}
                      </span>
                    )}
                    <span className="pl-3.5 text-xs text-muted-foreground">
                      {formatDateTime(n.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
