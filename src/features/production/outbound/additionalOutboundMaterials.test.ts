import { describe, expect, it } from "vitest";
import {
  getBomMaterialNamesForAdditionalOutbound,
  getMaterialQuantityType,
  listAdditionalOutboundProducts,
  planAdditionalOutbound,
  validateAdditionalOutboundQty,
} from "./additionalOutboundMaterials";

describe("getMaterialQuantityType", () => {
  it("박스/낱개 중량 없으면 g 전용", () => {
    expect(getMaterialQuantityType({ boxWeightG: 0, unitWeightG: 0 })).toBe("g_only");
    expect(getMaterialQuantityType(undefined)).toBe("g_only");
  });

  it("박스 없이 낱개 중량만 있으면 낱개 전용", () => {
    expect(getMaterialQuantityType({ boxWeightG: 0, unitWeightG: 500 })).toBe("ea_only");
  });

  it("박스 중량이 있으면 박스+낱개", () => {
    expect(getMaterialQuantityType({ boxWeightG: 10000, unitWeightG: 500 })).toBe("box_ea");
  });
});

describe("validateAdditionalOutboundQty", () => {
  it("g 전용은 g가 있어야 함", () => {
    expect(validateAdditionalOutboundQty("g_only", 1, 1, 0)).toMatch(/g/);
    expect(validateAdditionalOutboundQty("g_only", 0, 0, 100)).toBeNull();
  });

  it("박스형은 셋 중 하나만 있어도 됨", () => {
    expect(validateAdditionalOutboundQty("box_ea", 1, 0, 0)).toBeNull();
    expect(validateAdditionalOutboundQty("box_ea", 0, 0, 0)).not.toBeNull();
  });
});

describe("planAdditionalOutbound", () => {
  it("같은 원료가 있으면 append", () => {
    expect(
      planAdditionalOutbound(
        [
          { id: "a", 원료명: "버터" },
          { id: "b", 원료명: "소금" },
        ],
        "소금"
      )
    ).toEqual({ action: "append", logId: "b" });
  });

  it("없으면 create", () => {
    expect(planAdditionalOutbound([{ id: "a", 원료명: "버터" }], "소금")).toEqual({
      action: "create",
    });
  });
});

describe("listAdditionalOutboundProducts", () => {
  it("해당 날짜 제품만 묶는다", () => {
    const list = listAdditionalOutboundProducts(
      [
        { 생산일자: "2026-08-21", 제품명: "갈릭바게트", 원료명: "버터", 출고자: "김출고" },
        { 생산일자: "2026-08-21", 제품명: "갈릭바게트", 원료명: "소금" },
        { 생산일자: "2026-08-20", 제품명: "식빵", 원료명: "밀가루" },
      ],
      "2026-08-21"
    );
    expect(list).toEqual([
      { productName: "갈릭바게트", author: "김출고", materialNames: ["버터", "소금"] },
    ]);
  });
});

describe("getBomMaterialNamesForAdditionalOutbound", () => {
  it("일반 제품은 해당 BOM만", () => {
    const map = new Map<string, string[]>([
      ["식빵", ["밀가루", "소금"]],
      ["갈릭바게트", ["버터"]],
    ]);
    expect(getBomMaterialNamesForAdditionalOutbound("식빵", map)).toEqual(["밀가루", "소금"]);
  });
});
