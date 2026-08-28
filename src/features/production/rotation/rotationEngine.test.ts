import { describe, expect, it } from "vitest";
import { buildChecks, generateRotation, movePerson } from "./rotationEngine";
import { hasQualification, mergePersonConstraints, parsePersonConstraints } from "./personRules";
import { visibleRotationRoster } from "./catalog";
import { applyWorkerConstraintsMap } from "./persist";
import { withDefaultStaffing } from "./staffing";
import type {
  DoughSettings,
  Person,
  PositionCatalog,
  PositionDef,
  Priority,
  ProcessId,
  ProductGroup,
  RotationModes,
  SkillMatrix,
} from "./types";

const GROUPS: ProductGroup[] = ["phono_signature", "phono_basil_corn", "phono_ricotta", "parbake"];
const LUNCH_OFF: RotationModes = { lunch: false, breakRotation: false, splitShift: false };
const LUNCH_ON: RotationModes = { lunch: true, breakRotation: false, splitShift: false };
const ZERO = { min: 0, max: 0 };
const zeros = { start: ZERO, lunch1: ZERO, lunch2: ZERO, after: ZERO };

function range(min: number, max = min) {
  return { min, max };
}

function staffing(start: number, lunch: number, after = start) {
  return {
    start: range(start),
    lunch1: range(lunch),
    lunch2: range(lunch),
    after: range(after),
  };
}

function catalogWith(positions: PositionDef[]): PositionCatalog {
  const next = {} as PositionCatalog;
  for (const group of GROUPS) {
    next[group] = positions.map((p) => withDefaultStaffing({ ...p, staffing: p.staffing }));
  }
  return next;
}

function miniCatalog(opts?: { innerStart?: number; innerLunch?: number; outerStart?: number; outerLunch?: number; doughStart?: number; heat?: number }) {
  const heatN = opts?.heat ?? 1;
  const innerStart = opts?.innerStart ?? 3;
  const innerLunch = opts?.innerLunch ?? innerStart;
  const outerStart = opts?.outerStart ?? 0;
  const outerLunch = opts?.outerLunch ?? outerStart;
  const doughStart = opts?.doughStart ?? 0;
  const heat: PositionDef[] = Array.from({ length: heatN }, (_, i) => ({
    id: `h${i + 1}`,
    label: `가열 ${i + 1}`,
    process: "heating" as const,
  }));
  return catalogWith([
    ...heat,
    { id: "inner", label: "내포장", process: "inner", staffing: staffing(innerStart, innerLunch, innerStart) },
    { id: "outer", label: "외포장", process: "outer", staffing: staffing(outerStart, outerLunch, outerStart) },
    { id: "dough", label: "반죽", process: "dough", staffing: staffing(doughStart, doughStart === 0 ? 0 : 0, 0) },
    { id: "office", label: "사무", process: "office", staffing: zeros },
  ]);
}

function person(
  id: string,
  preferred: ProcessId,
  extra?: Partial<Person>
): Person {
  return {
    id,
    name: extra?.name ?? id,
    preferred,
    shift: extra?.shift ?? "0800-1800",
    group: extra?.group ?? "floor",
    present: extra?.present ?? true,
    constraints: extra?.constraints,
    leaveKind: extra?.leaveKind,
    hireDate: extra?.hireDate,
  };
}

function skillsFor(roster: Person[], catalog: PositionCatalog, ranks: Record<string, Partial<Record<string, Priority>>>): SkillMatrix {
  const skills: SkillMatrix = {};
  for (const p of roster) {
    skills[p.id] = { phono_signature: {}, phono_basil_corn: {}, phono_ricotta: {}, parbake: {} };
    for (const group of GROUPS) {
      for (const pos of catalog[group]) skills[p.id][group]![pos.id] = 0;
    }
    const row = ranks[p.id] ?? {};
    for (const [posId, rank] of Object.entries(row)) {
      if (!rank) continue;
      for (const group of GROUPS) skills[p.id][group]![posId] = rank;
    }
  }
  return skills;
}

function run(opts: {
  roster: Person[];
  catalog?: PositionCatalog;
  skills: SkillMatrix;
  modes?: RotationModes;
  doughSettings?: DoughSettings;
  workDate?: string;
}) {
  return generateRotation({
    roster: opts.roster,
    line: "phono_signature",
    modes: opts.modes ?? LUNCH_OFF,
    catalog: opts.catalog ?? miniCatalog(),
    skills: opts.skills,
    doughSettings: opts.doughSettings,
    workDate: opts.workDate,
  });
}

