import type * as React from "react";

/**
 * Shared frame for the auth surfaces (/login, /signup): the ghost strata mark
 * (the one place besides empty states it's allowed — DESIGN.md §2) over an
 * optional heading, then the page's card(s). Keeps the two routes visually
 * identical so moving between sign in and sign up feels like one screen.
 */
export function AuthShell({
  heading,
  children,
}: {
  heading?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 py-2 md:py-10">
      <div className="flex flex-col items-center gap-4 text-center">
        <img
          src="/logo-on-light.svg"
          alt=""
          aria-hidden="true"
          className="h-8 w-auto dark:hidden"
        />
        <img
          src="/logo-on-dark.svg"
          alt=""
          aria-hidden="true"
          className="hidden h-8 w-auto dark:block"
        />
        {heading}
      </div>
      {children}
    </div>
  );
}
