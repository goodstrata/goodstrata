import type * as React from "react";

/**
 * Shared frame for the auth surfaces (/login, /signup). On desktop it's a two
 * column split: the value side (heading + optional aside) on the left, the form
 * card on the right, both vertically centred. On mobile it stacks to a single
 * centred column. No logo here — the app header already carries the mark on
 * every route, so repeating it just crowded the page.
 */
export function AuthShell({
  heading,
  aside,
  children,
}: {
  heading?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto grid w-full max-w-5xl items-center gap-10 py-2 md:py-12 lg:min-h-[68vh] lg:grid-cols-2 lg:gap-20">
      <div className="flex flex-col gap-6 text-center lg:text-left">
        {heading}
        {aside}
      </div>
      <div className="mx-auto flex w-full max-w-sm flex-col gap-6 lg:mx-0 lg:justify-self-end">
        {children}
      </div>
    </div>
  );
}