function namesOn(result: ReturnType<typeof generateRotation>, period: "start" | "lunch1" | "lunch2" | "after", station: string) {
  return result.assignments[period]
    .filter((a) => a.station === station)
    .map((a) => a.personId);
}

function innerQual(group: ProductGroup = "phono_signature") {
  return { qualificationsByGroup: { [group]: { threeSidePacker: true } } };
}

function hasQualCheck(result: ReturnType<typeof generateRotation>, period: "start" | "lunch1" | "lunch2" | "after") {
  return result.checks.find((c) => c.id.startsWith(`qual:${period}:`) && c.id.includes("threeSidePacker"));
}

describe("personRules qualifications", () => {
  it("기존 constraints만 있어도 파싱되고 자격은 없는 것으로 본다", () => {
    const parsed = parsePersonConstraints({ lockPreferred: true, doughCore: true });
    expect(parsed?.lockPreferred).toBe(true);
    expect(parsed?.qualificationsByGroup).toBeUndefined();
    const p = person("a", "inner", { constraints: parsed });
    expect(hasQualification(p, "threeSidePacker", "phono_signature")).toBe(false);
  });

  it("skillConfiguredGroups를 파싱해 명시적 설정과 미설정을 가른다", () => {
    const parsed = parsePersonConstraints({ skillConfiguredGroups: ["phono_signature", "nope"] });
    expect(parsed?.skillConfiguredGroups).toEqual(["phono_signature"]);
  });

  it("구형 flat qualifications는 포노 제품군에만 이전하고 파베이크에는 넣지 않는다", () => {
    const parsed = parsePersonConstraints({ qualifications: { threeSidePacker: true } });
    expect(parsed?.qualificationsByGroup?.phono_signature?.threeSidePacker).toBe(true);
    expect(parsed?.qualificationsByGroup?.phono_basil_corn?.threeSidePacker).toBe(true);
    expect(parsed?.qualificationsByGroup?.parbake?.threeSidePacker).toBeUndefined();
  });
});

describe("내포장 필수자격", () => {
  it("테스트 1: min 인원 안에 자격자가 반드시 포함된다", () => {
    const catalog = miniCatalog({ innerStart: 3 });
    const roster = [
      person("qual-1", "inner", { constraints: innerQual() }),
      person("pack-a", "inner"),
      person("pack-b", "inner"),
      person("pack-c", "inner"),
      person("heat-1", "heating"),
    ];
    const skills = skillsFor(roster, catalog, {
      "qual-1": { inner: 2, h1: 0 },
      "pack-a": { inner: 1 },
      "pack-b": { inner: 1 },
      "pack-c": { inner: 1 },
      "heat-1": { h1: 1 },
    });
    const result = run({ roster, catalog, skills });
    const inner = namesOn(result, "start", "inner");
    expect(inner).toHaveLength(3);
    expect(inner).toContain("qual-1");
    expect(hasQualCheck(result, "start")?.ok).toBe(true);
  });

  it("테스트 2: 자격자 4명도 이름 없이 Boolean만으로 고른다", () => {
    const catalog = miniCatalog({ innerStart: 3 });
    const roster = [
      person("q1", "inner", { constraints: innerQual() }),
      person("q2", "inner", { constraints: innerQual() }),
      person("q3", "inner", { constraints: innerQual() }),
      person("q4", "inner", { constraints: innerQual() }),
      person("heat-1", "heating"),
    ];
    const skills = skillsFor(roster, catalog, {
      q1: { inner: 2 },
      q2: { inner: 2 },
      q3: { inner: 2 },
      q4: { inner: 2 },
      "heat-1": { h1: 1 },
    });
    const result = run({ roster, catalog, skills });
    const inner = namesOn(result, "start", "inner");
    expect(inner.some((id) => ["q1", "q2", "q3", "q4"].includes(id))).toBe(true);
    expect(hasQualCheck(result, "start")?.ok).toBe(true);
  });

  it("테스트 4: 일반 인원만으로 숫자는 되지만 자격 없으면 현장백업 관리자를 쓴다", () => {
    const catalog = miniCatalog({ innerStart: 3 });
    const roster = [
      person("pack-a", "inner"),
      person("pack-b", "inner"),
      person("pack-c", "inner"),
      person("heat-1", "heating"),
      person("lead", "office", {
        group: "office",
        constraints: { fieldBackup: true, ...innerQual() },
      }),
    ];
    const skills = skillsFor(roster, catalog, {
      "pack-a": { inner: 1 },
      "pack-b": { inner: 1 },
      "pack-c": { inner: 1 },
      "heat-1": { h1: 1 },
      lead: { inner: 2, office: 1 },
    });
    const result = run({ roster, catalog, skills });
    const inner = namesOn(result, "start", "inner");
    expect(inner).toContain("lead");
    expect(inner).toHaveLength(3);
    expect(hasQualCheck(result, "start")?.ok).toBe(true);
  });

  it("테스트 5: 이미 자격+min이 되면 사무 관리자를 max 패딩으로 끌어오지 않는다", () => {
    const catalog = miniCatalog({ innerStart: 3 });
    const innerPos = catalog.phono_signature.find((p) => p.id === "inner")!;
    innerPos.staffing = staffing(3, 3, 4);
    const roster = [
      person("qual-1", "inner", { constraints: innerQual() }),
      person("pack-a", "inner"),
      person("pack-b", "inner"),
      person("heat-1", "heating"),
      person("lead", "office", {
        group: "office",
        constraints: { fieldBackup: true, ...innerQual() },
      }),
    ];
    const skills = skillsFor(roster, catalog, {
      "qual-1": { inner: 2 },
      "pack-a": { inner: 1 },
      "pack-b": { inner: 1 },
      "heat-1": { h1: 1 },
      lead: { inner: 1, office: 1 },
    });
    const result = run({ roster, catalog, skills });
    expect(namesOn(result, "start", "inner")).not.toContain("lead");
    expect(namesOn(result, "start", "office")).toContain("lead");
  });
});

