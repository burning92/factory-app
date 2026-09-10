import { describe, expect, it } from "vitest";
import { qualificationLabel } from "./qualifications";
import { generateRotation } from "./rotationEngine";
import { applyShiftOverrides } from "./shiftSubstitute";
import { withDefaultStaffing } from "./staffing";
import { NIGHT_SHIFT } from "./workHours";
import {
  PERIODS,
  type PeriodId,
  type Person,
  type PositionCatalog,
  type PositionDef,
  type Priority,
  type ProcessId,
  type ProductGroup,
  type SavedPositionStaffing,
  type SkillMatrix,
} from "./types";

const GROUPS: ProductGroup[] = ["phono_signature", "phono_basil_corn", "phono_ricotta", "parbake"];
const GROUP: ProductGroup = "phono_signature";

/** 가열은 모든 구간 선택으로 둬서 18~19 결원만 보이게 한다 */
const OPTIONAL_HEAT: SavedPositionStaffing = {};
for (const period of PERIODS) OPTIONAL_HEAT[period.id] = { min: 0, max: 1 };

const ONE_EVERYWHERE: SavedPositionStaffing = {};
for (const period of PERIODS) ONE_EVERYWHERE[period.id] = { min: 1, max: 2 };

function catalogWith(positions: PositionDef[]): PositionCatalog {
  const next = {} as PositionCatalog;
  for (const group of GROUPS) next[group] = positions.map((p) => withDefaultStaffing({ ...p }));
  return next;
}

function testCatalog(): PositionCatalog {
  return catalogWith([
    { id: "h1", label: "가열 1", process: "heating", staffing: OPTIONAL_HEAT },
    { id: "close", label: "가열 마감", process: "heatingClose", staffing: { closing: { min: 2, max: 2 } } },
    { id: "inner", label: "내포장", process: "inner", staffing: ONE_EVERYWHERE },
    { id: "outer", label: "외포장", process: "outer", staffing: ONE_EVERYWHERE },
  ]);
}

function qual() {
  return { qualificationsByGroup: { [GROUP]: { threeSidePacker: true } } };
}

function person(id: string, preferred: ProcessId, extra?: Partial<Person>): Person {
  return {
    id,
    name: id,
    preferred,
    shift: extra?.shift ?? "0800-1800",
    group: "floor",
    present: extra?.present ?? true,
    leaveKind: extra?.leaveKind,
    constraints: extra?.constraints,
  };
}

function skillsFor(roster: Person[], catalog: PositionCatalog, ranks: Record<string, Record<string, Priority>>): SkillMatrix {
  const skills: SkillMatrix = {};
  for (const p of roster) {
    skills[p.id] = { phono_signature: {}, phono_basil_corn: {}, phono_ricotta: {}, parbake: {} };
    for (const group of GROUPS) {
      for (const pos of catalog[group]) skills[p.id][group]![pos.id] = ranks[p.id]?.[pos.id] ?? 0;
    }
  }
  return skills;
}

/** 09~19 5명이면 18~19 정원(가열 마감 2·내포장 1·외포장 1)이 찬다 */
function baseRoster(): Person[] {
  return [
    person("n-inner1", "inner", { shift: NIGHT_SHIFT, constraints: qual() }),
    person("n-inner2", "inner", { shift: NIGHT_SHIFT, constraints: qual() }),
    person("n-outer", "outer", { shift: NIGHT_SHIFT }),
    person("n-close1", "heating", { shift: NIGHT_SHIFT }),
    person("n-close2", "heating", { shift: NIGHT_SHIFT }),
    // 08~18조
    person("day-ready", "inner", { constraints: { ...qual(), nightShiftBackup: true } }),
    person("day-noqual", "inner", { constraints: { nightShiftBackup: true } }),
    person("day-notlisted", "inner", { constraints: qual() }),
    person("day-noskill", "outer", { constraints: { ...qual(), nightShiftBackup: true } }),
  ];
}

function skillsOf(roster: Person[], catalog: PositionCatalog): SkillMatrix {
  return skillsFor(roster, catalog, {
    "n-inner1": { inner: 1, h1: 3 },
    "n-inner2": { inner: 1, h1: 3 },
    "n-outer": { outer: 1 },
    "n-close1": { close: 1, h1: 1 },
    "n-close2": { close: 1, h1: 1 },
    "day-ready": { inner: 1, h1: 3 },
    "day-noqual": { inner: 1 },
    "day-notlisted": { inner: 1 },
    "day-noskill": { outer: 1 },
  });
}

