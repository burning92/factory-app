import { describe, expect, it } from "vitest";
import { computeFirstCloseReturnGByMaterial, stockLotToG } from "./computeFirstCloseReturns";

describe("stockLotToG", () => {
  it("g전용은 잔량만", () => {
    expect(stockLotToG("", 500, { materialName: "A", unitWeightG: 0, boxWeightG: 0 })).toBe(500);
  });

  it("낱개+잔량 환산", () => {
    expect(stockLotToG(2, 100, { materialName: "B", unitWeightG: 1000, boxWeightG: 5000 })).toBe(2100);
  });
});

describe("computeFirstCloseReturnGByMaterial", () => {
  const meta = [{ materialName: "밀가루", unitWeightG: 1000, boxWeightG: 10000 }];

  it("keep_2f·move_1f 잔량 합산", () => {
    const map = computeFirstCloseReturnGByMaterial(
      [
        {
          materialName: "밀가루",
          lots: [
            { carryoverDisposition: "keep_2f", currentDayRemainderG: 300 },
            { carryoverDisposition: "move_1f", currentDayRemainderG: 999 },
          ],
        },
      ],
      meta
    );
    expect(map.get("밀가루")).toBe(1299);
  });

  it("move_1f 낱개 환산", () => {
    const map = computeFirstCloseReturnGByMaterial(
      [
        {
          materialName: "몬터레이잭",
          lots: [{ carryoverDisposition: "move_1f", currentDayUnitCount: 5, currentDayRemainderG: 0 }],
        },
      ],
      [{ materialName: "몬터레이잭", unitWeightG: 2000, boxWeightG: 10000 }]
    );
    expect(map.get("몬터레이잭")).toBe(10000);
  });

  it("전량 사용(상태 없음·재고 0)은 제외", () => {
    const map = computeFirstCloseReturnGByMaterial(
      [
        {
          materialName: "밀가루",
          lots: [
            { carryoverDisposition: "move_1f", currentDayRemainderG: 100 },
            { currentDayUnitCount: 0, currentDayRemainderG: 0 },
          ],
        },
      ],
      meta
    );
    expect(map.get("밀가루")).toBe(100);
  });
});
