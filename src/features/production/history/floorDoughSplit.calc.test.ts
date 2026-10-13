import { describe, expect, it } from "vitest";
import { calculateBreadDerived } from "./breadDerived";
import { calculateUsageSummary } from "./calculations";
import type { BomRowRef, DateGroupInput } from "./types";

const BOM: BomRowRef[] = [
  {
    productName: "파이브치즈 - 일반",
    materialName: "도우 토마토소스",
    bomGPerEa: 60,
    basis: "도우",
  },
  {
    productName: "포노부오노 시그니처 화덕 브레드 팩 - 브레드",
    materialName: "브레드 그라나파다노파우더",
    bomGPerEa: 20,
    basis: "완제품",
  },
];

function group(partial: Partial<DateGroupInput> & Pick<DateGroupInput, "date">): DateGroupInput {
  return {
    id: partial.date,
    doughMixQty: partial.doughMixQty ?? "",
    doughWasteQty: partial.doughWasteQty ?? "",
    floor2DoughMixQty: partial.floor2DoughMixQty,
    floor2DoughWasteQty: partial.floor2DoughWasteQty,
    floor3DoughMixQty: partial.floor3DoughMixQty,
    floor3DoughWasteQty: partial.floor3DoughWasteQty,
    materials: partial.materials ?? [
      {
        materialCardId: "sauce",
        materialName: "도우 토마토소스",
        lots: [
          {
            lotRowId: "s1",
            sourceType: "manual",
            expiryDate: "2026-12-22",
            outboundQty: 90000,
            prevDayUnitCount: "",
            prevDayRemainderG: 8000,
            currentDayUnitCount: "",
            currentDayRemainderG: 0,
          },
        ],
      },
    ],
    products: [],
    secondClosure: partial.secondClosure ?? {
      productOutputs: [
        {
          productOutputId: "five",
          productKey: "파이브치즈 - 일반",
          productName: "파이브치즈",
          standardName: "일반",
          baseProductName: "파이브치즈",
          productStandardName: "일반",
          finishedQty: 1703,
        },
        {
          productOutputId: "marg",
          productKey: "마르게리따 - 파베이크사용",
          productName: "마르게리따",
          standardName: "파베이크사용",
          baseProductName: "마르게리따",
          productStandardName: "파베이크사용",
          finishedQty: 362,
        },
        {
          productOutputId: "bread",
          productKey: "포노부오노 시그니처 화덕 브레드 팩 - 브레드",
          productName: "포노부오노 시그니처 화덕 브레드 팩",
          standardName: "브레드",
          baseProductName: "포노부오노 시그니처 화덕 브레드 팩",
          productStandardName: "브레드",
          finishedQty: 2713,
        },
      ],
      astronautParbakeQty: 797,
      saleParbakeQty: 1000,
      extraParbakes: [
        {
          extraParbakeId: "ex",
          qty: 160,
          manufacturedDate: "2026-10-08",
          parbakeName: "토마토 파베이크",
        },
      ],
    },
    ...partial,
    date: partial.date,
  };
}

describe("2026-10-12 층별 도우", () => {
  it("2층은 기존 파베이크 폐기식, 3층은 브레드 잔량식", () => {
    const input = group({
      date: "2026-10-12",
      doughMixQty: 0,
      doughWasteQty: 0,
      floor2DoughMixQty: 3840,
      floor2DoughWasteQty: 26,
      floor3DoughMixQty: 3000,
      floor3DoughWasteQty: 132,
    });
    const sauceRemainder = input.materials[0]!.lots[0]!.currentDayRemainderG;
    const result = calculateUsageSummary(input, BOM);
    const bread = calculateBreadDerived(input, result, BOM);

    expect(result.parbakeWasteQty).toBe(112);
    expect(result.breadWasteQty).toBe(155);
    expect(result.doughMixQty).toBe(6840);
    expect(result.doughWasteQty).toBe(158);
    expect(result.directDoughBalanceQty).toBe(0);
    expect(result.baseWaste.baseWasteQty).toBe(112 * 60);
    expect(bread.products[0]?.breadWasteQty).toBe(155);
    expect(bread.products[0]?.ingredientWasteRows[0]?.wasteQty).toBe(155 * 20);
    expect(input.materials[0]!.lots[0]!.currentDayRemainderG).toBe(sauceRemainder);
  });

  it("10월 12일 전 단일 도우는 브레드 쪽에 잔량을 둔다", () => {
    const result = calculateUsageSummary(
      group({
        date: "2026-10-11",
        doughMixQty: 400,
        doughWasteQty: 0,
        secondClosure: {
          productOutputs: [
            {
              productOutputId: "bread",
              productKey: "포노 - 브레드",
              productName: "포노부오노 시그니처 화덕 브레드 팩",
              standardName: "브레드",
              baseProductName: "포노부오노 시그니처 화덕 브레드 팩",
              productStandardName: "브레드",
              finishedQty: 370,
            },
            {
              productOutputId: "marg",
              productKey: "마르게리따 - 파베이크사용",
              productName: "마르게리따",
              standardName: "파베이크사용",
              baseProductName: "마르게리따",
              productStandardName: "파베이크사용",
              finishedQty: 920,
            },
          ],
          astronautParbakeQty: "",
          saleParbakeQty: "",
          extraParbakes: [],
        },
      }),
      BOM
    );
    expect(result.breadWasteQty).toBe(30);
    expect(result.parbakeWasteQty).toBe(0);
  });
});