describe("점심 자격·층 앵커", () => {
  it("테스트 3: 자격자 2명을 한 조에 몰지 않고 양쪽 근무조에 나눈다", () => {
    const catalog = miniCatalog({ innerStart: 2, innerLunch: 2, heat: 1 });
    const roster = [
      person("q1", "inner", { constraints: innerQual() }),
      person("q2", "inner", { constraints: innerQual() }),
      person("pack-a", "inner"),
      person("pack-b", "inner"),
      person("heat-1", "heating"),
      person("heat-2", "heating"),
    ];
    const skills = skillsFor(roster, catalog, {
      q1: { inner: 1, h1: 3 },
      q2: { inner: 1, h1: 3 },
      "pack-a": { inner: 1, h1: 3 },
      "pack-b": { inner: 1, h1: 3 },
      "heat-1": { h1: 1 },
      "heat-2": { h1: 1 },
    });
    const result = run({ roster, catalog, skills, modes: LUNCH_ON });
    const lunch1Inner = namesOn(result, "lunch1", "inner");
    const lunch2Inner = namesOn(result, "lunch2", "inner");
    const qOn1 = lunch1Inner.some((id) => id === "q1" || id === "q2");
    const qOn2 = lunch2Inner.some((id) => id === "q1" || id === "q2");
    expect(qOn1).toBe(true);
    expect(qOn2).toBe(true);
    expect(hasQualCheck(result, "lunch1")?.ok).toBe(true);
    expect(hasQualCheck(result, "lunch2")?.ok).toBe(true);
  });

  it("테스트 6: 시작 외포장 인원을 점심에 우선 유지하고 2층 내포장자를 불필요하게 1층으로 안 보낸다", () => {
    const catalog = miniCatalog({ innerStart: 2, innerLunch: 2, outerStart: 3, outerLunch: 2, heat: 1 });
    const roster = [
      person("곽민정", "outer"),
      person("한상수", "outer"),
      person("한상혁", "outer"),
      person("한진", "heating"),
      person("심수덕", "inner", { constraints: innerQual() }),
      person("pack-a", "inner"),
      person("heat-1", "heating"),
      person("heat-2", "heating"),
    ];
    const skills = skillsFor(roster, catalog, {
      곽민정: { outer: 1 },
      한상수: { outer: 1 },
      한상혁: { outer: 1 },
      한진: { h1: 2, outer: 2 },
      심수덕: { inner: 1, outer: 2 },
      "pack-a": { inner: 1 },
      "heat-1": { h1: 1 },
      "heat-2": { h1: 1 },
    });
    const result = run({ roster, catalog, skills, modes: LUNCH_ON });
    expect(namesOn(result, "start", "inner")).toContain("심수덕");
    expect(namesOn(result, "lunch1", "outer")).not.toContain("심수덕");
    expect(namesOn(result, "lunch2", "outer")).not.toContain("심수덕");
  });

  it("테스트 7: stayFloor면 외포장 부족해도 1층으로 안 보낸다", () => {
    const catalog = miniCatalog({ innerStart: 1, innerLunch: 1, outerStart: 2, outerLunch: 2, heat: 1 });
    const roster = [
      person("outer-1", "outer"),
      person("stay-2f", "inner", { constraints: { stayFloor: true, ...innerQual() } }),
      person("heat-1", "heating"),
      person("heat-2", "heating"),
    ];
    const skills = skillsFor(roster, catalog, {
      "outer-1": { outer: 1 },
      "stay-2f": { inner: 1, outer: 1 },
      "heat-1": { h1: 1 },
      "heat-2": { h1: 1 },
    });
    const result = run({ roster, catalog, skills, modes: LUNCH_ON });
    expect(namesOn(result, "lunch1", "outer")).not.toContain("stay-2f");
    expect(namesOn(result, "lunch2", "outer")).not.toContain("stay-2f");
    expect(result.warnings.some((w) => /외포장/.test(w.message) || /가능자/.test(w.message) || /자리/.test(w.message))).toBe(true);
  });
});

