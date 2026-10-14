import { doughQtyToNumber, isFloorSplitDoughDate, type DoughQtyInput } from "./floorDough";

/** 병행 생산일 총괄에 같이 찍는 2층 피자 양식 */
export type PizzaJournalQty = {
  doughMixQty: number;
  doughWasteQty: number;
  doughUsageQty: number;
  parbakeWasteQty: number;
  sameDayParbakeProductionQty: number;
};

/** 병행 생산일 총괄에 같이 찍는 3층 브레드 양식 */
export type BreadJournalQty = {
  doughMixQty: number;
  doughWasteQty: number;
  doughUsageQty: number;
  breadWasteQty: number;
};

export type FloorJournalForms = {
  pizza: PizzaJournalQty;
  bread: BreadJournalQty;
};

/**
 * 2026-10-12부터 총괄 일지는 피자 양식과 브레드 양식을 같이 보여 준다.
 * 그 전 날짜는 null. 합산 도우 사용량·당일 파베이크 생산량은 계산 결과 그대로 둔다.
 * 피자 생산량(당일)은 피자만 있던 날과 같이 2층 도우 사용량과 같은 수다.
 */
export function floorJournalForms(input: {
  date: string;
  floor2DoughMixQty?: DoughQtyInput;
  floor2DoughWasteQty?: DoughQtyInput;
  floor3DoughMixQty?: DoughQtyInput;
  floor3DoughWasteQty?: DoughQtyInput;
  parbakeWasteQty: number;
  breadWasteQty: number;
  storedParbakeOnly: boolean;
}): FloorJournalForms | null {
  if (!isFloorSplitDoughDate(input.date)) return null;

  const floor2Mix = doughQtyToNumber(input.floor2DoughMixQty);
  const floor2Waste = doughQtyToNumber(input.floor2DoughWasteQty);
  const floor3Mix = doughQtyToNumber(input.floor3DoughMixQty);
  const floor3Waste = doughQtyToNumber(input.floor3DoughWasteQty);
  const floor2Entered = floor2Mix !== 0 || floor2Waste !== 0;
  const parbakeWasteForUsage = Math.max(0, input.parbakeWasteQty);
  const breadWasteForUsage = Math.max(0, input.breadWasteQty);
  const pizzaUsage =
    input.storedParbakeOnly && !floor2Entered
      ? 0
      : floor2Mix - floor2Waste - parbakeWasteForUsage;
  const breadUsage = floor3Mix - floor3Waste - breadWasteForUsage;

  return {
    pizza: {
      doughMixQty: floor2Mix,
      doughWasteQty: floor2Waste,
      doughUsageQty: pizzaUsage,
      parbakeWasteQty: input.parbakeWasteQty,
      sameDayParbakeProductionQty: pizzaUsage,
    },
    bread: {
      doughMixQty: floor3Mix,
      doughWasteQty: floor3Waste,
      doughUsageQty: breadUsage,
      breadWasteQty: input.breadWasteQty,
    },
  };
}
