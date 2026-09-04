import { describe, expect, it } from "vitest";
import { isFactoryFieldHeadcountProfile } from "./countFactoryFieldHeadcount";

describe("isFactoryFieldHeadcountProfile", () => {
  it("공장 100 + 총원 포함만 센다", () => {
    expect(
      isFactoryFieldHeadcountProfile({
        login_id: "hong01",
        is_active: true,
        include_in_field_headcount: true,
        organizations: { organization_code: "100" },
      })
    ).toBe(true);
  });

  it("다른 조직은 총원 포함이어도 공장 명단에 안 넣는다", () => {
    expect(
      isFactoryFieldHeadcountProfile({
        login_id: "hong01",
        is_active: true,
        include_in_field_headcount: true,
        organizations: { organization_code: "200" },
      })
    ).toBe(false);
  });
});
