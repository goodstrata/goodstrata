import type { Cents } from "@goodstrata/shared";

/**
 * Payment→notice matching. Pure decision function; the payments service
 * applies the result. Match hierarchy:
 *  1. Payment reference (PayID) equals a notice's reference → that notice.
 *  2. Exactly ONE open notice in the scheme has the same outstanding amount
 *     → that notice (heuristic; ambiguity is never guessed).
 *  3. Otherwise unmatched — a human (or a smarter agent) sorts it out.
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
): MatchResult {
  if (payment.payid) {
    const byRef = openNotices.filter((n) => n.payid === payment.payid);
    if (byRef.length === 1) {
      return { kind: "matched", levyNoticeId: byRef[0]!.levyNoticeId, via: "payid" };
    }
    if (byRef.length > 1) {
      return { kind: "unmatched", reason: "reference matches multiple notices" };
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
