import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
import { signOut, useSession } from "../lib/auth";

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  const { data: session } = useSession();

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold text-brand-700">
            <img src="/logo-on-light.svg" alt="GoodStrata" className="h-8 w-auto" />
          </Link>
          {session?.user ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-gray-500">{session.user.email}</span>
              <button
                type="button"
                onClick={() => void signOut()}
                className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-100"
              >
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
