import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api";
import { useIsOfficer } from "@/lib/roles";

interface PersonRow {
  id: string;
  givenName: string | null;
  familyName: string | null;
  email: string | null;
  userId: string | null;
  pendingInvite: boolean;
}

function personName(p: PersonRow): string {
  return `${p.givenName ?? ""} ${p.familyName ?? ""}`.trim() || p.email || "Unnamed";
}

function personInitials(p: PersonRow): string {
  const initials =
    `${p.givenName?.trim()?.[0] ?? ""}${p.familyName?.trim()?.[0] ?? ""}`.toUpperCase();
  if (initials) return initials;
  return p.email?.trim()?.[0]?.toUpperCase() ?? "?";
}

export function PeopleSection({ schemeId }: { schemeId: string }) {
  const queryClient = useQueryClient();
  const isOfficer = useIsOfficer(schemeId);
  const { data, isError, error, refetch } = useQuery({
    queryKey: ["people", schemeId],
    queryFn: async () =>
      unwrap<{ people: PersonRow[] }>(
        await api.schemes[":schemeId"].people.$get({ param: { schemeId } }),
      ),
  });
  const invite = useMutation({
    mutationFn: async (personId: string) =>
      unwrap(
        await api.schemes[":schemeId"].people[":personId"].invite.$post({
          param: { schemeId, personId },
          json: { role: "owner" },
        }),
      ),
    onSuccess: () => {
      toast.success("Invite sent");
      void queryClient.invalidateQueries({ queryKey: ["people", schemeId] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (isError) {
    return (
      <div className="max-w-2xl">
        <ErrorState
          message={error instanceof Error ? error.message : "Couldn't load the people register."}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }
  if (!data) return <Skeleton className="h-40 max-w-2xl" />;

  if (data.people.length === 0) {
    return (
      <div className="max-w-2xl">
        <EmptyState
          icon={Users}
          title="No people yet"
          description="Owners appear here once the plan of subdivision is imported."
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-2">
      {data.people.map((p) => {
        const isThisPending = invite.isPending && invite.variables === p.id;
        return (
          <Card key={p.id} data-testid={`person-${p.email ?? p.id}`} className="py-3">
            <CardContent className="flex items-center gap-3 px-4">
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground"
              >
                {personInitials(p)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{personName(p)}</p>
                <p className="truncate text-xs text-muted-foreground">{p.email ?? "No email"}</p>
              </div>
              {p.userId ? (
                <StatusBadge status="joined" />
              ) : p.pendingInvite ? (
                <StatusBadge status="invited" />
              ) : isOfficer ? (
                <Button
                  variant="outline"
                  size="sm"
                  pending={isThisPending}
                  disabled={!p.email || invite.isPending}
                  title={p.email ? undefined : "Add an email address to invite this person"}
                  onClick={() => invite.mutate(p.id)}
                >
                  Invite
                </Button>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