describe("반죽팀 정책", () => {
  function doughRoster(n: number) {
    return Array.from({ length: n }, (_, i) =>
      person(`dough-${i + 1}`, "dough", { constraints: { doughCore: true } })
    );
  }

  it("테스트 8: CURRENT_LUNCH_BACKUP에서 doughCore가 점심 가열 백업 후보로 남는다", () => {
    const catalog = miniCatalog({ innerStart: 1, innerLunch: 1, doughStart: 3, heat: 1 });
    const roster = [
      ...doughRoster(3),
      person("qual-1", "inner", { constraints: innerQual() }),
      person("heat-1", "heating"),
      person("heat-2", "heating"),
    ];
    const skills = skillsFor(roster, catalog, {
      "dough-1": { dough: 1, h1: 2 },
      "dough-2": { dough: 1, h1: 2 },
      "dough-3": { dough: 1, h1: 2, inner: 2 },
      "qual-1": { inner: 1 },
      "heat-1": { h1: 1 },
      "heat-2": { h1: 1 },
    });
    const result = run({
      roster,
      catalog,
      skills,
      modes: LUNCH_ON,
      doughSettings: { minStaff: 3, rotationPolicy: "CURRENT_LUNCH_BACKUP" },
    });
    const lunchHeat = [...namesOn(result, "lunch1", "heating"), ...namesOn(result, "lunch2", "heating")];
    expect(lunchHeat.some((id) => id.startsWith("dough-"))).toBe(true);
    expect(namesOn(result, "start", "dough")).toHaveLength(3);
  });

  it.each([2, 3, 4])("테스트 9: doughCore %s명이어도 3명 하드코딩으로 깨지지 않는다", (n) => {
    const catalog = miniCatalog({ innerStart: 1, doughStart: n, heat: 1 });
    const roster = [...doughRoster(n), person("qual-1", "inner", { constraints: innerQual() }), person("heat-1", "heating")];
    const ranks: Record<string, Partial<Record<string, Priority>>> = {
      "qual-1": { inner: 1 },
      "heat-1": { h1: 1 },
    };
    for (let i = 1; i <= n; i++) ranks[`dough-${i}`] = { dough: 1 };
    const result = run({
      roster,
      catalog,
      skills: skillsFor(roster, catalog, ranks),
      doughSettings: { minStaff: n, rotationPolicy: "CURRENT_LUNCH_BACKUP" },
    });
    expect(namesOn(result, "start", "dough")).toHaveLength(n);
    expect(result.warnings.some((w) => /조선영|이진화|이병일/.test(w.message))).toBe(false);
  });

  it("테스트 10: FIXED_DOUGH면 점심 가열 백업에서 빠지고 반죽에 유지된다", () => {
    const catalog = miniCatalog({ innerStart: 1, innerLunch: 1, doughStart: 4, heat: 1 });
    const roster = [
      ...doughRoster(4),
      person("qual-1", "inner", { constraints: innerQual() }),
      person("heat-1", "heating"),
      person("heat-2", "heating"),
    ];
    const ranks: Record<string, Partial<Record<string, Priority>>> = {
      "qual-1": { inner: 1 },
      "heat-1": { h1: 1 },
      "heat-2": { h1: 1 },
    };
    for (let i = 1; i <= 4; i++) ranks[`dough-${i}`] = { dough: 1, h1: 2 };
    const result = run({
      roster,
      catalog,
      skills: skillsFor(roster, catalog, ranks),
      modes: LUNCH_ON,
      doughSettings: { minStaff: 4, rotationPolicy: "FIXED_DOUGH" },
    });
    const doughIds = ["dough-1", "dough-2", "dough-3", "dough-4"];
    expect(namesOn(result, "start", "dough").sort()).toEqual(doughIds);
    expect(namesOn(result, "lunch1", "dough").sort()).toEqual(doughIds);
    expect(namesOn(result, "lunch2", "dough").sort()).toEqual(doughIds);
    expect(namesOn(result, "lunch1", "heating").some((id) => doughIds.includes(id))).toBe(false);
    expect(namesOn(result, "lunch2", "heating").some((id) => doughIds.includes(id))).toBe(false);
  });

  it("테스트 11: FIXED_DOUGH 인원 부족 시 다른 공정을 조용히 승격하지 않고 경고한다", () => {
    const catalog = miniCatalog({ innerStart: 1, doughStart: 3, heat: 1 });
    const roster = [
      ...doughRoster(3),
      person("extra-dough", "heating"),
      person("qual-1", "inner", { constraints: innerQual() }),
      person("heat-1", "heating"),
    ];
    const skills = skillsFor(roster, catalog, {
      "dough-1": { dough: 1 },
      "dough-2": { dough: 1 },
      "dough-3": { dough: 1 },
      "extra-dough": { dough: 1, h1: 1 },
      "qual-1": { inner: 1 },
      "heat-1": { h1: 1 },
    });
    const result = run({
      roster,
      catalog,
      skills,
      doughSettings: { minStaff: 4, rotationPolicy: "FIXED_DOUGH" },
    });
    expect(namesOn(result, "start", "dough")).not.toContain("extra-dough");
    expect(result.warnings.some((w) => w.message.includes("반죽고정 필요 4명 / 출근 3명"))).toBe(true);
  });
});

