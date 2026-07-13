import { type QueryClient, useQuery } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet, useParams } from "@tanstack/react-router";
import { ChevronLeft, Loader2, LogOut, Monitor, Moon, Settings, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { MessagesBell } from "@/components/MessagesBell";
import { NotificationsBell } from "@/components/NotificationsBell";
import { RouteAccessibility } from "@/components/route-accessibility";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormMessage } from "@/components/ui/form-message";
import { Toaster } from "@/components/ui/sonner";
import { signOut, useSession } from "@/lib/auth";
import { schemeQueryOptions } from "@/lib/roles";

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

/** Browser-chrome theme-color for each resolved theme; matches --background in styles.css. */
const THEME_COLOR = { light: "#faf9f6", dark: "#15181f" } as const;

function RootLayout() {
  const { data: session } = useSession();
  const params = useParams({ strict: false }) as { schemeId?: string };
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const { data: activeScheme } = useQuery({
    ...schemeQueryOptions(params.schemeId ?? ""),
    enabled: Boolean(params.schemeId),
  });

  // Keep browser chrome (mobile status bar / toolbar) in sync with the app's
  // resolved theme — the static metas in index.html only track the OS scheme,
  // which is wrong once the user overrides the theme in-app.
  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    let meta = metas[0];
    for (let i = 1; i < metas.length; i++) metas[i]!.remove();
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.removeAttribute("media");
    meta.content = THEME_COLOR[resolvedTheme];
  }, [resolvedTheme]);

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      const result = await signOut();
      if (result.error) throw new Error(result.error.message ?? "Sign-out failed");
      // A full document load also drops the React Query cache, so no data from
      // the previous account survives into the next session.
      window.location.href = "/login";
    } catch {
      setSignOutError("Couldn't sign you out. Check your connection and try again.");
      setSigningOut(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <RouteAccessibility schemeName={activeScheme?.scheme.name} />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b bg-card/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex h-14 w-full max-w-(--breakpoint-2xl) items-center justify-between gap-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] md:pl-[max(1.5rem,env(safe-area-inset-left))] md:pr-[max(1.5rem,env(safe-area-inset-right))]">
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/" className="flex shrink-0 items-center" aria-label="GoodStrata home">
              {params.schemeId ? (
                <>
                  <img src="/mark-on-light.svg" alt="" className="size-7 dark:hidden lg:hidden" />
                  <img
                    src="/mark-on-dark.svg"
                    alt=""
                    className="hidden size-7 dark:block dark:lg:hidden"
                  />
                  <img
                    src="/logo-on-light.svg"
                    alt="GoodStrata"
                    className="hidden h-7 w-auto lg:block dark:lg:hidden"
                  />
                  <img
                    src="/logo-on-dark.svg"
                    alt="GoodStrata"
                    className="hidden h-7 w-auto dark:lg:block"
                  />
                </>
              ) : (
                <>
                  <img
                    src="/logo-on-light.svg"
                    alt="GoodStrata"
                    className="h-7 w-auto dark:hidden"
                  />
                  <img
                    src="/logo-on-dark.svg"
                    alt="GoodStrata"
                    className="hidden h-7 w-auto dark:block"
                  />
                </>
              )}
            </Link>
            {params.schemeId && (
              <Link
                to="/"
                aria-label="Back to schemes"
                className="flex shrink-0 items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Schemes</span>
              </Link>
            )}
            {params.schemeId && activeScheme ? (
              <span className="max-w-[9rem] truncate border-l pl-3 text-sm font-medium sm:max-w-xs lg:hidden">
                {activeScheme.scheme.name}
              </span>
            ) : null}
          </div>
          {session?.user ? (
            <div className="flex items-center gap-1">
              {params.schemeId ? (
                <>
                  <MessagesBell schemeId={params.schemeId} />
                  <NotificationsBell schemeId={params.schemeId} />
                </>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-9 gap-2 rounded-full px-1.5"
                    data-testid="user-menu"
                    aria-label="Account menu"
                  >
                    <Avatar className="size-7">
                      {session.user.image ? <AvatarImage src={session.user.image} alt="" /> : null}
                      <AvatarFallback className="bg-accent text-xs font-semibold text-accent-foreground">
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
                  <DropdownMenuItem asChild>
                    <Link to="/settings">
                      <Settings className="size-4" /> Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    Theme
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
                    <DropdownMenuRadioItem value="light">
                      <Sun className="size-4" /> Light
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dark">
                      <Moon className="size-4" /> Dark
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="system">
                      <Monitor className="size-4" /> System
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  {signOutError ? (
                    <div className="p-1">
                      <FormMessage>{signOutError}</FormMessage>
                    </div>
                  ) : null}
                  <DropdownMenuItem
                    disabled={signingOut}
                    onSelect={(event) => {
                      // Keep the menu open while the request runs so pending or
                      // failure feedback remains attached to the action.
                      event.preventDefault();
                      if (!signingOut) void handleSignOut();
                    }}
                  >
                    {signingOut ? (
                      <Loader2
                        className="size-4 animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                    ) : (
                      <LogOut className="size-4" aria-hidden="true" />
                    )}
                    {signingOut ? "Signing out…" : "Sign out"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-(--breakpoint-2xl) flex-1 py-6 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] outline-none md:py-8 md:pl-[max(1.5rem,env(safe-area-inset-left))] md:pr-[max(1.5rem,env(safe-area-inset-right))]"
      >
        <Outlet />
      </main>
      {/* mobileOffset clears the fixed h-16 mobile bottom nav (+ safe area) on
          scheme pages so toasts never cover the primary navigation. */}
      <Toaster
        position="bottom-right"
        richColors
        mobileOffset={{ bottom: "calc(env(safe-area-inset-bottom) + 5rem)" }}
      />
    </div>
  );
}
