/**
 * 2026-09-09 수기 운영표 흐름을 엔진이 그대로 표현하는지 확인한다.
 * 인원·근무조·가능 공정은 그날 수기표에서 뽑았고, 정원은 그날 실제 배치 인원에 맞춰 둔다.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG, getPriority } from "./catalog";
import { generateRotation } from "./rotationEngine";
import { patchPositionStaffing, seatRequiredIn } from "./staffing";
import {
  PERIODS,
  type PeriodId,
  type Person,
  type PositionCatalog,
  type Priority,
  type ProcessId,
  type ProductGroup,
  type SkillMatrix,
} from "./types";

const GROUP: ProductGroup = "phono_ricotta";
/** 리코타 배합 자리 */
const OPTIONAL_SEAT = "ricotta-heat-8";

/** 반죽 고정조: 06시 출근, 15:30 퇴근 */
const DAWN = ["조선영", "이진화", "이병일"];
/** 09시 출근, 19시 퇴근 */
const NIGHT = [
  "임정우",
  "윤상혁",
  "송문광",
  "김성미",
  "차유진",
  "한상혁",
  "최대열",
  "신규2",
  "신규3",
  "신규4",
  "이두승",
  "신미경",
];

const PREFERRED: Record<string, ProcessId> = {
  조선영: "dough",
  이진화: "dough",
  이병일: "dough",
  임정우: "heating",
  김다슬: "heating",
  김옥: "heating",
  손학모: "heating",
  조형래: "heating",
  홍수정: "heating",
  김성미: "heating",
  윤상혁: "heating",
  송문광: "heating",
  한진: "heating",
  김소영: "inner",
  김성아: "inner",
  심수덕: "inner",
  이두승: "inner",
  신미경: "inner",
  최대열: "inner",
  차유진: "inner",
  신규2: "inner",
  신규4: "inner",
  곽민정: "outer",
  한상수: "outer",
  한상혁: "outer",
  신규3: "outer",
  김순이: "topping",
  고은주: "topping",
  장야핑: "topping",
  최민권: "office",
  김동호: "office",
};

/** 수기표에서 실제로 그 공정에 선 적이 있는 사람 */
const CAPABLE: Record<ProcessId, string[]> = {
  heating: [
    "임정우",
    "김다슬",
    "김옥",
    "손학모",
    "조형래",
    "홍수정",
    "김성미",
    "윤상혁",
    "송문광",
    "김성아",
    "고은주",
    "장야핑",
    "심수덕",
    "조선영",
    "이진화",
    "이병일",
  ],
  // 가열 마감 숙련은 따로 지정한다. 18~19에 남는 09~19 가열 인원이다
  heatingClose: ["임정우", "윤상혁", "송문광", "김성미"],
  inner: ["김소영", "김성아", "심수덕", "이두승", "신미경", "최대열", "차유진", "신규2", "신규4", "고은주"],
  outer: ["곽민정", "한상수", "한상혁", "신규3", "심수덕"],
  topping: ["김순이", "김성아", "고은주", "장야핑", "홍수정", "심수덕"],
  dough: DAWN,
  rnd: [],
  office: ["최민권", "김동호"],
};

const OFFICE = new Set(["최민권", "김동호"]);
const INNER_QUAL = new Set(CAPABLE.inner);

function shiftOf(name: string): string {
  if (DAWN.includes(name)) return "0600-1530";
  if (NIGHT.includes(name)) return "0900-1900";
  return "0800-1800";
}

function buildRoster(): Person[] {
  return Object.keys(PREFERRED).map((name) => ({
    id: name,
    name,
    preferred: PREFERRED[name],
    shift: shiftOf(name),
    group: OFFICE.has(name) ? ("office" as const) : ("floor" as const),
    // 한진은 그날 휴무
    present: name !== "한진",
    constraints: {
      skillConfiguredGroups: [GROUP],
      ...(INNER_QUAL.has(name) ? { qualificationsByGroup: { [GROUP]: { threeSidePacker: true } } } : {}),
      ...(DAWN.includes(name) ? { doughCore: true as const } : {}),
      ...(name === "곽민정" ? { lockPreferred: true as const } : {}),
    },
  }));
}

