import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG } from "./catalog";
import { generateRotation } from "./rotationEngine";
import { canTakeProcess } from "./personRules";
import type { Person, ProcessId, SkillMatrix } from "./types";

/**
 * 가열 마감은 가열실 설비 정리·세척이라 가열의 마무리다.
 * 주공정이 가열인 사람은 '주공정만'을 켜도 18시 이후 마감조에 남을 수 있어야 한다.
 */
const GROUP = "phono_ricotta" as const;
const catalog = DEFAULT_CATALOG;
const HEAT = ["임정우", "송문광", "윤상혁", "차유진"];
const INNER = ["김소영", "최대열", "박은화", "최현호"];
const OUTER = ["한상혁", "양경민"];

function buildRoster(lock: string[]): Person[] {
  return [...HEAT, ...INNER, ...OUTER].map((name) => ({
    id: name,
    name,
    preferred: (INNER.includes(name) ? "inner" : OUTER.includes(name) ? "outer" : "heating") as ProcessId,
    shift: "0900-1900",
    group: "floor" as const,
    present: true,
    constraints: {
      skillConfiguredGroups: [GROUP],
      ...(["김소영", "최대열"].includes(name) ? { qualificationsByGroup: { [GROUP]: { threeSidePacker: true } } } : {}),
      ...(lock.includes(name) ? { lockPreferred: true as const } : {}),
    },
  })) as Person[];
}

/** 주공정 자리는 전부 '상'으로 두고, 가열 인원에게만 가열 마감 숙련을 준다 */
function buildSkills(roster: Person[], alsoClose: string[]): SkillMatrix {
  const skills: SkillMatrix = {};
  for (const person of roster) {
    skills[person.id] = { phono_signature: {}, phono_basil_corn: {}, phono_ricotta: {}, parbake: {} };
    for (const position of catalog[GROUP]) {
      const canClose =
        position.process === "heatingClose" &&
        (person.preferred === "heating" || alsoClose.includes(person.id));
      skills[person.id][GROUP]![position.id] = position.process === person.preferred || canClose ? 1 : 0;
    }
  }
  return skills;
}

function closingCrew(lock: string[], alsoClose: string[] = []) {
  const roster = buildRoster(lock);
  const result = generateRotation({
    roster,
    line: "phono_ricotta",
    modes: { lunch: false, breakRotation: false, splitShift: false },
    catalog,
    skills: buildSkills(roster, alsoClose),
    workDate: "2026-09-09",
  });
  return result.assignments.closing
    .filter((a) => a.station === "heatingClose")
    .map((a) => a.personId)
    .sort();
}

describe("가열 마감과 주공정만", () => {
  it("주공정만이 없으면 가열 인원이 그대로 마감조가 된다", () => {
    expect(closingCrew([])).toEqual([...HEAT].sort());
  });

  it("주공정만을 켜도 가열 인원은 마감조에 남는다", () => {
    expect(closingCrew(["임정우", "송문광", "윤상혁", "차유진"])).toEqual([...HEAT].sort());
  });

  it("열어준 건 가열 마감뿐이라 다른 공정은 그대로 막힌다", () => {
    const [heater, packer] = [buildRoster(["임정우"])[0], buildRoster(["김소영"]).find((p) => p.id === "김소영")!];
    expect(canTakeProcess(heater, "heatingClose", GROUP)).toBe(true);
    expect(canTakeProcess(heater, "inner", GROUP)).toBe(false);
    expect(canTakeProcess(packer, "heatingClose", GROUP)).toBe(false);
  });
});
