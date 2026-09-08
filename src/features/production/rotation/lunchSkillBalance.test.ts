import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG } from "./catalog";
import { generateRotation } from "./rotationEngine";
import type { Person, PositionCatalog, Priority, ProcessId, ProductGroup, SkillMatrix } from "./types";

/**
 * 실제 리코타 숙련표로 점심 교대를 나눠본다.
 * 11~12와 12~13 중 한쪽에 상·중상이 몰리면 그 시간대만 품질이 떨어지므로 두 교대가 비슷해야 한다.
 */
const GROUP: ProductGroup = "phono_ricotta";

/** 숙련표 열 순서: 가열 8자리 · 내포장 · 외포장 · 토핑 · 반죽 · R&D · 사무 · 가열 마감 */
const COLS = [
  "ricotta-heat-1",
  "ricotta-heat-2",
  "ricotta-heat-3",
  "ricotta-heat-4",
  "ricotta-heat-5",
  "ricotta-heat-6",
  "ricotta-heat-7",
  "ricotta-heat-8",
  "ricotta-inner",
  "ricotta-outer",
  "ricotta-topping",
  "ricotta-dough",
  "ricotta-rnd",
  "ricotta-office",
  "ricotta-heat-close",
];

const RANK_OF: Record<string, Priority> = { 불가: 0, 상: 1, 중상: 2, 중: 3, 하: 4 };

const SKILL_TABLE: Record<string, string> = {
  고은주: "중 중 불가 중 중 중상 불가 불가 중 중 상 불가 불가 불가 불가",
  곽민정: "불가 불가 불가 불가 불가 불가 불가 불가 불가 상 불가 불가 불가 불가 불가",
  김다슬: "상 상 상 상 상 상 중 상 불가 불가 중 불가 불가 불가 불가",
  김동호: "하 하 하 하 하 불가 불가 상 불가 불가 하 불가 상 불가 불가",
  김성미: "하 하 불가 중 불가 하 하 불가 불가 불가 하 불가 불가 불가 불가",
  김성아: "하 하 불가 중상 하 중상 불가 불가 중상 불가 상 불가 불가 불가 불가",
  김소영: "불가 불가 불가 불가 불가 불가 불가 불가 상 불가 중상 불가 불가 불가 불가",
  김순이: "하 불가 불가 중상 중 중상 불가 불가 불가 불가 상 불가 불가 불가 불가",
  김옥: "중상 중상 하 중상 중 중상 중상 불가 중 불가 중 불가 불가 불가 불가",
  박은화: "불가 불가 불가 불가 불가 하 불가 불가 중 불가 하 불가 불가 불가 불가",
  손학모: "불가 불가 불가 불가 불가 중상 상 불가 불가 불가 불가 불가 불가 불가 불가",
  송문광: "중상 중상 중상 중상 중상 중상 중상 불가 불가 불가 하 불가 불가 불가 중상",
  신미경: "불가 불가 불가 불가 불가 불가 불가 불가 불가 불가 불가 불가 불가 불가 불가",
  심수덕: "하 중 불가 불가 불가 불가 불가 불가 상 중상 중 불가 불가 불가 불가",
  양경민: "불가 불가 불가 불가 불가 불가 불가 불가 불가 중 불가 불가 불가 불가 불가",
  윤상혁: "중 하 중 중 중 중 중 불가 불가 불가 하 불가 불가 불가 중상",
  이두승: "불가 불가 하 불가 불가 불가 불가 불가 하 불가 불가 불가 불가 불가 불가",
  이병일: "중상 중상 중상 중 중 중 중 중 중상 불가 중 상 불가 불가 불가",
  이진화: "중 중상 중상 하 중 중상 중상 중 중상 중 중 상 불가 불가 불가",
  임정우: "상 상 상 중상 중상 중 하 중상 불가 불가 하 불가 불가 불가 상",
  장야핑: "불가 불가 불가 중상 중상 중상 불가 불가 중 불가 상 불가 불가 불가 불가",
  조선영: "중상 중상 불가 중상 중상 중상 불가 불가 중상 불가 중 상 불가 불가 불가",
  조형래: "중 중 중 중 중 중상 중 불가 중 불가 하 불가 불가 불가 불가",
  차유진: "중 중 불가 불가 중상 중상 하 불가 불가 불가 하 불가 불가 불가 중상",
  최대열: "중 하 불가 하 중 중상 중상 불가 상 불가 하 불가 불가 불가 불가",
  최민권: "불가 불가 불가 불가 불가 불가 불가 불가 불가 불가 불가 불가 불가 불가 불가",
  최현호: "불가 불가 불가 불가 하 불가 불가 불가 중 불가 하 불가 불가 불가 불가",
  한상수: "불가 하 불가 불가 불가 불가 불가 불가 불가 상 불가 불가 불가 불가 불가",
  한상혁: "불가 불가 불가 불가 불가 불가 불가 불가 불가 상 불가 불가 불가 불가 불가",
  한진: "하 중 불가 불가 불가 중 불가 불가 중상 중상 상 불가 불가 불가 불가",
  홍수정: "중상 중상 중 중상 중 중상 중 불가 불가 불가 상 불가 불가 불가 불가",
};

