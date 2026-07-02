import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet, useParams } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { NotificationsBell } from "@/components/NotificationsBell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Toaster } from "@/components/ui/sonner";
import { signOut, useSession } from "@/lib/auth";

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function initials(name: string | undefined, email: string | undefined): string {
  const source = name?.trim() || email || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function RootLayout() {
  const { data: session } = useSession();
  const params = useParams({ strict: false }) as { schemeId?: string };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 md:px-6">
          <Link to="/" className="flex shrink-0 items-center" aria-label="GoodStrata home">
            <img src="/logo-on-light.svg" alt="GoodStrata" className="h-7 w-auto" />
          </Link>
          {session?.user ? (
            <div className="flex items-center gap-1">
              {params.schemeId ? <NotificationsBell schemeId={params.schemeId} /> : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-9 gap-2 rounded-full px-1.5"
                    data-testid="user-menu"
                    aria-label="Account menu"
                  >
                    <Avatar className="size-7">
                      <AvatarFallback className="bg-brand-100 text-xs font-semibold text-brand-800">
                        {initials(session.user.name, session.user.email)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden max-w-40 truncate text-sm font-medium sm:inline">
                      {session.user.name || session.user.email}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <p className="text-sm font-medium">{session.user.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void signOut()}>
                    <LogOut className="size-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6 md:py-8">
        <Outlet />
      </main>
      <Toaster position="top-center" richColors />
    </div>
  );
}
