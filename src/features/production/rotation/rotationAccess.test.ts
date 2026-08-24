import { describe, expect, it } from "vitest";
import { isManagerOrAbove } from "@/lib/roles";
import {
  isExcludedFromRotationRosterByLoginId,
  isRotationRosterRole,
} from "@/lib/profileFieldHeadcount";

const ROTATION_ACCESS_ROLES = ["manager", "quality_manager", "headquarters", "admin"] as const;

describe("로테이션 권한 회귀", () => {
  it("테스트 15: manager/quality_manager/headquarters/admin만 접근 가능", () => {
    for (const role of ROTATION_ACCESS_ROLES) {
      expect(isManagerOrAbove(role)).toBe(true);
    }
    expect(isManagerOrAbove("worker")).toBe(false);
    expect(isManagerOrAbove("assistant_manager")).toBe(false);
  });

  it("admin은 숙련 명단에 포함하고 test* 로그인은 제외한다", () => {
    expect(isRotationRosterRole("admin")).toBe(true);
    expect(isRotationRosterRole("quality_manager")).toBe(true);
    expect(isRotationRosterRole("worker")).toBe(true);
    expect(isExcludedFromRotationRosterByLoginId("test")).toBe(true);
    expect(isExcludedFromRotationRosterByLoginId("testuser")).toBe(true);
    expect(isExcludedFromRotationRosterByLoginId("admin")).toBe(false);
  });
});
