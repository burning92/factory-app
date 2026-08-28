import { describe, expect, it } from "vitest";
import {
  buildCompactJournalQtyCsv,
  compactJournalQtyRowFromComputed,
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
      '"생산일자","작성자","제품명","도우반죽량","도우사용량","보관용파베이크사용수량","도우폐기량","완제품폐기량"'
    );
    expect(csv).toContain('"마르게리따 100개, 페퍼로니 50개"');
  });
});