describe("숙련·수동이동 회귀", () => {
  it("테스트 12: 숙련 0은 인원 부족이어도 넣지 않는다", () => {
    const catalog = miniCatalog({ innerStart: 3 });
    const roster = [
      person("qual-1", "inner", { constraints: innerQual() }),
      person("zero", "inner"),
      person("heat-1", "heating"),
    ];
    const skills = skillsFor(roster, catalog, {
      "qual-1": { inner: 1 },
      zero: { inner: 0 },
      "heat-1": { h1: 1 },
    });
    const result = run({ roster, catalog, skills });
    expect(namesOn(result, "start", "inner")).not.toContain("zero");
  });

  it("테스트 13: 비상은 min 부족일 때만 쓰고 max 패딩에는 안 쓴다", () => {
    const catalog = miniCatalog({ innerStart: 2 });
    const innerPos = catalog.phono_signature.find((p) => p.id === "inner")!;
    innerPos.staffing = staffing(2, 2, 2);
    innerPos.staffing.start = { min: 2, max: 4 };
    const roster = [
      person("qual-1", "inner", { constraints: innerQual() }),
      person("normal", "inner"),
      person("emer-1", "inner"),
      person("emer-2", "inner"),
      person("heat-1", "heating"),
    ];
    const skills = skillsFor(roster, catalog, {
      "qual-1": { inner: 2 },
      normal: { inner: 3 },
      "emer-1": { inner: 5 },
      "emer-2": { inner: 5 },
      "heat-1": { h1: 1 },
    });
    const result = run({ roster, catalog, skills });
    const inner = result.assignments.start.filter((a) => a.station === "inner");
    expect(inner.some((a) => a.priority === 5)).toBe(false);
    expect(inner.length).toBeLessThanOrEqual(2);
  });

  it("테스트 14: 외포장 수동 이동은 기존 배치자를 밀어내지 않는다", () => {
    const catalog = miniCatalog({ innerStart: 1, outerStart: 2 });
    const roster = [
      person("한상수", "outer"),
      person("곽민정", "outer"),
      person("mover", "outer"),
      person("qual-1", "inner", { constraints: innerQual() }),
      person("heat-1", "heating"),
    ];
    const skills = skillsFor(roster, catalog, {
      한상수: { outer: 1 },
      곽민정: { outer: 1 },
      mover: { outer: 1 },
      "qual-1": { inner: 1 },
      "heat-1": { h1: 1 },
    });
    const generated = run({ roster, catalog, skills });
    const moved = movePerson(generated.assignments, "start", "mover", "outer", "outer", skills, "phono_signature", roster);
    const outerIds = moved.assignments.start.filter((a) => a.station === "outer").map((a) => a.personId);
    expect(outerIds).toContain("한상수");
    expect(outerIds).toContain("곽민정");
    expect(outerIds).toContain("mover");
  });
});

