import { describe, expect, it } from "vitest";
import {
  buildParbakePurposeProductionLines,
  computeParbakeProductionQtyByType,
  getDateParbakeTypes,
  inferParbakeMetaFromBom,
  pickDominantParbakeType,
  resolveMixedParbakeWasteByDominantProduction,
  resolveBaseSauceMetaForParbakeType,
} from "./calculations";
import type { BomRowRef, DateGroupInput, ProductSummary } from "./types";

function makeSummary(
  partial: Partial<ProductSummary> & Pick<ProductSummary, "displayProductLabel" | "finishedQty">
): ProductSummary {
  return {
    productKey: partial.productKey ?? partial.displayProductLabel,
    productName: partial.productName ?? partial.displayProductLabel,
    standardName: partial.standardName ?? "일반",
    displayProductLabel: partial.displayProductLabel,
    baseProductName: partial.baseProductName ?? partial.displayProductLabel,
    productStandardName: partial.productStandardName ?? "일반",
    finishedQty: partial.finishedQty,
    inferredParbakeName: partial.inferredParbakeName ?? null,
    inferredBaseSauceMaterialName: null,
    inferredBaseSaucePerUnitQty: null,
    usesTodayDough: partial.usesTodayDough ?? true,
    usesStoredParbake: partial.usesStoredParbake ?? false,
    isBreadProduct: partial.isBreadProduct ?? false,
    requiresBaseSauceBom: partial.requiresBaseSauceBom ?? true,
    participatesInParbakeTypeInference: partial.participatesInParbakeTypeInference ?? true,
  };
}

function emptyState(secondClosure: DateGroupInput["secondClosure"]): DateGroupInput {
  return {
    id: "d",
    date: "2026-06-12",
    doughMixQty: 3400,
    doughWasteQty: 45,
    materials: [],
    products: [],
    secondClosure,
  };
}

