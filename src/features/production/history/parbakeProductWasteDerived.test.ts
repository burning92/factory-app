import { describe, expect, it } from "vitest";
import { calculateParbakeProductWasteDerived } from "./parbakeProductWasteDerived";
import type { BomRowRef, ComputedResult, DateGroupInput, ProductSummary } from "./types";

function makeSummary(
  partial: Partial<ProductSummary> &
    Pick<ProductSummary, "displayProductLabel" | "finishedQty" | "productStandardName">
): ProductSummary {
  const standard = partial.productStandardName;
  const usesStored = standard === "파베이크사용";
  return {
    productKey: partial.productKey ?? partial.displayProductLabel,
    productName: partial.productName ?? partial.displayProductLabel,
    standardName: partial.standardName ?? standard,
    displayProductLabel: partial.displayProductLabel,
    baseProductName: partial.baseProductName ?? partial.displayProductLabel,
    productStandardName: standard,
    finishedQty: partial.finishedQty,
    inferredParbakeName: partial.inferredParbakeName ?? null,
    inferredBaseSauceMaterialName: null,
    inferredBaseSaucePerUnitQty: null,
    usesTodayDough: partial.usesTodayDough ?? !usesStored,
    usesStoredParbake: partial.usesStoredParbake ?? usesStored,
    isBreadProduct: partial.isBreadProduct ?? false,
    requiresBaseSauceBom: partial.requiresBaseSauceBom ?? true,
    participatesInParbakeTypeInference:
      partial.participatesInParbakeTypeInference ?? true,
  };
}

function emptyDateGroup(): DateGroupInput {
  return {
    id: "d",
    date: "2026-07-24",
    doughMixQty: 3700,
    doughWasteQty: 99,
    materials: [],
    products: [],
    secondClosure: {
      productOutputs: [],
      extraParbakes: [],
      parbakeProductionByBase: [],
      astronautParbakeQty: 0,
      saleParbakeQty: 0,
    },
  };
}

describe("calculateParbakeProductWasteDerived", () => {
  it("일반+파베이크사용 혼합일에는 토핑 원료 폐기로 환산하지 않는다", () => {
    const productSummaries: ProductSummary[] = [
      makeSummary({
        displayProductLabel: "허니고르곤졸라",
        productStandardName: "일반",
        finishedQty: 2010,
        inferredParbakeName: "베샤멜 파베이크",
      }),
      makeSummary({
        displayProductLabel: "마르게리따",
        productStandardName: "파베이크사용",
        finishedQty: 502,
        inferredParbakeName: "토마토 파베이크",
      }),
    ];

    const computed = {
      productSummaries,
      lotUsages: [],
      parbakeWasteQty: 84,
      doughMixQty: 3700,
    } as unknown as ComputedResult;

    const bomList: BomRowRef[] = [
      {
        productName: "마르게리따 - 파베이크사용",
        materialName: "모짜렐라 미니디스크 슬라이스",
        basis: "완제품",
        bomGPerEa: 50,
      },
    ];

    const derived = calculateParbakeProductWasteDerived(
      emptyDateGroup(),
      computed,
      bomList
    );

    expect(derived.applicable).toBe(false);
    expect(derived.products).toEqual([]);
    expect(derived.reason).toMatch(/베이스\(도우소스\)/);
  });
});
