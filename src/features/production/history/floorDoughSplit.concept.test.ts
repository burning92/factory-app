/**
 * 구상 검증용. 생산 계산에는 연결하지 않는다.
 *
 * 2층은 당일 도우로 피자를 만들고, 3층은 브레드를 만든다.
 * 원료(밀가루 등)는 날짜당 한 벌로 두고, 도우 개수만 층별로 나눈다.
 * 층 폐기(개) = 그 층에 넘긴 도우 − 그 층 완제품 − (피자만) 보관으로 남긴 파베이크.
 */
import { describe, expect, it } from "vitest";
import { calculateBreadDerived } from "./breadDerived";
import { calculateUsageSummary } from "./calculations";
import type { BomRowRef, DateGroupInput, ProductOutputInput } from "./types";

const FLOUR_USAGE_G = 48_000;
const SAUCE_G_PER_EA = 15;
const RICOTTA_G_PER_EA = 8;

const BOM: BomRowRef[] = [
  {
    productName: "마르게리따 - 일반",
    materialName: "도우소스 토마토",
    bomGPerEa: SAUCE_G_PER_EA,
    basis: "도우",
  },
  {
    productName: "마르게리따 - 파베이크사용",
    materialName: "도우소스 토마토",
    bomGPerEa: SAUCE_G_PER_EA,
    basis: "도우",
  },
  {
    productName: "갈릭브레드 - 브레드",
    materialName: "브레드 리코타치즈",
    bomGPerEa: RICOTTA_G_PER_EA,
    basis: "완제품",
  },
];

/** 현장 예시. 합치면 도우 1400개인데, 층별 폐기는 합만으로는 안 나온다. */
const SAMPLE = {
  pizzaDoughQty: 1000,
  breadDoughQty: 400,
  pizzaFinishedQty: 920,
  breadFinishedQty: 370,
  keptParbakeQty: 30,
  pizzaWasteQty: 50,
  breadWasteQty: 30,
};

type FloorDoughInput = {
  /** 2층 피자 라인에 넘긴 도우 개수. 파베이크사용 피자만 있는 날이면 0. */
  pizzaDoughQty: number;
  /** 3층 브레드 라인에 넘긴 도우 개수. */
  breadDoughQty: number;
  pizzaFinishedQty: number;
  breadFinishedQty: number;
  /** 2층에서 완제품으로 안 나가고 보관(우주인·판매)으로 남긴 파베이크 개수. */
  keptParbakeQty: number;
};

type FloorDoughWaste = {
  pizzaWasteQty: number;
  breadWasteQty: number;
  pizzaWasteNegative: boolean;
  breadWasteNegative: boolean;
};

function calculateFloorDoughWaste(input: FloorDoughInput): FloorDoughWaste {
  const pizzaWasteQty =
    input.pizzaDoughQty - input.pizzaFinishedQty - input.keptParbakeQty;
  const breadWasteQty = input.breadDoughQty - input.breadFinishedQty;
  return {
    pizzaWasteQty,
    breadWasteQty,
    pizzaWasteNegative: pizzaWasteQty < 0,
    breadWasteNegative: breadWasteQty < 0,
  };
}

/** 합계 도우만 알 때, 음이 아닌 정수로 가능한 (피자폐기, 브레드폐기) 쌍. */
function feasibleWasteSplits(totalLeftoverQty: number): Array<[number, number]> {
  const splits: Array<[number, number]> = [];
  for (let pizzaWaste = 0; pizzaWaste <= totalLeftoverQty; pizzaWaste += 1) {
    splits.push([pizzaWaste, totalLeftoverQty - pizzaWaste]);
  }
  return splits;
}

function output(
  name: string,
  standard: "일반" | "브레드" | "파베이크사용",
  qty: number
): ProductOutputInput {
  return {
    productOutputId: `${name}-${standard}`,
    productKey: `${name}-${standard}`,
    productName: name,
    standardName: standard,
    displayProductLabel: `${name} - ${standard}`,
    baseProductName: name,
    productStandardName: standard,
    finishedQty: qty,
  };
}

function dateGroup(
  doughMixQty: number,
  outputs: ProductOutputInput[],
  saleParbakeQty: number | "" = ""
): DateGroupInput {
  return {
    id: "concept",
    date: "2026-10-01",
    doughMixQty,
    doughWasteQty: 0,
    materials: [
      {
        materialCardId: "flour",
        materialName: "밀가루",
        lots: [
          {
            lotRowId: "flour-1",
            sourceType: "manual",
            expiryDate: "2027-01-01",
            outboundQty: FLOUR_USAGE_G,
            prevDayUnitCount: "",
            prevDayRemainderG: "",
            currentDayUnitCount: "",
            currentDayRemainderG: "",
          },
        ],
      },
      {
        materialCardId: "sauce",
        materialName: "도우소스 토마토",
        lots: [
          {
            lotRowId: "sauce-1",
            sourceType: "manual",
            expiryDate: "2027-01-01",
            outboundQty: 20_000,
            prevDayUnitCount: "",
            prevDayRemainderG: "",
            currentDayUnitCount: "",
            currentDayRemainderG: "",
          },
        ],
      },
    ],
    products: [],
    secondClosure: {
      productOutputs: outputs,
      astronautParbakeQty: "",
      saleParbakeQty,
      extraParbakes: [],
    },
  };
}

