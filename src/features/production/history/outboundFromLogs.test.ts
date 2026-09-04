import { describe, expect, it } from "vitest";
import {
  aggregateOutboundQtyByMaterialAndExpiry,
  getOutboundLinesFromLog,
  syncFromLogOutboundQty,
} from "./outboundFromLogs";
import type { ProductionLog } from "@/store/useMasterStore";

const materials = [
  { materialName: "버터", boxWeightG: 10000, unitWeightG: 500 },
  { materialName: "소금", boxWeightG: 0, unitWeightG: 0 },
];

function log(partial: Partial<ProductionLog> & Pick<ProductionLog, "id">): ProductionLog {
  return {
    id: partial.id,
    생산일자: partial.생산일자 ?? "2026-08-21",
    제품명: partial.제품명 ?? "테스트",
    원료명: partial.원료명 ?? "",
    출고_박스: partial.출고_박스 ?? 0,
    출고_낱개: partial.출고_낱개 ?? 0,
    출고_g: partial.출고_g ?? 0,
    ...partial,
  };
}

describe("getOutboundLinesFromLog", () => {
  it("출고_라인이 있으면 모든 라인을 반환 (추가 출고 append)", () => {
    const lines = getOutboundLinesFromLog(
      log({
        id: "1",
        원료명: "버터",
        출고_라인: [
          { 소비기한: "2026-09-01", 박스: 1, 낱개: 0, g: 0 },
          { 소비기한: "2026-09-05", 박스: 0, 낱개: 2, g: 100 },
        ],
        출고_박스: 1,
        출고_낱개: 2,
        출고_g: 10200,
      })
    );
    expect(lines).toHaveLength(2);
  });
});

describe("aggregateOutboundQtyByMaterialAndExpiry", () => {
  it("1차 출고 + 같은 LOT 추가 출고(append) 합산", () => {
    const agg = aggregateOutboundQtyByMaterialAndExpiry(
      [
        log({
          id: "1",
          원료명: "버터",
          출고_라인: [
            { 소비기한: "2026-09-01", 박스: 1, 낱개: 0, g: 0 },
            { 소비기한: "2026-09-01", 박스: 0, 낱개: 2, g: 0 },
          ],
        }),
      ],
      materials
    );
    expect(agg.get("버터\t2026-09-01")?.outboundQty).toBe(11000);
  });

  it("추가 출고로 신규 원료 log(create)도 집계", () => {
    const agg = aggregateOutboundQtyByMaterialAndExpiry(
      [
        log({
          id: "1",
          원료명: "버터",
          출고_라인: [{ 소비기한: "2026-09-01", 박스: 1, 낱개: 0, g: 0 }],
        }),
        log({
          id: "2",
          원료명: "소금",
          출고_라인: [{ 소비기한: "2026-10-01", 박스: 0, 낱개: 0, g: 5000 }],
        }),
      ],
      materials
    );
    expect(agg.get("버터\t2026-09-01")?.outboundQty).toBe(10000);
    expect(agg.get("소금\t2026-10-01")?.outboundQty).toBe(5000);
  });

  it("다른 LOT 추가 출고는 별도 행", () => {
    const agg = aggregateOutboundQtyByMaterialAndExpiry(
      [
        log({
          id: "1",
          원료명: "버터",
          출고_라인: [
            { 소비기한: "2026-09-01", 박스: 1, 낱개: 0, g: 0 },
            { 소비기한: "2026-09-10", 박스: 0, 낱개: 0, g: 3000 },
          ],
        }),
      ],
      materials
    );
    expect(agg.get("버터\t2026-09-01")?.outboundQty).toBe(10000);
    expect(agg.get("버터\t2026-09-10")?.outboundQty).toBe(3000);
  });
});

describe("syncFromLogOutboundQty", () => {
  it("from-log는 DB 최신 출고량으로 갱신", () => {
    expect(syncFromLogOutboundQty(1000, "from-log", 1500)).toBe(1500);
  });

  it("manual LOT은 출고량 유지", () => {
    expect(syncFromLogOutboundQty(800, "manual", 1500)).toBe(800);
  });
});
