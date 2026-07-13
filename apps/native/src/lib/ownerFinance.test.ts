import { summarizeOwnerObligations } from "./ownerFinance";

describe("summarizeOwnerObligations", () => {
  it("adds each positive amount due without netting another lot's credit", () => {
    expect(summarizeOwnerObligations([10_000, -9_000, 5_000])).toEqual({
      amountDueCents: 15_000,
      lotsWithAmountDue: 2,
      lotsInCredit: 1,
    });
  });

  it("reports no amount due when every lot is paid up or in credit", () => {
    expect(summarizeOwnerObligations([0, -2_500])).toEqual({
      amountDueCents: 0,
      lotsWithAmountDue: 0,
      lotsInCredit: 1,
    });
  });
});