describe("현재 엔진 — 도우가 하나일 때", () => {
  it("브레드 + 피자 파베이크사용이면 당일 도우 잔량은 브레드 폐기로만 잡힌다", () => {
    const result = calculateUsageSummary(
      dateGroup(400, [
        output("갈릭브레드", "브레드", 370),
        output("마르게리따", "파베이크사용", 920),
      ]),
      BOM
    );

    expect(result.generalDoughFinishedQty).toBe(0);
    expect(result.breadWasteQty).toBe(30);
    expect(result.parbakeWasteQty).toBe(0);
    expect(result.doughUsageQty).toBe(370);
    expect(result.lotUsages.find((l) => l.materialName === "밀가루")?.actualUsageQty).toBe(
      FLOUR_USAGE_G
    );
  });

  it("2층 피자가 당일 도우면 합산 도우 하나로는 층별 폐기가 실제와 어긋난다", () => {
    const result = calculateUsageSummary(
      dateGroup(
        SAMPLE.pizzaDoughQty + SAMPLE.breadDoughQty,
        [
          output("마르게리따", "일반", SAMPLE.pizzaFinishedQty),
          output("갈릭브레드", "브레드", SAMPLE.breadFinishedQty),
        ],
        SAMPLE.keptParbakeQty
      ),
      BOM
    );
    const bread = calculateBreadDerived(
      dateGroup(0, []),
      result,
      BOM
    );
    const ricottaWasteG =
      bread.products[0]?.ingredientWasteRows.find((r) => r.materialName === "브레드 리코타치즈")
        ?.wasteQty ?? 0;

    expect(result.breadWasteQty).toBe(110);
    expect(result.parbakeWasteQty).toBe(80);
    expect(result.doughUsageQty).toBe(1210);
    expect(result.directDoughBalanceQty).not.toBe(0);
    expect(ricottaWasteG).toBe(110 * RICOTTA_G_PER_EA);
    expect(result.baseWaste.baseWasteQty).toBe(80 * SAUCE_G_PER_EA);
    expect(result.lotUsages.find((l) => l.materialName === "밀가루")?.actualUsageQty).toBe(
      FLOUR_USAGE_G
    );
  });
});

describe("구상 — 도우 개수만 2층/3층으로 나눈다", () => {
  it("넘긴 개수에서 완제품과 보관 파베이크를 빼면 층 폐기가 각각 나온다", () => {
    const waste = calculateFloorDoughWaste({
      pizzaDoughQty: SAMPLE.pizzaDoughQty,
      breadDoughQty: SAMPLE.breadDoughQty,
      pizzaFinishedQty: SAMPLE.pizzaFinishedQty,
      breadFinishedQty: SAMPLE.breadFinishedQty,
      keptParbakeQty: SAMPLE.keptParbakeQty,
    });

    expect(waste.pizzaWasteQty).toBe(SAMPLE.pizzaWasteQty);
    expect(waste.breadWasteQty).toBe(SAMPLE.breadWasteQty);
    expect(waste.pizzaWasteQty * SAUCE_G_PER_EA).toBe(750);
    expect(waste.breadWasteQty * RICOTTA_G_PER_EA).toBe(240);
  });

  it("파베이크사용 피자만 있으면 피자 도우를 0으로 두고 브레드 잔량만 폐기가 된다", () => {
    const waste = calculateFloorDoughWaste({
      pizzaDoughQty: 0,
      breadDoughQty: 400,
      pizzaFinishedQty: 0,
      breadFinishedQty: 370,
      keptParbakeQty: 0,
    });

    expect(waste).toMatchObject({
      pizzaWasteQty: 0,
      breadWasteQty: 30,
      pizzaWasteNegative: false,
      breadWasteNegative: false,
    });
  });

  it("도우 합계만 있으면 같은 잔량을 두 층에 나누는 방법이 여러 개다", () => {
    const leftover =
      SAMPLE.pizzaDoughQty +
      SAMPLE.breadDoughQty -
      SAMPLE.pizzaFinishedQty -
      SAMPLE.breadFinishedQty -
      SAMPLE.keptParbakeQty;
    const splits = feasibleWasteSplits(leftover);

    expect(leftover).toBe(80);
    expect(splits).toContainEqual([50, 30]);
    expect(splits).toContainEqual([80, 0]);
    expect(splits).toContainEqual([0, 80]);
    expect(splits.length).toBe(81);
  });

  it("한 층이 모자라면 다른 층 잔량으로 메우지 않는다", () => {
    const waste = calculateFloorDoughWaste({
      pizzaDoughQty: 900,
      breadDoughQty: 400,
      pizzaFinishedQty: 920,
      breadFinishedQty: 370,
      keptParbakeQty: 30,
    });

    expect(waste.pizzaWasteQty).toBe(-50);
    expect(waste.pizzaWasteNegative).toBe(true);
    expect(waste.breadWasteQty).toBe(30);
  });
});