function run(roster: Person[]) {
  const catalog = testCatalog();
  return generateRotation({
    roster,
    line: "phono_signature",
    modes: { lunch: false, breakRotation: false, splitShift: false },
    catalog,
    skills: skillsOf(roster, catalog),
  });
}

function stationOf(result: ReturnType<typeof run>, period: PeriodId, id: string) {
  return result.assignments[period].find((a) => a.personId === id)?.station;
}

describe("09~19 대체근무", () => {
  it("09~19 인원이 충분하면 추천하지 않는다", () => {
    const result = run(baseRoster());
    expect(result.substitutePlan).toBeUndefined();
  });

  it("09~19 결원으로 18~19 자리가 비면 부족한 자리와 후보를 알려준다", () => {
    const roster = baseRoster().map((p) =>
      p.id === "n-inner1" || p.id === "n-inner2" ? { ...p, leaveKind: "annual" as const } : p
    );
    const result = run(roster);
    const plan = result.substitutePlan!;
    expect(plan.gaps).toEqual([{ positionId: "inner", process: "inner", label: "내포장", missing: 1 }]);
    expect(plan.message).toContain("18~19 내포장 1명");
    // 숙련 0·자격 없음·대체 미지정은 후보가 아니다
    expect(plan.candidates.map((c) => c.personId)).toEqual(["day-ready"]);
    expect(plan.candidates[0].covers).toEqual(["내포장"]);
    expect(result.warnings.some((w) => w.message.includes("09~19 대체 가능자"))).toBe(true);
  });

  it("가열 마감 '상'이 남아 있으면 숙련이 낮아도 백업으로 채운다", () => {
    // n-close1(상)은 남고 n-close2(상)만 빠진다. 인원 1명만 모자란 상태다
    const roster = [
      ...baseRoster().map((p) => (p.id === "n-close2" ? { ...p, leaveKind: "annual" as const } : p)),
      person("day-close-low", "heating", { constraints: { nightShiftBackup: true } }),
    ];
    const catalog = testCatalog();
    const skills = skillsOf(roster, catalog);
    for (const g of GROUPS) skills["day-close-low"][g] = { close: 4 };
    const plan = generateRotation({
      roster,
      line: "phono_signature",
      modes: { lunch: false, breakRotation: false, splitShift: false },
      catalog,
      skills,
    }).substitutePlan!;
    expect(plan.gaps).toEqual([{ positionId: "close", process: "heatingClose", label: "가열 마감", missing: 1 }]);
    expect(plan.candidates.map((c) => c.personId)).toEqual(["day-close-low"]);
  });

  it("가열 마감 '상'이 휴가면 '상' 숙련자만 대체 후보가 된다", () => {
    // 남는 사람은 하 숙련뿐이라 마감을 이끌 '상'이 없다
    const roster = [
      ...baseRoster().map((p) => (p.id === "n-close1" ? { ...p, leaveKind: "annual" as const } : p)),
      person("day-close-top", "heating", { constraints: { nightShiftBackup: true } }),
      person("day-close-low", "heating", { constraints: { nightShiftBackup: true } }),
    ];
    const catalog = testCatalog();
    const skills = skillsOf(roster, catalog);
    for (const g of GROUPS) {
      skills["n-close2"][g] = { close: 4 };
      skills["day-close-top"][g] = { close: 1 };
      skills["day-close-low"][g] = { close: 4 };
    }
    const result = generateRotation({
      roster,
      line: "phono_signature",
      modes: { lunch: false, breakRotation: false, splitShift: false },
      catalog,
      skills,
    });
    const plan = result.substitutePlan!;
    expect(plan.gaps).toEqual([
      { positionId: "close", process: "heatingClose", label: "가열 마감", missing: 1, anchorRank: "상" },
    ]);
    expect(plan.message).toContain("가열 마감 상 숙련자 1명");
    expect(plan.candidates.map((c) => c.personId)).toEqual(["day-close-top"]);
    expect(result.warnings.some((w) => w.message.includes("상 숙련자가 필요합니다"))).toBe(true);
  });

  it("인원은 차도 삼면포장기 자격이 없으면 자격 결원으로 잡는다", () => {
    const roster = baseRoster()
      .filter((p) => p.id !== "n-inner2")
      .map((p) => (p.id === "n-inner1" ? { ...p, constraints: undefined } : p));
    const result = run(roster);
    const plan = result.substitutePlan!;
    const packer = qualificationLabel("threeSidePacker");
    expect(plan.gaps).toEqual([
      { positionId: "inner", process: "inner", label: "내포장", missing: 1, qualification: packer },
    ]);
    expect(plan.message).toContain(`${packer} 보유자 1명`);
    expect(plan.candidates.map((c) => c.personId)).toEqual(["day-ready"]);
  });

  it("숙련이 높은 사람을 먼저 추천한다", () => {
    const roster = [
      ...baseRoster().map((p) =>
        p.id === "n-inner1" || p.id === "n-inner2" ? { ...p, leaveKind: "annual" as const } : p
      ),
      person("day-slow", "inner", { constraints: { ...qual(), nightShiftBackup: true } }),
    ];
    const catalog = testCatalog();
    const skills = skillsOf(roster, catalog);
    skills["day-slow"] = { ...skills["day-slow"], [GROUP]: { ...skills["day-slow"][GROUP], inner: 3 } };
    for (const group of GROUPS) skills["day-slow"][group] = { ...skills["day-slow"][group], inner: 3 };
    const result = generateRotation({
      roster,
      line: "phono_signature",
      modes: { lunch: false, breakRotation: false, splitShift: false },
      catalog,
      skills,
    });
    expect(result.substitutePlan?.candidates.map((c) => c.personId)).toEqual(["day-ready", "day-slow"]);
  });

  it("대체를 확정하면 그날만 09~19로 일하고 결원이 사라진다", () => {
    const roster = baseRoster().map((p) =>
      p.id === "n-inner1" || p.id === "n-inner2" ? { ...p, leaveKind: "annual" as const } : p
    );
    const confirmed = applyShiftOverrides(roster, { "day-ready": NIGHT_SHIFT });
    const result = run(confirmed);

    expect(stationOf(result, "early", "day-ready")).toBe("arriving");
    expect(stationOf(result, "start", "day-ready")).toBe("inner");
    expect(stationOf(result, "closing", "day-ready")).toBe("inner");
    expect(result.substitutePlan?.gaps).toEqual([]);
    expect(result.substitutePlan?.confirmed).toEqual(["day-ready"]);
    // 기본 근무조는 그대로 둔다
    expect(roster.find((p) => p.id === "day-ready")?.shift).toBe("0800-1800");
    expect(confirmed.find((p) => p.id === "day-ready")?.shift).toBe("0800-1800");
  });

  it("다음날에는 기본 근무조로 돌아간다", () => {
    const roster = applyShiftOverrides(baseRoster(), { "day-ready": NIGHT_SHIFT });
    const nextDay = applyShiftOverrides(roster, {});
    expect(nextDay.find((p) => p.id === "day-ready")?.shiftOverride ?? null).toBeNull();
    const result = run(nextDay);
    expect(stationOf(result, "early", "day-ready")).not.toBe("outside");
    expect(stationOf(result, "early", "day-ready")).not.toBe("arriving");
    expect(stationOf(result, "closing", "day-ready")).toBe("outside");
  });
});

