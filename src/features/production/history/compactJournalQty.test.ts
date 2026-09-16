import { describe, expect, it } from "vitest";
import {
  buildCompactJournalQtyCsv,
  collectCompactProductLines,
  compactJournalQtyRowFromComputed,
  formatCompactProductNames,
} from "./compactJournalQty";
import type { ComputedResult } from "./types";

function stubComputed(partial: Partial<ComputedResult>): ComputedResult {
  return {
    totalFinishedQty: 0,
    totalExtraParbakeQty: 0,
    doughMixQty: 0,
    doughWasteQty: 0,
    doughUsageQty: 0,
    sameDayParbakeProductionQty: 0,
    parbakeWasteQty: 0,
    breadWasteQty: 0,
    generalDoughFinishedQty: 0,
    astronautParbakeQty: 0,
    saleParbakeQty: 0,
    astronautParbakeOutputLabel: null,
    saleParbakeOutputLabel: null,
    parbakePurposeProductionLines: [],
    directDoughFinishedQty: 0,
    storedParbakeFinishedQty: 0,
    expectedDirectDoughFlowQty: 0,
    directDoughBalanceQty: 0,
    productSummaries: [],
    lotUsages: [],
    resolvedExtraParbakes: [],
    unresolvedExtraParbakes: [],
    baseWasteRows: [],
    baseUsageRows: [],
    baseWaste: { resolved: false },
    baseUsage: { resolved: false },
    warnings: [],
    ...partial,
  };
}

describe("compactJournalQty", () => {
  it("sums parbake and bread waste as finished waste", () => {
    const row = compactJournalQtyRowFromComputed(
      "2026-08-25",
      "홍길동",
      "마르게리따 100개",
      stubComputed({
        doughMixQty: 3400,
        doughUsageQty: 3300,
        storedParbakeFinishedQty: 12,
        doughWasteQty: 20,
        parbakeWasteQty: 70,
        breadWasteQty: 10,
      })
    );
    expect(row.finishedWasteQty).toBe(80);
    expect(row.storedParbakeUsedQty).toBe(12);
    expect(row.storageParbakeProducedQty).toBe(0);
    expect(row.saleParbakeProducedQty).toBe(0);
  });

  it("includes extra parbake usage in stored parbake used qty", () => {
    const row = compactJournalQtyRowFromComputed(
      "2026-09-14",
      "김동호",
      "허니고르곤졸라 2,003개",
      stubComputed({
        storedParbakeFinishedQty: 0,
        totalExtraParbakeQty: 605,
        resolvedExtraParbakes: [
          {
            extraParbakeId: "1",
            parbakeName: "베샤멜 파베이크",
            qty: 605,
            manufacturedDate: "2026-09-14",
            expiryDate: "2027-09-09",
            displayLabel: "베샤멜 파베이크",
            productCandidates: [],
            targetProductResolved: true,
          },
        ],
      })
    );
    expect(row.storedParbakeUsedQty).toBe(605);
  });

  it("does not add 파베이크사용 완제품 수량 on top of extra parbake usage", () => {
    const row = compactJournalQtyRowFromComputed(
      "2026-09-11",
      "김동호",
      "마르게리따 1,081개",
      stubComputed({
        storedParbakeFinishedQty: 1081,
        totalExtraParbakeQty: 1082,
        resolvedExtraParbakes: [
          {
            extraParbakeId: "1",
            parbakeName: "토마토 파베이크",
            qty: 768,
            manufacturedDate: "2026-09-11",
            expiryDate: "2027-09-03",
            displayLabel: "토마토 파베이크",
            productCandidates: [],
            targetProductResolved: true,
          },
          {
            extraParbakeId: "2",
            parbakeName: "토마토 파베이크",
            qty: 314,
            manufacturedDate: "2026-09-11",
            expiryDate: "2027-09-06",
            displayLabel: "토마토 파베이크",
            productCandidates: [],
            targetProductResolved: true,
          },
        ],
      })
    );
    expect(row.storedParbakeUsedQty).toBe(1082);
  });

  it("shows storage and sale parbake production by type", () => {
    const row = compactJournalQtyRowFromComputed(
      "2026-09-14",
      "김동호",
      "허니고르곤졸라 2,003개",
      stubComputed({
        parbakePurposeProductionLines: [
          { role: "astronaut", parbakeName: "베샤멜 파베이크", qty: 608 },
          { role: "astronaut", parbakeName: "토마토 파베이크", qty: 615 },
          { role: "sale", parbakeName: "토마토 파베이크", qty: 120 },
        ],
      })
    );
    expect(row.storageParbakeProducedQty).toBe(1223);
    expect(row.storageParbakeProducedLabel).toBe("베샤멜 파베이크 608개, 토마토 파베이크 615개");
    expect(row.saleParbakeProducedQty).toBe(120);
    expect(row.saleParbakeProducedLabel).toBe("토마토 파베이크 120개");
  });

  it("quotes product names that contain commas", () => {
    const csv = buildCompactJournalQtyCsv([
      compactJournalQtyRowFromComputed(
        "2026-08-25",
        "홍길동",
        "마르게리따 100개, 페퍼로니 50개",
        stubComputed({ doughMixQty: 1 })
      ),
    ]);
    expect(csv).toContain(
      '"생산일자","작성자","제품명","도우반죽량","도우사용량","보관용파베이크사용수량","보관용파베이크생산","판매용파베이크생산","도우폐기량","완제품폐기량"'
    );
    expect(csv).toContain('"마르게리따 100개, 페퍼로니 50개"');
  });

  it("uses parbake purpose lines when finished product outputs are empty", () => {
    const lines = collectCompactProductLines({
      computed: stubComputed({
        productSummaries: [],
        parbakePurposeProductionLines: [
          { role: "astronaut", parbakeName: "토마토 파베이크", qty: 3086 },
        ],
      }),
    });
    expect(formatCompactProductNames(lines)).toBe(
      "우주인 파베이크(보관용) 토마토 파베이크 3,086개"
    );
  });

  it("uses outbound 우주인 파베이크 제품명 instead of generic purpose labels", () => {
    const lines = collectCompactProductLines({
      computed: stubComputed({
        productSummaries: [],
        parbakePurposeProductionLines: [
          { role: "astronaut", parbakeName: "베샤멜 파베이크", qty: 3086 },
        ],
      }),
      logProductNames: ["우주인 베샤멜 파베이크 - 일반"],
    });
    expect(formatCompactProductNames(lines)).toBe("우주인 베샤멜 파베이크 3,086개");
  });
});