describe("resolveMixedParbakeWasteByDominantProduction", () => {
  it("베샤멜(고르곤졸라+우주인필드) > 토마토(우주인완제품)이면 폐기는 베샤멜만", () => {
    const summaries = [
      makeSummary({
        displayProductLabel: "허니고르곤졸라 - 일반",
        baseProductName: "허니고르곤졸라",
        finishedQty: 2003,
        inferredParbakeName: "베샤멜 파베이크",
      }),
    ];
    const state = emptyState({
      productOutputs: [],
      parbakeProductionByBase: [
        { parbakeName: "토마토 파베이크", astronautQty: 725, saleQty: 0 },
        { parbakeName: "베샤멜 파베이크", astronautQty: 712, saleQty: 0 },
      ],
      astronautParbakeQty: 1437,
      saleParbakeQty: 0,
      extraParbakes: [],
    });
    const types = ["토마토 파베이크", "베샤멜 파베이크"];
    const prod = computeParbakeProductionQtyByType(state, summaries, types);
    expect(prod.get("베샤멜 파베이크")).toBe(2003 + 712);
    expect(prod.get("토마토 파베이크")).toBe(725);
    expect(pickDominantParbakeType(prod, types)).toBe("베샤멜 파베이크");

    const mixed = resolveMixedParbakeWasteByDominantProduction(state, summaries, types, 75);
    expect(mixed.resolved.get("베샤멜 파베이크")).toBe(75);
    expect(mixed.resolved.get("토마토 파베이크")).toBe(0);
  });

  it("미니-only + 우주인 필드 → 보관용 라벨은 미니 토마토 파베이크", () => {
    const summaries = [
      makeSummary({
        displayProductLabel: "마르게리따 - 미니",
        baseProductName: "마르게리따",
        productStandardName: "미니",
        finishedQty: 3004,
        inferredParbakeName: "토마토 파베이크",
      }),
    ];
    const state = emptyState({
      productOutputs: [],
      parbakeProductionByBase: [
        { parbakeName: "토마토 파베이크", astronautQty: 187, saleQty: 0 },
      ],
      astronautParbakeQty: 187,
      saleParbakeQty: 0,
      extraParbakes: [],
    });
    const lines = buildParbakePurposeProductionLines(state, summaries, ["토마토 파베이크"]);
    expect(lines).toEqual([
      { role: "astronaut", parbakeName: "미니 토마토 파베이크", qty: 187 },
    ]);
  });

  it("일반+미니 혼합 + mini lane → 미니 토마토 파베이크", () => {
    const summaries = [
      makeSummary({
        displayProductLabel: "마르게리따 - 일반",
        baseProductName: "마르게리따",
        productStandardName: "일반",
        finishedQty: 2000,
        inferredParbakeName: "토마토 파베이크",
      }),
      makeSummary({
        displayProductLabel: "마르게리따 - 미니",
        baseProductName: "마르게리따",
        productStandardName: "미니",
        finishedQty: 500,
        inferredParbakeName: "토마토 파베이크",
      }),
    ];
    const state = emptyState({
      productOutputs: [],
      parbakeProductionByBase: [
        { parbakeName: "토마토 파베이크", astronautQty: 120, saleQty: 0 },
      ],
      astronautParbakeQty: 120,
      saleParbakeQty: 0,
      astronautParbakeSizeLane: "mini",
      extraParbakes: [],
    });
    const lines = buildParbakePurposeProductionLines(state, summaries, ["토마토 파베이크"]);
    expect(lines).toEqual([
      { role: "astronaut", parbakeName: "미니 토마토 파베이크", qty: 120 },
    ]);
  });

  it("일반+미니 혼합 + standard lane → 토마토 파베이크", () => {
    const summaries = [
      makeSummary({
        displayProductLabel: "마르게리따 - 일반",
        baseProductName: "마르게리따",
        productStandardName: "일반",
        finishedQty: 2000,
        inferredParbakeName: "토마토 파베이크",
      }),
      makeSummary({
        displayProductLabel: "마르게리따 - 미니",
        baseProductName: "마르게리따",
        productStandardName: "미니",
        finishedQty: 500,
        inferredParbakeName: "토마토 파베이크",
      }),
    ];
    const state = emptyState({
      productOutputs: [],
      parbakeProductionByBase: [
        { parbakeName: "토마토 파베이크", astronautQty: 120, saleQty: 0 },
      ],
      astronautParbakeQty: 120,
      saleParbakeQty: 0,
      astronautParbakeSizeLane: "standard",
      extraParbakes: [],
    });
    const lines = buildParbakePurposeProductionLines(state, summaries, ["토마토 파베이크"]);
    expect(lines).toEqual([
      { role: "astronaut", parbakeName: "토마토 파베이크", qty: 120 },
    ]);
  });

  it("베이스별 우주인 필드 → 목적별 생산량 두 줄", () => {
    const summaries = [
      makeSummary({
        displayProductLabel: "허니고르곤졸라 - 일반",
        baseProductName: "허니고르곤졸라",
        finishedQty: 2003,
        inferredParbakeName: "베샤멜 파베이크",
      }),
    ];
    const state = emptyState({
      productOutputs: [],
      parbakeProductionByBase: [
        { parbakeName: "토마토 파베이크", astronautQty: 725, saleQty: 0 },
        { parbakeName: "베샤멜 파베이크", astronautQty: 712, saleQty: 0 },
      ],
      astronautParbakeQty: 1437,
      saleParbakeQty: 0,
      extraParbakes: [],
    });
    const types = ["토마토 파베이크", "베샤멜 파베이크"];
    const lines = buildParbakePurposeProductionLines(state, summaries, types);
    expect(lines).toEqual(
      expect.arrayContaining([
        { role: "astronaut", parbakeName: "토마토 파베이크", qty: 725 },
        { role: "astronaut", parbakeName: "베샤멜 파베이크", qty: 712 },
      ])
    );
  });

  it("베샤멜 피자만 있어도 토마토 파베 생산량이 있으면 도우 토마토소스 메타 확보", () => {
    const summaries = [
      makeSummary({
        displayProductLabel: "허니고르곤졸라 - 일반",
        baseProductName: "허니고르곤졸라",
        finishedQty: 2003,
        inferredParbakeName: "베샤멜 파베이크",
        inferredBaseSauceMaterialName: "도우 베샤멜소스",
        inferredBaseSaucePerUnitQty: 80,
      }),
    ];
    const state = emptyState({
      productOutputs: [],
      parbakeProductionByBase: [
        { parbakeName: "토마토 파베이크", astronautQty: 725, saleQty: 0 },
        { parbakeName: "베샤멜 파베이크", astronautQty: 712, saleQty: 0 },
      ],
      astronautParbakeQty: 1437,
      saleParbakeQty: 0,
      extraParbakes: [],
    });
    const bomList: BomRowRef[] = [
      {
        productName: "마르게리따",
        materialName: "도우 토마토소스",
        bomGPerEa: 41,
        basis: "일반",
      },
    ];
    const types = ["베샤멜 파베이크", "토마토 파베이크"];
    const tomatoMeta = resolveBaseSauceMetaForParbakeType(
      "토마토 파베이크",
      summaries,
      state,
      types,
      bomList
    );
    expect(tomatoMeta?.baseSauceMaterialName).toBe("도우 토마토소스");
    expect(tomatoMeta?.weightedBaseSaucePerUnitQty).toBe(41);
  });
});

describe("inferParbakeMetaFromBom (미니-only)", () => {
  const miniBom: BomRowRef[] = [
    {
      productName: "허니페퍼로니 - 미니",
      materialName: "도우 토마토소스",
      bomGPerEa: 42,
      basis: "도우",
    },
  ];

  it("미니 BOM에서 토마토 파베이크를 추론한다", () => {
    const meta = inferParbakeMetaFromBom("허니페퍼로니", miniBom, "미니");
    expect(meta.inferredParbakeName).toBe("토마토 파베이크");
    expect(meta.inferredBaseSauceMaterialName).toBe("도우 토마토소스");
    expect(meta.warnings).toEqual([]);
  });

  it("일반 BOM만 있으면 미니 추론은 실패한다", () => {
    const meta = inferParbakeMetaFromBom("허니페퍼로니", miniBom, "일반");
    expect(meta.inferredParbakeName).toBeNull();
  });

  it("미니-only productSummaries → getDateParbakeTypes 비어 있지 않음", () => {
    const meta = inferParbakeMetaFromBom("허니페퍼로니", miniBom, "미니");
    const summaries = [
      makeSummary({
        displayProductLabel: "허니페퍼로니 - 미니",
        baseProductName: "허니페퍼로니",
        productStandardName: "미니",
        finishedQty: 3046,
        inferredParbakeName: meta.inferredParbakeName,
      }),
    ];
    expect(getDateParbakeTypes(summaries)).toEqual(["토마토 파베이크"]);
  });
});
