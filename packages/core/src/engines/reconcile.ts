import type { Cents } from "@goodstrata/shared";

/**
 * Payment→notice matching. Pure decision function; the payments service
 * applies the result. Match hierarchy:
 *  1. Payment reference (PayID) equals an OPEN notice's reference → that notice.
 *  2. Reference equals a SETTLED notice's reference → unmatched (a duplicate /
 *     second payment must never be amount-guessed onto some other lot's notice).
 *  3. Exactly ONE open notice in the scheme has the same outstanding amount
 *     → that notice (heuristic; ambiguity is never guessed).
 *  4. Otherwise unmatched — a human (or a smarter agent) sorts it out.
 */

export interface OpenNotice {
  levyNoticeId: string;
  payid: string | null;
  outstandingCents: Cents;
}

export type MatchResult =
  | { kind: "matched"; levyNoticeId: string; via: "payid" | "amount" }
  | { kind: "unmatched"; reason: string };

export function matchPayment(
  payment: { payid: string | null; amountCents: Cents },
  openNotices: OpenNotice[],
  opts?: {
    /** References of notices already settled (paid / written off). */
    settledPayids?: readonly string[];
  },
): MatchResult {
  // Defensive: a non-positive amount can never buy down a levy.
  if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0) {
    return { kind: "unmatched", reason: "non-positive payment amount" };
  }

  if (payment.payid) {
    const byRef = openNotices.filter((n) => n.payid === payment.payid);
    if (byRef.length === 1) {
      return { kind: "matched", levyNoticeId: byRef[0]!.levyNoticeId, via: "payid" };
    }
    if (byRef.length > 1) {
      return { kind: "unmatched", reason: "reference matches multiple notices" };
    }
    // The reference is KNOWN but its notice is settled: this is a duplicate or
    // overpayment on that notice. Park it — never fall through to the amount
    // heuristic, which could silently allocate it to a different lot.
    if (opts?.settledPayids?.includes(payment.payid)) {
      return { kind: "unmatched", reason: "reference matches a settled notice" };
    }
  }

  const byAmount = openNotices.filter((n) => n.outstandingCents === payment.amountCents);
  if (byAmount.length === 1) {
    return { kind: "matched", levyNoticeId: byAmount[0]!.levyNoticeId, via: "amount" };
  }
  return {
    kind: "unmatched",
    reason:
      byAmount.length === 0
        ? "no open notice matches reference or amount"
        : "amount matches multiple notices",
  };
}
