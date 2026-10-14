import { describe, expect, it } from "vitest";
import { calculateUsageSummary } from "./calculations";
import { floorJournalForms } from "./floorJournalQty";
import type { BomRowRef, DateGroupInput } from "./types";

const BOM: BomRowRef[] = [
  {
    productName: "파이브치즈 - 일반",
    materialName: "도우 토마토소스",
    bomGPerEa: 60,
    basis: "도우",
  },
];

function oct12(): DateGroupInput {
  return {
    id: "2026-10-12",
    date: "2026-10-12",
    doughMixQty: 0,
    doughWasteQty: 0,
    floor2DoughMixQty: 3840,
    floor2DoughWasteQty: 26,
    floor3DoughMixQty: 3000,
    floor3DoughWasteQty: 132,
    materials: [],
    products: [],
    secondClosure: {
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
          productKey: "포노 - 브레드",
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
  };
}

describe("floorJournalForms", () => {
  it("10월 12일은 피자 양식과 브레드 양식을 같이 만든다", () => {
    const input = oct12();
    const result = calculateUsageSummary(input, BOM);
    const forms = floorJournalForms({
      date: input.date,
      floor2DoughMixQty: input.floor2DoughMixQty,
      floor2DoughWasteQty: input.floor2DoughWasteQty,
      floor3DoughMixQty: input.floor3DoughMixQty,
      floor3DoughWasteQty: input.floor3DoughWasteQty,
      parbakeWasteQty: result.parbakeWasteQty,
      breadWasteQty: result.breadWasteQty,
      storedParbakeOnly: false,
    });

    expect(result.doughUsageQty).toBe(6415);
    expect(forms).toEqual({
      pizza: {
        doughMixQty: 3840,
        doughWasteQty: 26,
        doughUsageQty: 3702,
        parbakeWasteQty: 112,
        sameDayParbakeProductionQty: 3702,
      },
      bread: {
        doughMixQty: 3000,
        doughWasteQty: 132,
        doughUsageQty: 2713,
        breadWasteQty: 155,
      },
    });
  });

  it("10월 12일 전은 층 양식을 만들지 않는다", () => {
    expect(
      floorJournalForms({
        date: "2026-10-07",
        floor2DoughMixQty: 4968,
        floor2DoughWasteQty: 49,
        parbakeWasteQty: 155,
        breadWasteQty: 0,
        storedParbakeOnly: false,
      })
    ).toBeNull();
  });
});