describe("숙련 미설정 출근자", () => {
  it("테스트 1: 숙련 미설정 출근자는 자동배치하지 않고 미배치에 남긴다", () => {
    const catalog = miniCatalog({ innerStart: 1 });
    const roster = [
      person("new-hire", "heating"),
      person("qual-1", "inner", { constraints: innerQual() }),
      person("heat-1", "heating"),
    ];
    const skills = skillsFor(roster, catalog, {
      "qual-1": { inner: 1 },
      "heat-1": { h1: 1 },
    });
    const result = run({ roster, catalog, skills });
    const start = result.assignments.start.find((a) => a.personId === "new-hire");
    expect(start?.station).toBe("unassigned");
    expect(start?.unassignedReason).toBe("NO_SKILL_CONFIG");
    expect(namesOn(result, "start", "heating")).not.toContain("new-hire");
    expect(namesOn(result, "start", "inner")).not.toContain("new-hire");
  });

  it("테스트 2: excluded는 미배치에도 나오지 않는다", () => {
    const catalog = miniCatalog({ innerStart: 1 });
    const roster = [
      person("out", "heating", { constraints: { excluded: true } }),
      person("qual-1", "inner", { constraints: innerQual() }),
      person("heat-1", "heating"),
    ];
    const skills = skillsFor(roster, catalog, {
      "qual-1": { inner: 1 },
      "heat-1": { h1: 1 },
    });
    const result = run({ roster, catalog, skills });
    expect(result.assignments.start.some((a) => a.personId === "out")).toBe(false);
  });

  it("제외 + 숙련 미설정은 자동배치·미배치·당일 표에 나오지 않는다", () => {
    const catalog = miniCatalog({ innerStart: 1 });
    const roster = [
      person("out", "heating", { present: true, constraints: { excluded: true } }),
      person("qual-1", "inner", { constraints: innerQual() }),
      person("heat-1", "heating"),
    ];
    const skills = skillsFor(roster, catalog, {
      "qual-1": { inner: 1 },
      "heat-1": { h1: 1 },
    });
    expect(visibleRotationRoster(roster, "2026-08-24").map((p) => p.id)).not.toContain("out");
    const result = run({ roster, catalog, skills, workDate: "2026-08-24" });
    for (const period of ["start", "lunch1", "lunch2", "after"] as const) {
      const row = result.assignments[period].find((a) => a.personId === "out");
      expect(row).toBeUndefined();
    }
  });

  it("제외 상태에서 자격·숙련설정 저장 merge 후에도 excluded가 유지되고 표에 안 나온다", () => {
    const merged = mergePersonConstraints(
      { excluded: true, doughCore: true, stayFloor: true, lockPreferred: true },
      {
        qualificationsByGroup: { phono_signature: { threeSidePacker: true } },
        skillConfiguredGroups: ["phono_signature"],
        fieldBackup: true,
      }
    );
    expect(merged.excluded).toBe(true);
    expect(merged.doughCore).toBe(true);
    expect(merged.stayFloor).toBe(true);
    expect(merged.lockPreferred).toBe(true);
    expect(merged.fieldBackup).toBe(true);
    expect(merged.qualificationsByGroup?.phono_signature?.threeSidePacker).toBe(true);
    expect(merged.skillConfiguredGroups).toContain("phono_signature");

    const catalog = miniCatalog({ innerStart: 1 });
    const roster = [
      person("out", "heating", { present: true, constraints: merged }),
      person("qual-1", "inner", { constraints: innerQual() }),
      person("heat-1", "heating"),
    ];
    const skills = skillsFor(roster, catalog, {
      "qual-1": { inner: 1 },
      "heat-1": { h1: 1 },
    });
    const result = run({ roster, catalog, skills, workDate: "2026-08-24" });
    expect(visibleRotationRoster(roster, "2026-08-24").map((p) => p.id)).not.toContain("out");
    expect(result.assignments.start.some((a) => a.personId === "out")).toBe(false);
  });

  it("JSONB 문자열과 ops workerConstraints 맵에서 excluded를 복구한다", () => {
    const parsed = parsePersonConstraints(JSON.stringify({ excluded: true, doughCore: true }));
    expect(parsed?.excluded).toBe(true);
    expect(parsed?.doughCore).toBe(true);
    const restored = applyWorkerConstraintsMap(
      [person("out", "heating"), person("keep", "heating", { constraints: { stayFloor: true } })],
      { out: { excluded: true } }
    );
    expect(restored.find((p) => p.id === "out")?.constraints?.excluded).toBe(true);
    expect(restored.find((p) => p.id === "keep")?.constraints?.stayFloor).toBe(true);
    expect(visibleRotationRoster(restored, "2026-08-24").map((p) => p.id)).not.toContain("out");
  });


  it("테스트 3: 숙련 미설정이어도 미출근·연차는 휴무로 두고 미배치 출근으로 표시하지 않는다", () => {
    const catalog = miniCatalog({ innerStart: 1 });
    const roster = [
      person("absent", "heating", { present: false }),
      person("leave", "heating", { leaveKind: "annual" }),
      person("qual-1", "inner", { constraints: innerQual() }),
      person("heat-1", "heating"),
    ];
    const skills = skillsFor(roster, catalog, {
      "qual-1": { inner: 1 },
      "heat-1": { h1: 1 },
    });
    const result = run({ roster, catalog, skills });
    expect(result.assignments.start.find((a) => a.personId === "absent")?.station).toBe("off");
    expect(result.assignments.start.find((a) => a.personId === "leave")?.station).toBe("off");
    expect(result.assignments.start.find((a) => a.personId === "absent")?.unassignedReason).toBeUndefined();
  });

  it("테스트 4: 입사 전이면 미배치에도 표시하지 않는다", () => {
    const catalog = miniCatalog({ innerStart: 1 });
    const roster = [
      person("future", "heating", { hireDate: "2026-08-25" }),
      person("qual-1", "inner", { constraints: innerQual() }),
      person("heat-1", "heating"),
    ];
    const skills = skillsFor(roster, catalog, {
      "qual-1": { inner: 1 },
      "heat-1": { h1: 1 },
    });
    const result = run({ roster, catalog, skills, workDate: "2026-08-24" });
    expect(result.assignments.start.some((a) => a.personId === "future")).toBe(false);
  });

  it("테스트 5: 숙련 1~4가 있으면 기존처럼 자동배치 후보", () => {
    const catalog = miniCatalog({ innerStart: 1 });
    const roster = [
      person("qual-1", "inner", { constraints: innerQual() }),
      person("heat-1", "heating"),
    ];
    const skills = skillsFor(roster, catalog, {
      "qual-1": { inner: 1 },
      "heat-1": { h1: 1 },
    });
    const result = run({ roster, catalog, skills });
    expect(namesOn(result, "start", "heating")).toContain("heat-1");
    expect(namesOn(result, "start", "inner")).toContain("qual-1");
  });

  it("테스트 6: 명시적 불가와 미설정을 다르게 본다", () => {
    const catalog = miniCatalog({ innerStart: 1 });
    const roster = [
      person("unset", "heating"),
      person("all-zero", "heating", { constraints: { skillConfiguredGroups: ["phono_signature"] } }),
      person("qual-1", "inner", { constraints: innerQual() }),
      person("heat-1", "heating"),
    ];
    const skills = skillsFor(roster, catalog, {
      "qual-1": { inner: 1 },
      "heat-1": { h1: 1 },
    });
    const result = run({ roster, catalog, skills });
    const unset = result.assignments.start.find((a) => a.personId === "unset");
    const allZero = result.assignments.start.find((a) => a.personId === "all-zero");
    expect(unset?.station).toBe("unassigned");
    expect(unset?.unassignedReason).toBe("NO_SKILL_CONFIG");
    expect(allZero?.unassignedReason).not.toBe("NO_SKILL_CONFIG");
    expect(namesOn(result, "start", "heating")).not.toContain("all-zero");
  });

  it("테스트 7: 숙련 미설정자를 내포장으로 수동 이동해도 기존 인원을 밀어내지 않는다", () => {
    const catalog = miniCatalog({ innerStart: 2 });
    const roster = [
      person("new-hire", "heating"),
      person("qual-1", "inner", { constraints: innerQual() }),
      person("pack-a", "inner"),
      person("heat-1", "heating"),
    ];
    const skills = skillsFor(roster, catalog, {
      "qual-1": { inner: 1 },
      "pack-a": { inner: 1 },
      "heat-1": { h1: 1 },
    });
    const generated = run({ roster, catalog, skills });
    const before = namesOn(generated, "start", "inner");
    const moved = movePerson(generated.assignments, "start", "new-hire", "inner", "inner", skills, "phono_signature", roster);
    expect(moved.error).toBeUndefined();
    expect(moved.warning).toMatch(/숙련도가 설정되지 않았습니다/);
    const after = moved.assignments.start.filter((a) => a.station === "inner").map((a) => a.personId);
    expect(after).toContain("new-hire");
    for (const id of before) expect(after).toContain(id);
  });

  it("테스트 8: 숙련 미설정 수동 투입은 삼면포장기 자격으로 치지 않는다", () => {
    const catalog = miniCatalog({ innerStart: 3 });
    const roster = [
      person("new-hire", "inner"),
      person("pack-a", "inner"),
      person("pack-b", "inner"),
      person("heat-1", "heating"),
    ];
    const skills = skillsFor(roster, catalog, {
      "pack-a": { inner: 1 },
      "pack-b": { inner: 1 },
      "heat-1": { h1: 1 },
    });
    const generated = run({ roster, catalog, skills });
    expect(hasQualCheck(generated, "start")?.ok).toBe(false);
    const moved = movePerson(generated.assignments, "start", "new-hire", "inner", "inner", skills, "phono_signature", roster);
    const checks = buildChecks(
      moved.assignments,
      generated.targets,
      roster,
      LUNCH_OFF,
      catalog,
      "phono_signature",
      skills
    );
    expect(checks.some((c) => c.id.startsWith("qual:start:") && !c.ok)).toBe(true);
  });
});

