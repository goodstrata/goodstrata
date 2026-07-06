import { palette, radius, space } from "./tokens";

describe("theme tokens", () => {
  it("uses the eucalypt brand colour for identity", () => {
    expect(palette.eucalypt).toBe("#095b41");
  });

  it("space() follows the 4pt grid", () => {
    expect(space(0)).toBe(0);
    expect(space(1)).toBe(4);
    expect(space(6)).toBe(24);
  });

  it("pill radius is fully rounded", () => {
    expect(radius.pill).toBe(999);
  });
});
