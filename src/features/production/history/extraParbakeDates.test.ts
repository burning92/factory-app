import { describe, expect, it } from "vitest";
import {
  addDaysYmd,
  extraParbakeManufacturedDateFromRow,
  parbakeExpiryFromManufacturedDate,
} from "./extraParbakeDates";

describe("extraParbakeDates", () => {
  it("제조일 +364일 = 소비기한", () => {
    expect(parbakeExpiryFromManufacturedDate("2026-04-10")).toBe("2027-04-09");
  });

  it("레거시 expiryDate → 제조일자 역산", () => {
    expect(
      extraParbakeManufacturedDateFromRow({ expiryDate: "2027-04-09" })
    ).toBe("2026-04-10");
  });

  it("manufacturedDate 우선", () => {
    expect(
      extraParbakeManufacturedDateFromRow({
        manufacturedDate: "2026-04-10",
        expiryDate: "2027-04-09",
      })
    ).toBe("2026-04-10");
  });

  it("addDaysYmd roundtrip", () => {
    expect(addDaysYmd("2026-04-10", 364)).toBe("2027-04-09");
    expect(addDaysYmd("2027-04-09", -364)).toBe("2026-04-10");
  });
});
