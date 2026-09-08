import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG, clearGroupSkills, heatingPositions, withFixedPhonoHeating } from "./catalog";
import { catalogFromRows } from "./persist";
import type { Person, PositionDef, ShiftId, SkillMatrix } from "./types";

const PHONO_ORDER = ["도우따기", "도우 누르기", "스트레쳐 전", "내용물 충진", "접기", "화덕 투입 보조", "받기"];

function worker(id: string): Person {
  return { id, name: id, preferred: "heating", shift: "0800-1800" as ShiftId, group: "floor", present: true };
}

describe("포노 가열 자리", () => {
  it("시그니처·바질은 공정 순서대로 7자리다", () => {
    for (const group of ["phono_signature", "phono_basil_corn"] as const) {
      expect(heatingPositions(DEFAULT_CATALOG, group).map((p) => p.label)).toEqual(PHONO_ORDER);
    }
  });

  it("리코타는 리코타 배합이 8번째로 붙는다", () => {
    expect(heatingPositions(DEFAULT_CATALOG, "phono_ricotta").map((p) => p.label)).toEqual([
      ...PHONO_ORDER,
      "리코타 배합",
    ]);
  });

  it("시그니처에서 복사해 자리 ID가 달라도 순서대로 이름을 입힌다", () => {
    const copied: PositionDef[] = [
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `phono_basil_corn__heating__${i}`,
        label: `성형기 통과 후 정형 ${i}`,
        process: "heating" as const,
      })),
      { id: "phono_basil_corn__inner__7", label: "내포장", process: "inner" },
    ];
    const fixed = withFixedPhonoHeating("phono_basil_corn", copied);
    expect(fixed.filter((p) => p.process === "heating").map((p) => p.label)).toEqual(PHONO_ORDER);
    expect(fixed.map((p) => p.id)).toEqual(copied.map((p) => p.id));
    expect(fixed[7].label).toBe("내포장");
  });

  it("리코타에 가열이 7자리뿐이면 리코타 배합을 뒤에 채운다", () => {
    const copied: PositionDef[] = [
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `phono_ricotta__heating__${i}`,
        label: `가열 ${i + 1}`,
        process: "heating" as const,
      })),
      { id: "phono_ricotta__inner__7", label: "내포장", process: "inner" },
    ];
    const fixed = withFixedPhonoHeating("phono_ricotta", copied);
    expect(fixed.filter((p) => p.process === "heating").map((p) => p.label)).toEqual([...PHONO_ORDER, "리코타 배합"]);
    expect(fixed[7].id).toBe("ricotta-heat-8");
    expect(fixed[8].label).toBe("내포장");
  });

  it("포노 가열 외 자리와 파베이크는 그대로 둔다", () => {
    const parbake = withFixedPhonoHeating("parbake", DEFAULT_CATALOG.parbake);
    expect(parbake).toEqual(DEFAULT_CATALOG.parbake);
    const sig = withFixedPhonoHeating("phono_signature", [
      { id: "sig-inner", label: "내포장 · 삼면", process: "inner" },
      ...DEFAULT_CATALOG.phono_signature.filter((p) => p.process === "heating"),
    ]);
    expect(sig[0].label).toBe("내포장 · 삼면");
  });

  it("DB 행을 읽을 때도 포노 가열 이름이 고정된다", () => {
    const catalog = catalogFromRows([
      {
        product_group: "phono_basil_corn",
        position_id: "phono_basil_corn__heating__3",
        process: "heating",
        label: "성형기 통과 후 정형(스트레쳐 후)",
        sort_order: 0,
      },
      {
        product_group: "phono_basil_corn",
        position_id: "phono_basil_corn__inner__1",
        process: "inner",
        label: "내포장",
        sort_order: 1,
      },
    ]);
    expect(catalog.phono_basil_corn.filter((p) => p.process === "heating").map((p) => p.label)).toEqual(PHONO_ORDER);
    expect(catalog.phono_basil_corn.filter((p) => p.process === "inner")).toHaveLength(1);
  });

  it("저장본에 없던 가열 마감 자리를 채워 넣는다", () => {
    const catalog = catalogFromRows([
      {
        product_group: "phono_signature",
        position_id: "phono_signature__inner__1",
        process: "inner",
        label: "내포장",
        sort_order: 0,
      },
    ]);
    const close = catalog.phono_signature.filter((p) => p.process === "heatingClose");
    expect(close).toHaveLength(1);
    expect(close[0].staffing?.closing).toEqual({ min: 4, max: 4 });
  });
});

describe("제품군 숙련 초기화", () => {
  it("해당 제품군만 0으로 되돌리고 다른 제품군은 남긴다", () => {
    const roster = [worker("a"), worker("b")];
    const skills: SkillMatrix = {
      a: { phono_signature: { "sig-heat-1": 1 }, parbake: { "pb-pick": 2 } },
      b: { phono_signature: { "sig-heat-2": 3 } },
    };
    const next = clearGroupSkills(skills, roster, DEFAULT_CATALOG, "phono_signature");
    expect(next.a.phono_signature?.["sig-heat-1"]).toBe(0);
    expect(next.b.phono_signature?.["sig-heat-2"]).toBe(0);
    expect(next.a.parbake?.["pb-pick"]).toBe(2);
  });
});