/** 정원은 기본값 그대로 쓴다. 가열 한 자리만 12~13 선택으로 바꾼다 (수기표와 동일) */
function buildCatalog(): PositionCatalog {
  const catalog = structuredClone(DEFAULT_CATALOG);
  // 12~13은 절반이 식사라 리코타 배합 한 자리를 비우고 돌린다 (수기표와 동일)
  catalog[GROUP] = catalog[GROUP].map((p) =>
    p.id === OPTIONAL_SEAT ? { ...p, staffing: patchPositionStaffing(p.process, p.staffing, "lunch2", "min", 0) } : p
  );
  return catalog;
}

function buildSkills(roster: Person[], catalog: PositionCatalog): SkillMatrix {
  const skills: SkillMatrix = {};
  for (const person of roster) {
    skills[person.id] = { phono_signature: {}, phono_basil_corn: {}, phono_ricotta: {}, parbake: {} };
    for (const pos of catalog[GROUP]) {
      const capable = CAPABLE[pos.process].includes(person.id);
      const rank: Priority = !capable ? 0 : pos.process === person.preferred ? 1 : 3;
      skills[person.id][GROUP]![pos.id] = rank;
    }
  }
  return skills;
}

function run() {
  const roster = buildRoster();
  const catalog = buildCatalog();
  const skills = buildSkills(roster, catalog);
  const result = generateRotation({
    roster,
    line: "phono_ricotta",
    modes: { lunch: true, breakRotation: false, splitShift: false },
    catalog,
    skills,
    doughSettings: { minStaff: 3, rotationPolicy: "CURRENT_LUNCH_BACKUP" },
    workDate: "2026-09-09",
  });
  return { roster, catalog, skills, result };
}

function stationOf(result: ReturnType<typeof run>["result"], period: PeriodId, name: string) {
  return result.assignments[period].find((a) => a.personId === name)?.station;
}

function namesAt(result: ReturnType<typeof run>["result"], period: PeriodId, station: string) {
  return result.assignments[period]
    .filter((a) => a.station === station)
    .map((a) => a.personId)
    .sort();
}