describe("제품군별 자격", () => {
  it("파베이크 내포장은 삼면포장기 자격을 요구하지 않는다", () => {
    const catalog = miniCatalog({ innerStart: 2 });
    const roster = [
      person("pack-a", "inner"),
      person("pack-b", "inner"),
      person("heat-1", "heating"),
    ];
    const skills = skillsFor(roster, catalog, {
      "pack-a": { inner: 1 },
      "pack-b": { inner: 1 },
      "heat-1": { h1: 1 },
    });
    const result = generateRotation({
      roster,
      line: "parbake",
      modes: LUNCH_OFF,
      catalog,
      skills,
    });
    expect(result.checks.some((c) => c.id.includes("threeSidePacker"))).toBe(false);
    expect(namesOn(result, "start", "inner")).toHaveLength(2);
  });

  it("포노 자격만 있고 파베이크 자격이 없으면 파베이크 배치에 자격 검사가 안 걸린다", () => {
    const catalog = miniCatalog({ innerStart: 2 });
    const roster = [
      person("qual-1", "inner", { constraints: innerQual("phono_signature") }),
      person("pack-a", "inner"),
      person("heat-1", "heating"),
    ];
    const skills = skillsFor(roster, catalog, {
      "qual-1": { inner: 1 },
      "pack-a": { inner: 1 },
      "heat-1": { h1: 1 },
    });
    const phono = run({ roster, catalog, skills });
    expect(hasQualCheck(phono, "start")?.ok).toBe(true);
    const parbake = generateRotation({
      roster,
      line: "parbake",
      modes: LUNCH_OFF,
      catalog,
      skills,
    });
    expect(parbake.checks.some((c) => c.id.includes("threeSidePacker"))).toBe(false);
  });
});
