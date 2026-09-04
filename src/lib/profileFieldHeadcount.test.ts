import { describe, expect, it } from "vitest";
import { profileCountsTowardFieldHeadcount } from "./profileFieldHeadcount";

describe("profileCountsTowardFieldHeadcount", () => {
  it("활성 + 총원 포함이면 센다", () => {
    expect(
      profileCountsTowardFieldHeadcount({
        isActive: true,
        includeInFieldHeadcount: true,
        loginId: "hong01",
      })
    ).toBe(true);
  });

  it("총원 제외면 역할과 무관하게 안 센다", () => {
    expect(
      profileCountsTowardFieldHeadcount({
        isActive: true,
        includeInFieldHeadcount: false,
        loginId: "hong01",
      })
    ).toBe(false);
  });

  it("비활성이면 안 센다", () => {
    expect(
      profileCountsTowardFieldHeadcount({
        isActive: false,
        includeInFieldHeadcount: true,
        loginId: "hong01",
      })
    ).toBe(false);
  });

  it("test·admin 로그인은 총원 포함이어도 제외한다", () => {
    expect(
      profileCountsTowardFieldHeadcount({
        isActive: true,
        includeInFieldHeadcount: true,
        loginId: "admin",
      })
    ).toBe(false);
    expect(
      profileCountsTowardFieldHeadcount({
        isActive: true,
        includeInFieldHeadcount: true,
        loginId: "testuser",
      })
    ).toBe(false);
  });
});
