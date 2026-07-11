import { conversationRecipientFor } from "./conversationRecipient";

describe("conversationRecipientFor", () => {
  it("keeps a plain member on the committee destination", () => {
    expect(
      conversationRecipientFor({
        isOfficer: false,
        mode: "user",
        userId: "member-2",
      }),
    ).toEqual({ kind: "committee" });
  });

  it("builds the committee target for an officer", () => {
    expect(conversationRecipientFor({ isOfficer: true, mode: "committee", userId: "" })).toEqual({
      kind: "committee",
    });
  });

  it("builds a specific-member target for an officer", () => {
    expect(
      conversationRecipientFor({ isOfficer: true, mode: "user", userId: " member-2 " }),
    ).toEqual({ kind: "user", userId: "member-2" });
  });

  it("requires an officer to select a member in specific-member mode", () => {
    expect(conversationRecipientFor({ isOfficer: true, mode: "user", userId: "" })).toBeNull();
  });
});