/** 근무시간 자체가 바뀌므로 18~19만이 아니라 전 시간대를 다시 계산해야 한다 */
describe("대체 확정 시 전체 재계산", () => {
  const recalcCatalog = () =>
    catalogWith([
      { id: "h1", label: "가열 1", process: "heating", staffing: OPTIONAL_HEAT },
      { id: "close", label: "가열 마감", process: "heatingClose", staffing: { closing: { min: 2, max: 2 } } },
      {
        id: "inner",
        label: "내포장",
        process: "inner",
        staffing: { ...ONE_EVERYWHERE, early: { min: 0, max: 1 } },
      },
      {
        id: "outer",
        label: "외포장",
        process: "outer",
        staffing: { ...ONE_EVERYWHERE, early: { min: 1, max: 1 } },
      },
    ]);

  /** 08~09 외포장 1자리를 day-ready(1순위)와 spare(2순위)가 놓고 겨룬다 */
  function recalcRoster(): Person[] {
    return [
      person("n-inner", "inner", { shift: NIGHT_SHIFT, constraints: qual(), leaveKind: "annual" }),
      person("n-outer", "outer", { shift: NIGHT_SHIFT }),
      person("n-close1", "heating", { shift: NIGHT_SHIFT }),
      person("n-close2", "heating", { shift: NIGHT_SHIFT }),
      person("day-ready", "inner", { constraints: { ...qual(), nightShiftBackup: true } }),
      person("spare", "outer"),
    ];
  }

  function runRecalc(roster: Person[]) {
    const catalog = recalcCatalog();
    const skills = skillsFor(roster, catalog, {
      "n-inner": { inner: 1 },
      "n-outer": { outer: 1 },
      "n-close1": { close: 1, h1: 1 },
      "n-close2": { close: 1, h1: 1 },
      "day-ready": { inner: 1, outer: 1 },
      spare: { outer: 2 },
    });
    return generateRotation({
      roster,
      line: "phono_signature",
      modes: { lunch: false, breakRotation: false, splitShift: false },
      catalog,
      skills,
    });
  }

  function holderOf(result: ReturnType<typeof runRecalc>, period: PeriodId, positionId: string) {
    return result.assignments[period].find((a) => a.positionId === positionId)?.personId;
  }

  const base = recalcRoster();
  const before = runRecalc(base);
  const after = runRecalc(applyShiftOverrides(base, { "day-ready": NIGHT_SHIFT }));

  it("확정 전에는 08~09 외포장을 맡고 18~19 내포장이 비어 있다", () => {
    expect(holderOf(before, "early", "outer")).toBe("day-ready");
    expect(holderOf(before, "closing", "inner")).toBeUndefined();
    expect(before.checks.find((c) => c.id === "count:closing:inner")?.ok).toBe(false);
  });

  it("08~09 배치에서 즉시 빠지고 9시 출근으로 표시된다", () => {
    expect(stationOf(after, "early", "day-ready")).toBe("arriving");
  });

  it("08~09에 생긴 빈자리를 다른 근무 가능자가 채운다", () => {
    expect(holderOf(after, "early", "outer")).toBe("spare");
  });

  it("09~11부터는 일반 09~19 인원과 똑같이 배치 후보가 된다", () => {
    for (const period of ["start", "lunch1", "lunch2", "after", "late", "evening"] as const) {
      expect(stationOf(after, period, "day-ready")).not.toBe("outside");
      expect(stationOf(after, period, "day-ready")).not.toBe("arriving");
    }
  });

  it("18~19 부족했던 공정에 실제로 들어간다", () => {
    expect(holderOf(after, "closing", "inner")).toBe("day-ready");
  });

  it("전체를 다시 계산해 검증도 다시 돈다", () => {
    expect(after.checks.find((c) => c.id === "count:closing:inner")?.ok).toBe(true);
    expect(after.checks.find((c) => c.id === "count:early:outer")?.ok).toBe(true);
    expect(after.checks.find((c) => c.id === "qual:closing:inner:threeSidePacker")?.ok).toBe(true);
    // 숙련 0인 자리에는 들어가지 않는다
    for (const period of PERIODS) {
      const row = after.assignments[period.id].find((a) => a.personId === "spare");
      expect(row?.positionId ?? "outer").toBe("outer");
    }
  });

  it("주공정 고정 조건은 대체 후에도 그대로 지켜진다", () => {
    const locked = recalcRoster().map((p) =>
      p.id === "day-ready" ? { ...p, constraints: { ...p.constraints, lockPreferred: true } } : p
    );
    const result = runRecalc(applyShiftOverrides(locked, { "day-ready": NIGHT_SHIFT }));
    for (const period of PERIODS) {
      const row = result.assignments[period.id].find((a) => a.personId === "day-ready");
      expect(row?.positionId ?? "inner").toBe("inner");
    }
  });

  it("해제하면 원래 08~18 기준으로 전체가 다시 계산된다", () => {
    const released = runRecalc(applyShiftOverrides(base, {}));
    expect(holderOf(released, "early", "outer")).toBe("day-ready");
    expect(stationOf(released, "closing", "day-ready")).toBe("outside");
    expect(released.checks.find((c) => c.id === "count:closing:inner")?.ok).toBe(false);
  });
});
