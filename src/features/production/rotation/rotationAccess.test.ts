import { describe, expect, it } from "vitest";
import { isManagerOrAbove } from "@/lib/roles";
import { profileCountsTowardFieldHeadcount } from "@/lib/profileFieldHeadcount";

const ROTATION_ACCESS_ROLES = ["manager", "quality_manager", "headquarters", "admin"] as const;

describe("로테이션 권한 회귀", () => {
  it("테스트 15: manager/quality_manager/headquarters/admin만 접근 가능", () => {
    for (const role of ROTATION_ACCESS_ROLES) {
      expect(isManagerOrAbove(role)).toBe(true);
    }
    expect(isManagerOrAbove("worker")).toBe(false);
    expect(isManagerOrAbove("assistant_manager")).toBe(false);
  });

  it("명단은 역할이 아니라 총원 포함 지정으로 들어가고 test·admin 로그인은 빠진다", () => {
    expect(
      profileCountsTowardFieldHeadcount({
        isActive: true,
        includeInFieldHeadcount: true,
        loginId: "hong01",
      })
    ).toBe(true);
    expect(
      profileCountsTowardFieldHeadcount({
        isActive: true,
        includeInFieldHeadcount: false,
        loginId: "hong01",
      })
    ).toBe(false);
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
