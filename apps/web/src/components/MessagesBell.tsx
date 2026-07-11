import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { messagesUnreadQueryOptions } from "@/lib/messaging";

/**
 * Top-bar entry to private messages: a mail icon with the caller's total
 * unread count (polled — delivery is polling v1). Lives next to the
 * notifications bell on every scheme page and deep-links to the Messages
 * section of the register index.
 */
export function MessagesBell({ schemeId }: { schemeId: string }) {
  const { data } = useQuery({ ...messagesUnreadQueryOptions(schemeId), retry: false });
  const unread = data?.unread ?? 0;

  return (
    <Button asChild variant="ghost" size="icon" className="relative" data-testid="messages-bell">
      <Link
        to="/schemes/$schemeId"
        params={{ schemeId }}
        search={{ section: "messages" }}
        aria-label={`Messages${unread > 0 ? ` (${unread} unread)` : ""}`}
      >
        <Mail className="size-5" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Link>
    </Button>
  );
}
