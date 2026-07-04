import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Separator } from "@/components/ui/separator";
import { signIn } from "@/lib/auth";

/** Response of GET /api/demo-info — the public auth-page descriptor. */
export interface AuthPageInfo {
  demo: boolean;
  accounts: { label: string; email: string; password: string }[];
  /** Social sign-in providers this deployment has configured (e.g. ["google"]). */
  socialProviders?: string[];
}

/**
 * What optional auth surfaces this deployment exposes (demo logins, social
 * providers). A runtime capability, not a build flag — one web build serves
 * every deployment, and the Google button only renders where credentials
 * exist. Shares the login page's queryKey so the fetch is deduped.
 */
export function useAuthPageInfo() {
  return useQuery({
    queryKey: ["demo-info"],
    queryFn: async () => (await fetch("/api/demo-info")).json() as Promise<AuthPageInfo>,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/**
 * Official Google "G" mark (per Google's sign-in branding guidelines the
 * four colours are fixed brand assets and must not be recoloured, so this
 * intentionally ignores the current theme).
 */
export function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/** Maps better-auth's OAuth `?error=` codes to something a human can act on. */
function oauthErrorMessage(code: string): string {
  switch (code) {
    case "access_denied":
      return "Google sign-in was cancelled. Try again, or use your email below.";
    case "account_not_linked":
      return "That Google account couldn't be linked to your GoodStrata account. Sign in with your email below, then connect Google in Settings → Security.";
    default:
      return "Google sign-in didn't complete. Try again, or use your email below.";
  }
}

/**
 * "Continue with Google" + an "or" hairline divider, for the sign-in and
 * sign-up cards. Renders nothing unless this deployment has Google configured
 * (see useAuthPageInfo), so self-hosters without credentials never see it.
 */
export function SocialSignIn({ callbackURL = "/" }: { callbackURL?: string }) {
  const { data: info } = useAuthPageInfo();
  const [pending, setPending] = useState(false);
  // Failed OAuth round-trips land back on this page with ?error=<code>
  // (better-auth's errorCallbackURL) — surface it next to the button.
  const [error, setError] = useState<string | null>(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    return code ? oauthErrorMessage(code) : null;
  });

  if (!info?.socialProviders?.includes("google")) return null;

  async function continueWithGoogle() {
    setPending(true);
    setError(null);
    try {
      const result = await signIn.social({
        provider: "google",
        callbackURL,
        // Come back to this page (not a dead end) if Google errors out.
        errorCallbackURL: window.location.pathname,
      });
      if (result.error) {
        setError(result.error.message ?? "Couldn't start Google sign-in. Try again.");
        setPending(false);
        return;
      }
      // Success means better-auth is redirecting the whole page to Google —
      // stay pending so the button can't be double-clicked meanwhile.
    } catch {
      setError("Couldn't start Google sign-in. Try again.");
      setPending(false);
    }
  }

  return (
    <div className="mb-4 flex flex-col gap-4">
      {error && <FormMessage>{error}</FormMessage>}
      <Button
        type="button"
        variant="outline"
        className="w-full"
        pending={pending}
        onClick={() => void continueWithGoogle()}
      >
        <GoogleMark className="size-4" />
        Continue with Google
      </Button>
      <div className="relative">
        <Separator />
        <span className="absolute inset-x-0 -top-2.5 mx-auto w-fit bg-card px-3 text-xs text-muted-foreground">
          or
        </span>
      </div>
    </div>
  );
}