describe("2026-09-09 운영 흐름", () => {
  const { roster, catalog, skills, result } = run();
  const floor = roster.filter((p) => p.present && p.group === "floor");

  it("시간대별 정원이 실제 운영과 맞는다", () => {
    const counts = (period: PeriodId) => ({
      가열: namesAt(result, period, "heating").length,
      반죽: namesAt(result, period, "dough").length,
      내포장: namesAt(result, period, "inner").length,
      외포장: namesAt(result, period, "outer").length,
      토핑: namesAt(result, period, "topping").length,
      가열마감: namesAt(result, period, "heatingClose").length,
    });
    expect(counts("start")).toMatchObject({ 가열: 8, 반죽: 3, 내포장: 4, 외포장: 4 });
    expect(counts("after")).toMatchObject({ 가열: 8, 반죽: 3, 내포장: 5, 외포장: 4, 토핑: 6 });
    expect(counts("late")).toMatchObject({ 가열: 8, 내포장: 5, 외포장: 4, 토핑: 6 });
    expect(counts("closing")).toMatchObject({ 가열마감: 4, 내포장: 4, 외포장: 2, 토핑: 0 });
    // 정원을 다 채우고 남은 사람만 미배치가 된다
    expect(namesAt(result, "start", "unassigned").length).toBe(
      floor.length - 8 - 3 - 4 - 4 - namesAt(result, "start", "topping").length
    );
  });

  it("09~11 반죽은 고정조 3명에 보조 1명을 더해 4명까지 쓴다", () => {
    const doughPos = catalog[GROUP].find((p) => p.process === "dough")!;
    // 09~11에 자리가 없어 미배치였던 일반 인원에게 반죽 숙련을 준다 (고정조가 아니다)
    expect(namesAt(result, "start", "unassigned")).toContain("신규4");
    const helperSkills: SkillMatrix = structuredClone(skills);
    helperSkills["신규4"][GROUP]![doughPos.id] = 3;
    const withHelper = generateRotation({
      roster,
      line: "phono_ricotta",
      modes: { lunch: true, breakRotation: false, splitShift: false },
      catalog,
      skills: helperSkills,
      doughSettings: { minStaff: 3, rotationPolicy: "CURRENT_LUNCH_BACKUP" },
      workDate: "2026-09-09",
    });
    expect(namesAt(withHelper, "start", "dough")).toEqual([...DAWN, "신규4"].sort());
    // 08~09는 고정조 3명만, 11시 이후에는 일반 로테이션 풀로 돌아간다
    expect(namesAt(withHelper, "early", "dough")).toEqual([...DAWN].sort());
    expect(stationOf(withHelper, "lunch1", "신규4")).not.toBe("dough");
    expect(stationOf(withHelper, "after", "신규4")).not.toBe("dough");
    // 13시 반죽 복귀는 고정조만 한다
    expect(namesAt(withHelper, "after", "dough")).toEqual([...DAWN].sort());
  });

  it("11~12는 가열 8자리, 12~13은 필수 7자리로 돌고 선택 자리는 비어도 성공이다", () => {
    expect(catalog[GROUP].find((p) => p.id === OPTIONAL_SEAT)?.label).toBe("리코타 배합");
    expect(namesAt(result, "lunch1", "heating")).toHaveLength(8);
    expect(namesAt(result, "lunch2", "heating")).toHaveLength(7);
    expect(result.assignments.lunch2.some((a) => a.positionId === OPTIONAL_SEAT)).toBe(false);

    const heatCheck = (period: PeriodId) => result.checks.find((c) => c.id === `pos:${period}:heating`);
    expect(heatCheck("lunch1")).toMatchObject({ ok: true, actual: "8/8자리" });
    expect(heatCheck("lunch2")).toMatchObject({ ok: true, actual: "7/7자리" });
    expect(result.checks.filter((c) => !c.ok)).toEqual([]);
    expect(result.failed).toBe(false);
  });

  it("선택으로 바꾼 자리는 다른 시간대에서는 그대로 필수다", () => {
    const seat = catalog[GROUP].find((p) => p.id === OPTIONAL_SEAT)!;
    for (const period of PERIODS) {
      const expected = period.id === "lunch2" ? false : period.production !== false;
      expect({ period: period.id, required: seatRequiredIn(seat, period.id) }).toEqual({
        period: period.id,
        required: expected,
      });
    }
  });

  it("15:30 퇴근자가 빠져도 17시까지 생산이 이어진다", () => {
    expect(namesAt(result, "late", "heating")).toHaveLength(8);
    expect(namesAt(result, "evening", "heating")).toHaveLength(8);
    expect(namesAt(result, "evening", "outside")).toEqual([...DAWN].sort());
  });


  it("1) 09~19 근무자는 08~09에 배치되지 않는다", () => {
    for (const name of NIGHT) {
      expect(stationOf(result, "early", name)).toBe("outside");
    }
    expect(namesAt(result, "early", "outside")).toEqual([...NIGHT].sort());
  });

  it("2) 08~18 근무자는 18~19에 배치되지 않는다", () => {
    const dayCrew = roster.filter((p) => p.shift === "0800-1800" && p.present).map((p) => p.id);
    for (const name of dayCrew) {
      expect(stationOf(result, "closing", name)).toBe("outside");
    }
  });

  it("3) 반죽 고정조는 오전 반죽 → 11~12 가열 → 12~13 식사 → 13시 반죽 복귀", () => {
    for (const name of DAWN) {
      expect(stationOf(result, "early", name)).toBe("dough");
      expect(stationOf(result, "start", name)).toBe("dough");
      expect(stationOf(result, "lunch1", name)).toBe("heating");
      expect(stationOf(result, "lunch2", name)).toBe("lunch");
      expect(stationOf(result, "after", name)).toBe("dough");
    }
    expect(namesAt(result, "after", "dough")).toEqual([...DAWN].sort());
  });

  it("4) 반죽팀 퇴근 이후 빈 반죽 자리는 오류가 아니다", () => {
    for (const name of DAWN) {
      expect(stationOf(result, "late", name)).toBe("outside");
      expect(stationOf(result, "evening", name)).toBe("outside");
      expect(stationOf(result, "closing", name)).toBe("outside");
    }
    expect(namesAt(result, "late", "dough")).toHaveLength(0);
    expect(result.targets.late.positions.find((p) => p.process === "dough")?.min).toBe(0);
    expect(result.checks.filter((c) => !c.ok && c.id.includes(":late:")).map((c) => c.label)).toEqual([]);
  });

  it("5) 18~19는 일반 가열 없이 가열 마감·내포장·외포장만 선다", () => {
    expect(namesAt(result, "closing", "heating")).toHaveLength(0);
    expect(namesAt(result, "closing", "dough")).toHaveLength(0);
    expect(namesAt(result, "closing", "topping")).toHaveLength(0);
    expect(namesAt(result, "closing", "heatingClose")).toHaveLength(4);
    expect(namesAt(result, "closing", "inner").length).toBeGreaterThanOrEqual(3);
    expect(namesAt(result, "closing", "outer").length).toBeGreaterThanOrEqual(2);
    expect(result.checks.some((c) => c.id === "pos:closing:heating")).toBe(false);
  });

  it("6) 18~19 내포장에도 삼면포장기 필수자격 검증이 걸린다", () => {
    const check = result.checks.find((c) => c.id.startsWith("qual:closing:") && c.id.includes("threeSidePacker"));
    expect(check).toBeDefined();
    expect(check?.ok).toBe(true);
    for (const name of namesAt(result, "closing", "inner")) {
      expect(INNER_QUAL.has(name)).toBe(true);
    }
  });

  it("7) 같은 시간대에 두 군데 배치되지 않는다", () => {
    for (const period of PERIODS) {
      const ids = result.assignments[period.id].map((a) => a.personId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("8) 현장 인원은 점심을 정확히 한 번 먹는다", () => {
    for (const person of floor) {
      const ate = (["lunch1", "lunch2"] as PeriodId[]).filter((p) => stationOf(result, p, person.id) === "lunch");
      expect({ name: person.id, ate: ate.length }).toEqual({ name: person.id, ate: 1 });
    }
    const lunchCheck = result.checks.find((c) => c.id === "lunch:once");
    if (lunchCheck) expect(lunchCheck.ok).toBe(true);
  });

  it("9) 근무 외·식사·휴무·미배치가 서로 다른 상태로 나온다", () => {
    expect(stationOf(result, "start", "한진")).toBe("off");
    expect(stationOf(result, "early", "임정우")).toBe("outside");
    expect(stationOf(result, "closing", "김다슬")).toBe("outside");
    expect(namesAt(result, "lunch1", "lunch").length).toBeGreaterThan(0);
    const stations = new Set(PERIODS.flatMap((p) => result.assignments[p.id].map((a) => a.station)));
    expect(stations.has("off")).toBe(true);
    expect(stations.has("outside")).toBe(true);
    expect(stations.has("lunch")).toBe(true);
  });

  it("10) 불가 숙련 배치 금지·주공정 고정이 모든 구간에서 지켜진다", () => {
    for (const period of PERIODS) {
      for (const row of result.assignments[period.id]) {
        if (!row.positionId) continue;
        expect({
          period: period.id,
          name: row.personId,
          rank: getPriority(skills, row.personId, GROUP, row.positionId),
        }).toEqual({
          period: period.id,
          name: row.personId,
          rank: getPriority(skills, row.personId, GROUP, row.positionId),
        });
        expect(getPriority(skills, row.personId, GROUP, row.positionId)).toBeGreaterThan(0);
      }
      const locked = result.assignments[period.id].find((a) => a.personId === "곽민정");
      if (locked && locked.positionId) {
        const pos = catalog[GROUP].find((p) => p.id === locked.positionId);
        expect(pos?.process).toBe("outer");
      }
    }
  });
});
