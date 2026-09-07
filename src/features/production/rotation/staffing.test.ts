import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG } from "./catalog";
import { periodTargets } from "./rotationEngine";
import {
  defaultStaffingForProcess,
  normalizePositionStaffing,
  staffingForPosition,
  staffingHasCapacity,
  withDefaultStaffing,
} from "./staffing";

describe("토핑 정원", () => {
  it("기본 정원에 max가 열려 표·배치에 자리가 생긴다", () => {
    const staffing = defaultStaffingForProcess("topping");
    expect(staffingHasCapacity(staffing)).toBe(true);
    expect(staffing?.start.max).toBeGreaterThan(0);
    expect(staffing?.after.max).toBeGreaterThan(0);
  });

  it("예전에 0/0으로 저장된 토핑은 기본 정원으로 복구한다", () => {
    const restored = normalizePositionStaffing("topping", {
      start: { min: 0, max: 0 },
      lunch1: { min: 0, max: 0 },
      lunch2: { min: 0, max: 0 },
      after: { min: 0, max: 0 },
    });
    expect(staffingHasCapacity(restored)).toBe(true);
    expect(restored?.after.max).toBe(6);
  });

  it("이미 설정한 토핑 정원은 덮어쓰지 않는다", () => {
    const custom = normalizePositionStaffing("topping", {
      start: { min: 1, max: 3 },
      lunch1: { min: 0, max: 1 },
      lunch2: { min: 0, max: 2 },
      after: { min: 2, max: 4 },
    });
    expect(custom?.start).toEqual({ min: 1, max: 3 });
    expect(custom?.after).toEqual({ min: 2, max: 4 });
  });

  it("기본 카탈로그 병합 후 periodTargets에 토핑 max가 잡힌다", () => {
    const catalog = {
      ...DEFAULT_CATALOG,
      phono_ricotta: DEFAULT_CATALOG.phono_ricotta.map((p) =>
        p.process === "topping"
          ? withDefaultStaffing({
              ...p,
              staffing: {
                start: { min: 0, max: 0 },
                lunch1: { min: 0, max: 0 },
                lunch2: { min: 0, max: 0 },
                after: { min: 0, max: 0 },
              },
            })
          : p
      ),
    };
    const topping = catalog.phono_ricotta.find((p) => p.process === "topping");
    expect(topping).toBeTruthy();
    expect(staffingForPosition(topping!, "after").max).toBeGreaterThan(0);

    const targets = periodTargets(catalog, "phono_ricotta", 3, true);
    const need = targets.after.positions.find((p) => p.process === "topping");
    expect(need?.max).toBeGreaterThan(0);
  });
});
