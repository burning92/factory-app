import { describe, expect, it } from "vitest";
import { formatAdditionalOutboundWeight } from "./additionalOutboundHistory";

describe("formatAdditionalOutboundWeight", () => {
  it("shows only non-zero units", () => {
    expect(formatAdditionalOutboundWeight(0, 0, 39920)).toBe("39,920g");
    expect(formatAdditionalOutboundWeight(2, 3, 0)).toBe("2박스 3개");
  });

  it("returns 0 when all zero", () => {
    expect(formatAdditionalOutboundWeight(0, 0, 0)).toBe("0");
  });
});