const PREFERRED: Record<string, ProcessId> = {
  고은주: "topping",
  곽민정: "outer",
  김다슬: "heating",
  김동호: "rnd",
  김성미: "heating",
  김성아: "topping",
  김소영: "inner",
  김순이: "topping",
  김옥: "heating",
  박은화: "inner",
  손학모: "heating",
  송문광: "heating",
  신미경: "office",
  심수덕: "inner",
  양경민: "outer",
  윤상혁: "heating",
  이두승: "office",
  이병일: "dough",
  이진화: "dough",
  임정우: "heating",
  장야핑: "topping",
  조선영: "dough",
  조형래: "heating",
  차유진: "heating",
  최대열: "heating",
  최민권: "office",
  최현호: "inner",
  한상수: "outer",
  한상혁: "outer",
  한진: "topping",
  홍수정: "topping",
};

const NIGHT = ["김소영", "박은화", "송문광", "양경민", "윤상혁", "임정우", "차유진", "최대열", "최현호", "한상혁"];
const DAWN = ["이병일", "이진화", "조선영"];
const OFFICE = ["신미경", "최민권"];
const INNER_QUAL = ["김소영", "심수덕", "최대열"];

function shiftOf(name: string) {
  if (DAWN.includes(name)) return "0600-1530";
  if (NIGHT.includes(name)) return "0900-1900";
  return "0800-1800";
}

function buildRoster(): Person[] {
  return Object.keys(SKILL_TABLE).map((name) => ({
    id: name,
    name,
    preferred: PREFERRED[name],
    shift: shiftOf(name),
    group: OFFICE.includes(name) ? ("office" as const) : ("floor" as const),
    present: true,
    constraints: {
      skillConfiguredGroups: [GROUP],
      ...(INNER_QUAL.includes(name) ? { qualificationsByGroup: { [GROUP]: { threeSidePacker: true } } } : {}),
      ...(DAWN.includes(name) ? { doughCore: true as const } : {}),
      ...(name === "김동호" ? { fieldBackup: true as const } : {}),
    },
  }));
}

function buildSkills(roster: Person[], catalog: PositionCatalog): SkillMatrix {
  const skills: SkillMatrix = {};
  for (const person of roster) {
    skills[person.id] = { phono_signature: {}, phono_basil_corn: {}, phono_ricotta: {}, parbake: {} };
    for (const pos of catalog[GROUP]) skills[person.id][GROUP]![pos.id] = 0;
    const cells = SKILL_TABLE[person.id].trim().split(/\s+/);
    expect(cells).toHaveLength(COLS.length);
    cells.forEach((cell, i) => {
      skills[person.id][GROUP]![COLS[i]] = RANK_OF[cell];
    });
  }
  return skills;
}

function run() {
  const roster = buildRoster();
  const catalog = DEFAULT_CATALOG;
  return generateRotation({
    roster,
    line: "phono_ricotta",
    modes: { lunch: true, breakRotation: false, splitShift: false },
    catalog,
    skills: buildSkills(roster, catalog),
    doughSettings: { minStaff: 3, rotationPolicy: "CURRENT_LUNCH_BACKUP" },
    workDate: "2026-09-09",
  });
}

/** 상 3점 · 중상 2점 · 중 1점 · 하 0점 */
function rankWeight(priority: number | undefined): number {
  return priority === 1 ? 3 : priority === 2 ? 2 : priority === 3 ? 1 : 0;
}

describe("점심 교대 숙련 분산", () => {
  const result = run();
  const heatingAt = (period: "lunch1" | "lunch2") =>
    result.assignments[period].filter((a) => a.station === "heating");

  it("두 점심 교대의 가열 숙련이 비슷하게 나뉜다", () => {
    const first = heatingAt("lunch1");
    const second = heatingAt("lunch2");
    const strength = (rows: typeof first) => rows.reduce((sum, a) => sum + rankWeight(a.priority), 0);
    expect(Math.abs(strength(first) - strength(second))).toBeLessThanOrEqual(3);
  });

  it("상 숙련자가 한쪽 교대에 몰리지 않는다", () => {
    const topCount = (period: "lunch1" | "lunch2") => heatingAt(period).filter((a) => a.priority === 1).length;
    expect(topCount("lunch1")).toBeGreaterThan(0);
    expect(topCount("lunch2")).toBeGreaterThan(0);
    expect(Math.abs(topCount("lunch1") - topCount("lunch2"))).toBeLessThanOrEqual(1);
  });
});
