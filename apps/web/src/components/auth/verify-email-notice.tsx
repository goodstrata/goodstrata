import { useMutation } from "@tanstack/react-query";
import { CircleAlertIcon, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { sendVerificationEmail } from "@/lib/auth";

/**
 * Post-signup (and unverified sign-in) screen. In prod
 * (REQUIRE_EMAIL_VERIFICATION=1) better-auth creates the account but withholds
 * the session until the link is clicked, so we land here instead of "/". Resend
 * re-triggers sendVerificationEmail; "start over" hands control back to the form.
 */
export function VerifyEmailNotice({
  email,
  onStartOver,
}: {
  email: string;
  onStartOver: () => void;
}) {
  const resend = useMutation({
    mutationFn: async () => {
      const res = await sendVerificationEmail({ email, callbackURL: "/" });
      if (res.error) {
        throw new Error(res.error.message ?? "Couldn't resend just now. Try again in a moment.");
      }
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-accent text-primary">
          <MailCheck className="size-5" aria-hidden="true" />
        </div>
        <CardTitle className="text-lg">Check your email</CardTitle>
        <CardDescription>
          We sent a verification link to{" "}
          <span className="font-medium break-all text-foreground">{email}</span>. Click it to
          activate your account, then you're in.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-[13px] text-muted-foreground">
          Nothing in your inbox after a minute? Check spam, or resend below.
        </p>

        {resend.isError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-critical/25 bg-critical/8 px-3 py-2 text-[13px] text-critical"
          >
            <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>{resend.error.message}</span>
          </div>
        )}
        {resend.isSuccess && !resend.isError && (
          <p
            role="status"
            className="flex items-start gap-2 rounded-md border border-positive/25 bg-positive/8 px-3 py-2 text-[13px] text-positive"
          >
            <MailCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>Sent again — the newest link is the one to use.</span>
          </p>
        )}

        <Button
          variant="outline"
          pending={resend.isPending}
          onClick={() => resend.mutate()}
          className="w-full"
        >
          Resend verification email
        </Button>
        <Button variant="link" className="h-auto p-0 text-sm" onClick={onStartOver}>
          Wrong email? Start over
        </Button>
      </CardContent>
    </Card>
  );
}
