import { getPriority, hasAssignableSkill, hasNoSkillConfig, heatingPositions, isAssignedOfficePerson, isNormalRank, positionsForProcess, visibleRotationRoster } from "./catalog";
import { normalizeDoughSettings } from "./doughPolicy";
import { HOURLY_QTY, productGroup } from "./seedRoster";
import { isAvailableInPeriod, isDoughCorePerson, isFullDayLeave } from "./planningLeave";
import { canTakeProcess, hardStayFloor, isFieldBackup, isRotationExcluded } from "./personRules";
import {
  personMeetsProcessQualifications,
  qualificationLabel,
  requiredQualificationsForProcess,
} from "./qualifications";
import { processNeedsStaffing, staffingForPosition } from "./staffing";
import {
  PERIODS,
  PRIORITY_OPTIONS,
  PROCESSES,
  STATIONS,
  type Assignment,
  type ConstraintCheck,
  type DoughRotationPolicy,
  type GenerateInput,
  type GenerateResult,
  type PeriodAssignments,
  type PeriodId,
  type Person,
  type PositionCatalog,
  type PositionDef,
  type Priority,
  type ProcessId,
  type ProductGroup,
  type ProductLine,
  type ProductionImpact,
  type RotationModes,
  type RotationWarning,
  type SkillMatrix,
  type StaffingTarget,
  type StationId,
  type UnassignedReason,
  EMERGENCY_PRIORITY,
} from "./types";

export type Slot = {
  key: string;
  position: PositionDef;
  required: boolean;
};

export function unassignedReasonLabel(reason: UnassignedReason | undefined): string | undefined {
  if (reason === "NO_SKILL_CONFIG") return "숙련 미설정";
  if (reason === "NO_AVAILABLE_SLOT") return "여유 인원";
  return undefined;
}

export function processLabel(process: ProcessId | StationId): string {
  return STATIONS.find((s) => s.id === process)?.label ?? process;
}

/** 외포장만 1층. 식사·휴무·미배치·사무는 층 이동에 넣지 않음. */
export function processFloor(station: ProcessId | StationId): 0 | 1 | 2 {
  if (station === "outer") return 1;
  if (station === "lunch" || station === "off" || station === "unassigned" || station === "office") return 0;
  return 2;
}

function floorsDiffer(a: ProcessId | StationId | undefined, b: ProcessId | StationId | undefined): boolean {
  if (!a || !b) return false;
  const fa = processFloor(a);
  const fb = processFloor(b);
  return fa !== 0 && fb !== 0 && fa !== fb;
}

function staysOnFloor(person: Person, process: ProcessId | StationId, prev: Map<string, Assignment>): boolean {
  return !floorsDiffer(prev.get(person.id)?.station, process);
}

export function priorityLabel(p: Priority | undefined): string {
  return PRIORITY_OPTIONS.find((o) => o.value === p)?.label ?? "불가";
}

export function doughRotationBlocked(modes: RotationModes): boolean {
  return modes.lunch && modes.breakRotation && modes.splitShift;
}

export function extraHeatingHours(modes: RotationModes) {
  const lunchHours = modes.lunch ? 1 : 0;
  const breakHours = modes.breakRotation ? 0.5 : 0;
  const shiftHours = modes.splitShift ? 1 : 0;
  return { lunchHours, breakHours, shiftHours, extraHours: lunchHours + breakHours + shiftHours };
}

export function computeImpact(line: ProductLine, modes: RotationModes): ProductionImpact {
  const group = productGroup(line);
  const hours = extraHeatingHours(modes);
  const blocked = doughRotationBlocked(modes);
  const hourlyQty = HOURLY_QTY[group];
  let doughNote = "";
  if (!modes.lunch) doughNote = "점심 교대 없음. 반죽팀은 06:00–11:30 기존 마감.";
  else if (blocked) {
    doughNote =
      "3방법 동시 도입 시 반죽량이 늘어 반죽팀은 로테이션에 못 들어갑니다. 12시쯤 반죽을 끊고, 13시 이후 마감하면 14:30–15:00로 보는 편이 안전합니다.";
  } else {
    doughNote = "점심 로테이션만: 06:00–11:00 반죽 → 11:00–12:00 가열 백업 → 12:00 식사 → 13:00 1명은 반죽 마감.";
  }
  return {
    hourlyQty,
    extraHours: hours.extraHours,
    extraQty: Math.round(hourlyQty * hours.extraHours),
    lunchHours: hours.lunchHours,
    breakHours: hours.breakHours,
    shiftHours: hours.shiftHours,
    doughCanRotate: modes.lunch && !blocked,
    doughNote,
  };
}

export function heatingTarget(catalog: PositionCatalog, group: ProductGroup): number {
  return heatingPositions(catalog, group).length;
}

export function periodTargets(
  catalog: PositionCatalog,
  group: ProductGroup,
  _doughCount: number,
  _doughCanRotate: boolean
): Record<PeriodId, StaffingTarget> {
  const h = heatingTarget(catalog, group);
  const make = (period: PeriodId): StaffingTarget => ({
    heating: h,
    positions: catalog[group].filter((p) => processNeedsStaffing(p.process)).map((p) => {
      const range = staffingForPosition(p, period);
      return {
        positionId: p.id,
        process: p.process,
        label: p.label,
        min: range.min,
        max: range.max,
      };
    }),
  });
  return {
    start: make("start"),
    lunch1: make("lunch1"),
    lunch2: make("lunch2"),
    after: make("after"),
  };
}

export function canAssign(
  skills: SkillMatrix,
  personId: string,
  group: ProductGroup,
  positionId: string | undefined,
  station: StationId
): boolean {
  if (station === "lunch" || station === "off" || station === "unassigned") return true;
  if (!positionId) return false;
  return getPriority(skills, personId, group, positionId) > 0;
}

function byName(a: Person, b: Person): number {
  return a.name.localeCompare(b.name, "ko");
}

function expandPositionSlots(position: PositionDef, min: number, max: number): Slot[] {
  const slots: Slot[] = [];
  const cap = Math.max(0, max);
  const requiredN = Math.max(0, Math.min(min, cap));
  for (let i = 0; i < requiredN; i++) {
    slots.push({ key: `${position.process}:${position.id}:${i}`, position, required: true });
  }
  for (let i = requiredN; i < cap; i++) {
    slots.push({ key: `${position.process}:${position.id}:${i}:opt`, position, required: false });
  }
  return slots;
}

export function buildSlots(
  catalog: PositionCatalog,
  group: ProductGroup,
  period: PeriodId,
  targets: StaffingTarget
): Slot[] {
  const heat = heatingPositions(catalog, group).map((position, i) => ({
    key: `heating:${position.id}:${i}`,
    position,
    required: true,
  }));
  const staffed = (targets.positions.length > 0 ? targets.positions : catalog[group].filter((p) => processNeedsStaffing(p.process)).map((p) => {
    const range = staffingForPosition(p, period);
    return { positionId: p.id, process: p.process, label: p.label, min: range.min, max: range.max };
  })).flatMap((need) => {
    const position = catalog[group].find((p) => p.id === need.positionId);
    if (!position) return [];
    return expandPositionSlots(position, need.min, need.max);
  });
  return [...heat, ...staffed];
}

function capableOf(
  people: Person[],
  skills: SkillMatrix,
  group: ProductGroup,
  positionId: string,
  taken: Set<string>
): Person[] {
  return people.filter((p) => !taken.has(p.id) && getPriority(skills, p.id, group, positionId) > 0);
}

function isUsablePriority(priority: Priority, allowEmergency: boolean): boolean {
  if (isNormalRank(priority)) return true;
  return allowEmergency && priority === EMERGENCY_PRIORITY;
}

function pickPreferredCapable(
  people: Person[],
  skills: SkillMatrix,
  group: ProductGroup,
  positionId: string,
  allowEmergency: boolean
): Person | undefined {
  const ranked = people
    .map((p) => ({ p, pr: getPriority(skills, p.id, group, positionId) }))
    .filter((row) => isUsablePriority(row.pr, allowEmergency));
  const normal = ranked.filter((row) => isNormalRank(row.pr));
  const pool = normal.length > 0 ? normal : ranked;
  return [...pool].sort((a, b) => a.pr - b.pr || byName(a.p, b.p))[0]?.p;
}

const BACKUP_PROCESSES: ProcessId[] = ["topping", "inner", "outer", "cleanup"];

function backupStationCount(
  person: Person,
  skills: SkillMatrix,
  catalog: PositionCatalog,
  group: ProductGroup
): number {
  return BACKUP_PROCESSES.filter((process) =>
    positionsForProcess(catalog, group, process).some((d) => isNormalRank(getPriority(skills, person.id, group, d.id)))
  ).length;
}

function scoreCandidate(
  person: Person,
  slot: Slot,
  priority: Priority,
  prev: Map<string, Assignment>,
  skills: SkillMatrix,
  catalog: PositionCatalog,
  group: ProductGroup
): number {
  const prevA = prev.get(person.id);
  let s = 0;
  s += (6 - priority) * 100;
  if (person.preferred === slot.position.process) s += 30;
  if (prevA?.positionId === slot.position.id) s += 20;
  if (prevA?.station === slot.position.process) s += 6;
  if (prevA && floorsDiffer(prevA.station, slot.position.process)) s -= 220;
  else if (prevA && processFloor(prevA.station) !== 0 && processFloor(prevA.station) === processFloor(slot.position.process)) s += 80;
  if (slot.position.process === "heating") {
    const backups = backupStationCount(person, skills, catalog, group);
    s += backups === 0 ? 220 : -backups * 35;
  }
  return s;
}

type ScoreVec = {
  unfilledHeat: number;
  missingQual: number;
  unfilled: number;
  emergency: number;
  floorMoves: number;
  flexOnHeat: number;
  rank4: number;
  rank3: number;
  rankSum: number;
  prefLeave: number;
  changed: number;
};

function cmpScore(a: ScoreVec, b: ScoreVec): number {
  const keys: (keyof ScoreVec)[] = [
    "unfilledHeat",
    "missingQual",
    "unfilled",
    "emergency",
    "floorMoves",
    "flexOnHeat",
    "rank4",
    "rank3",
    "rankSum",
    "prefLeave",
    "changed",
  ];
  for (const k of keys) {
    if (a[k] !== b[k]) return a[k] - b[k];
  }
  return 0;
}

function scoreRequired(
  filled: Map<string, Assignment>,
  slots: Slot[],
  roster: Person[],
  prev: Map<string, Assignment>,
  skills: SkillMatrix,
  catalog: PositionCatalog,
  group: ProductGroup
): ScoreVec {
  const byId = new Map(roster.map((p) => [p.id, p]));
  const vec: ScoreVec = {
    unfilledHeat: 0,
    missingQual: 0,
    unfilled: 0,
    emergency: 0,
    floorMoves: 0,
    flexOnHeat: 0,
    rank4: 0,
    rank3: 0,
    rankSum: 0,
    prefLeave: 0,
    changed: 0,
  };
  const requiredByProcess = new Map<ProcessId, Slot[]>();
  for (const slot of slots) {
    if (!slot.required) continue;
    const list = requiredByProcess.get(slot.position.process) ?? [];
    list.push(slot);
    requiredByProcess.set(slot.position.process, list);
    const a = filled.get(slot.key);
    if (!a) {
      if (slot.position.process === "heating") vec.unfilledHeat += 1;
      else vec.unfilled += 1;
      continue;
    }
    const pr = a.priority ?? 0;
    const person = byId.get(a.personId);
    vec.rankSum += pr;
    if (pr === EMERGENCY_PRIORITY) vec.emergency += 1;
    if (pr === 4) vec.rank4 += 1;
    if (pr === 3) vec.rank3 += 1;
    if (slot.position.process === "heating" && person && backupStationCount(person, skills, catalog, group) > 0) {
      vec.flexOnHeat += 1;
    }
    if (person && person.preferred !== slot.position.process && slot.position.process !== "cleanup") vec.prefLeave += 1;
    const prevA = prev.get(a.personId);
    if (prevA && floorsDiffer(prevA.station, slot.position.process)) vec.floorMoves += 1;
    if (prevA && prevA.positionId && prevA.positionId !== a.positionId) vec.changed += 1;
  }
  for (const [process, procSlots] of Array.from(requiredByProcess.entries())) {
    const keys = requiredQualificationsForProcess(process, group);
    if (keys.length === 0 || procSlots.length === 0) continue;
    const holders = procSlots
      .map((s) => filled.get(s.key))
      .filter((a): a is Assignment => Boolean(a))
      .map((a) => byId.get(a.personId))
      .filter((p): p is Person => Boolean(p));
    if (!holders.some((p) => personMeetsProcessQualifications(p, process, group))) vec.missingQual += 1;
  }
  return vec;
}

function warnForPriority(personName: string, label: string, priority: Priority, preferred: ProcessId, process: ProcessId): RotationWarning[] {
  const out: RotationWarning[] = [];
  if (priority === EMERGENCY_PRIORITY) {
    out.push({ kind: "emergency", message: `${personName} → ${label} [비상]` });
  } else if (priority === 4) {
    out.push({ kind: "rank4", message: `${personName} → ${label} [하]` });
  } else if (priority === 3) {
    out.push({ kind: "rank3", message: `${personName} → ${label} [중]` });
  }
  if (preferred !== process && process !== "cleanup") {
    out.push({ kind: "preferredLeave", message: `${personName} 주공정 ${processLabel(preferred)} → ${label}` });
  }
  return out;
}

type AssignOutcome = {
  assignments: Assignment[];
  unfilled: Slot[];
  warnings: RotationWarning[];
};

type AssignOptions = {
  strictFloor?: boolean;
  backups?: Person[];
  doughPolicy?: DoughRotationPolicy;
  doughCoreIds?: Set<string>;
};

function emptyAssignOptions(opts?: boolean | AssignOptions): AssignOptions {
  if (opts === true) return { strictFloor: true };
  if (opts === false || opts == null) return {};
  return opts;
}

function eligibleForDoughPolicy(person: Person, process: ProcessId, opts: AssignOptions): boolean {
  if (opts.doughPolicy !== "FIXED_DOUGH" || process !== "dough") return true;
  return Boolean(opts.doughCoreIds?.has(person.id));
}

function pickForSlot(
  people: Person[],
  slot: Slot,
  skills: SkillMatrix,
  group: ProductGroup,
  taken: Set<string>,
  prev: Map<string, Assignment>,
  catalog: PositionCatalog,
  opts: AssignOptions = {},
  requireQual = false
): Person | undefined {
  const all = capableOf(people, skills, group, slot.position.id, taken).filter((p) =>
    isUsablePriority(getPriority(skills, p.id, group, slot.position.id), slot.required) &&
    canTakeProcess(p, slot.position.process, group) &&
    eligibleForDoughPolicy(p, slot.position.process, opts) &&
    (!requireQual || personMeetsProcessQualifications(p, slot.position.process, group))
  );
  const normal = all.filter((p) => isNormalRank(getPriority(skills, p.id, group, slot.position.id)));
  const base = normal.length > 0 ? normal : all;
  const stay = base.filter((p) => staysOnFloor(p, slot.position.process, prev));
  const fallback = base.filter((p) => !hardStayFloor(p));
  const pool = stay.length > 0 ? stay : slot.required && !opts.strictFloor ? fallback : [];
  return [...pool].sort((a, b) => {
    const pa = getPriority(skills, a.id, group, slot.position.id);
    const pb = getPriority(skills, b.id, group, slot.position.id);
    const d =
      scoreCandidate(b, slot, pb, prev, skills, catalog, group) -
      scoreCandidate(a, slot, pa, prev, skills, catalog, group);
    return d !== 0 ? d : byName(a, b);
  })[0];
}

function processHasQualifiedHolder(
  filled: Map<string, Assignment>,
  slots: Slot[],
  process: ProcessId,
  byId: Map<string, Person>,
  group: ProductGroup
): boolean {
  return slots.some((slot) => {
    if (slot.position.process !== process) return false;
    const a = filled.get(slot.key);
    if (!a) return false;
    const person = byId.get(a.personId);
    return Boolean(person && personMeetsProcessQualifications(person, process, group));
  });
}

function fillRequiredQualifications(
  people: Person[],
  backups: Person[],
  slots: Slot[],
  filled: Map<string, Assignment>,
  taken: Set<string>,
  skills: SkillMatrix,
  group: ProductGroup,
  prev: Map<string, Assignment>,
  catalog: PositionCatalog,
  opts: AssignOptions,
  byId: Map<string, Person>
) {
  const required = slots.filter((s) => s.required);
  const processes = Array.from(new Set(required.map((s) => s.position.process)));
  for (const process of processes) {
    const keys = requiredQualificationsForProcess(process, group);
    if (keys.length === 0) continue;
    const procSlots = required.filter((s) => s.position.process === process);
    if (procSlots.length === 0) continue;
    if (processHasQualifiedHolder(filled, procSlots, process, byId, group)) continue;

    const floorPick = pickForSlot(people, procSlots[0], skills, group, taken, prev, catalog, opts, true);
    const backupPick = floorPick
      ? undefined
      : pickForSlot(backups, procSlots[0], skills, group, taken, prev, catalog, { ...opts, strictFloor: false }, true);
    const pick = floorPick ?? backupPick;
    if (!pick) continue;

    let slot = procSlots.find((s) => !filled.has(s.key));
    if (!slot) {
      const displace = procSlots
        .map((s) => ({ s, a: filled.get(s.key) }))
        .filter((row): row is { s: Slot; a: Assignment } => Boolean(row.a))
        .filter((row) => {
          const person = byId.get(row.a.personId);
          return !person || !personMeetsProcessQualifications(person, process, group);
        })
        .sort((a, b) => (b.a.priority ?? 0) - (a.a.priority ?? 0))[0];
      if (!displace) continue;
      taken.delete(displace.a.personId);
      filled.delete(displace.s.key);
      slot = displace.s;
    }
    const priority = getPriority(skills, pick.id, group, slot.position.id);
    taken.add(pick.id);
    filled.set(slot.key, {
      personId: pick.id,
      station: slot.position.process,
      positionId: slot.position.id,
      priority,
    });
  }
}

function assignSlots(
  people: Person[],
  slots: Slot[],
  skills: SkillMatrix,
  group: ProductGroup,
  prev: Map<string, Assignment>,
  catalog: PositionCatalog,
  optsOrStrict: boolean | AssignOptions = false
): AssignOutcome {
  const opts = emptyAssignOptions(optsOrStrict);
  const backups = (opts.backups ?? []).filter((p) => !people.some((x) => x.id === p.id));
  const allKnown = [...people, ...backups];
  const byId = new Map(allKnown.map((p) => [p.id, p]));
  const taken = new Set<string>();
  const filled = new Map<string, Assignment>();
  const remaining = [...slots];

  const required = remaining.filter((s) => s.required);
  const primarySlots = new Map<string, Slot[]>();
  for (const slot of required) {
    for (const person of people) {
      if (getPriority(skills, person.id, group, slot.position.id) !== 1) continue;
      if (!canTakeProcess(person, slot.position.process, group)) continue;
      if (!eligibleForDoughPolicy(person, slot.position.process, opts)) continue;
      if (!staysOnFloor(person, slot.position.process, prev)) continue;
      if (slot.position.process === "heating" && backupStationCount(person, skills, catalog, group) > 0) continue;
      const list = primarySlots.get(person.id) ?? [];
      list.push(slot);
      primarySlots.set(person.id, list);
    }
  }
  for (const [personId, list] of Array.from(primarySlots.entries())) {
    if (list.length !== 1 || taken.has(personId)) continue;
    const slot = list[0];
    if (filled.has(slot.key)) continue;
    const person = people.find((p) => p.id === personId);
    if (!person) continue;
    taken.add(person.id);
    filled.set(slot.key, {
      personId: person.id,
      station: slot.position.process,
      positionId: slot.position.id,
      priority: 1,
    });
  }

  const contested = Array.from(primarySlots.entries())
    .filter(([, list]) => list.length > 1)
    .sort((a, b) => {
      const minA = Math.min(
        ...a[1].map((s) => capableOf(people, skills, group, s.position.id, new Set([a[0]])).length)
      );
      const minB = Math.min(
        ...b[1].map((s) => capableOf(people, skills, group, s.position.id, new Set([b[0]])).length)
      );
      return minA - minB;
    });
  for (const [personId, list] of contested) {
    if (taken.has(personId)) continue;
    const open = list.filter((s) => !filled.has(s.key));
    if (open.length === 0) continue;
    const takenIds = [personId].concat(Array.from(taken));
    open.sort(
      (s1, s2) =>
        capableOf(people, skills, group, s1.position.id, new Set(takenIds)).length -
        capableOf(people, skills, group, s2.position.id, new Set(takenIds)).length
    );
    const slot = open[0];
    const person = people.find((p) => p.id === personId);
    if (!person) continue;
    const priority = getPriority(skills, person.id, group, slot.position.id);
    taken.add(person.id);
    filled.set(slot.key, {
      personId: person.id,
      station: slot.position.process,
      positionId: slot.position.id,
      priority,
    });
  }

  fillRequiredQualifications(people, backups, slots, filled, taken, skills, group, prev, catalog, opts, byId);

  const leftoverSlots = remaining.filter((s) => !filled.has(s.key));
  while (leftoverSlots.length > 0) {
    leftoverSlots.sort((a, b) => {
      if (a.required !== b.required) return a.required ? -1 : 1;
      const ca = capableOf(people, skills, group, a.position.id, taken).length;
      const cb = capableOf(people, skills, group, b.position.id, taken).length;
      if (ca !== cb) return ca - cb;
      return a.key.localeCompare(b.key);
    });
    const slot = leftoverSlots.shift()!;
    if (filled.has(slot.key)) continue;
    const needQual =
      slot.required &&
      requiredQualificationsForProcess(slot.position.process, group).length > 0 &&
      !processHasQualifiedHolder(filled, remaining.filter((s) => s.position.process === slot.position.process), slot.position.process, byId, group);
    const pick =
      (needQual ? pickForSlot(people, slot, skills, group, taken, prev, catalog, opts, true) : undefined) ??
      pickForSlot(people, slot, skills, group, taken, prev, catalog, opts, false);
    if (!pick) continue;
    const priority = getPriority(skills, pick.id, group, slot.position.id);
    taken.add(pick.id);
    filled.set(slot.key, {
      personId: pick.id,
      station: slot.position.process,
      positionId: slot.position.id,
      priority,
    });
  }

  fillRequiredQualifications(people, backups, slots, filled, taken, skills, group, prev, catalog, opts, byId);
  optimizeFilled(allKnown, slots, filled, skills, group, prev, catalog);
  taken.clear();
  Array.from(filled.values()).forEach((a) => taken.add(a.personId));

  const assignments: Assignment[] = [];
  const warnings: RotationWarning[] = [];
  const unfilled: Slot[] = [];
  for (const slot of slots) {
    const a = filled.get(slot.key);
    if (!a) {
      if (slot.required) unfilled.push(slot);
      continue;
    }
    assignments.push(a);
    const person = byId.get(a.personId);
    if (person) warnings.push(...warnForPriority(person.name, slot.position.label, a.priority ?? 0, person.preferred, slot.position.process));
  }
  for (const person of people) {
    if (taken.has(person.id)) continue;
    assignments.push({ personId: person.id, station: "unassigned", unassignedReason: "NO_AVAILABLE_SLOT" });
  }
  return { assignments, unfilled, warnings };
}

function isReserveBackup(person: Person): boolean {
  return isFieldBackup(person) && (person.group === "office" || person.preferred === "office");
}

function optimizeFilled(
  people: Person[],
  slots: Slot[],
  filled: Map<string, Assignment>,
  skills: SkillMatrix,
  group: ProductGroup,
  prev: Map<string, Assignment>,
  catalog: PositionCatalog
) {
  const required = slots.filter((s) => s.required);
  let best = scoreRequired(filled, required, people, prev, skills, catalog, group);
  for (let n = 0; n < 120; n++) {
    let improved = false;
    const keys = required.map((s) => s.key).filter((k) => filled.has(k));
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = filled.get(keys[i])!;
        const b = filled.get(keys[j])!;
        const slotA = required.find((s) => s.key === keys[i])!;
        const slotB = required.find((s) => s.key === keys[j])!;
        const personA = people.find((p) => p.id === a.personId);
        const personB = people.find((p) => p.id === b.personId);
        if (personB && !canTakeProcess(personB, slotA.position.process, group)) continue;
        if (personA && !canTakeProcess(personA, slotB.position.process, group)) continue;
        if (personB && hardStayFloor(personB) && floorsDiffer(prev.get(personB.id)?.station, slotA.position.process)) continue;
        if (personA && hardStayFloor(personA) && floorsDiffer(prev.get(personA.id)?.station, slotB.position.process)) continue;
        if (personB && isReserveBackup(personB) && requiredQualificationsForProcess(slotA.position.process, group).length === 0) continue;
        if (personA && isReserveBackup(personA) && requiredQualificationsForProcess(slotB.position.process, group).length === 0) continue;
        const pa = getPriority(skills, b.personId, group, slotA.position.id);
        const pb = getPriority(skills, a.personId, group, slotB.position.id);
        if (pa === 0 || pb === 0) continue;
        if (isNormalRank(getPriority(skills, a.personId, group, slotA.position.id)) && pa === EMERGENCY_PRIORITY) continue;
        if (isNormalRank(getPriority(skills, b.personId, group, slotB.position.id)) && pb === EMERGENCY_PRIORITY) continue;
        const next = new Map(Array.from(filled.entries()));
        next.set(keys[i], { personId: b.personId, station: slotA.position.process, positionId: slotA.position.id, priority: pa });
        next.set(keys[j], { personId: a.personId, station: slotB.position.process, positionId: slotB.position.id, priority: pb });
        const sc = scoreRequired(next, required, people, prev, skills, catalog, group);
        if (cmpScore(sc, best) < 0) {
          filled.clear();
          Array.from(next.entries()).forEach(([k, v]) => filled.set(k, v));
          best = sc;
          improved = true;
        }
      }
    }
    const taken = new Set(Array.from(filled.values()).map((a) => a.personId));
    for (const slot of required) {
      const cur = filled.get(slot.key);
      if (!cur) continue;
      const others = people.filter(
        (p) =>
          !taken.has(p.id) &&
          getPriority(skills, p.id, group, slot.position.id) > 0 &&
          canTakeProcess(p, slot.position.process, group) &&
          !(hardStayFloor(p) && floorsDiffer(prev.get(p.id)?.station, slot.position.process)) &&
          !(isReserveBackup(p) && requiredQualificationsForProcess(slot.position.process, group).length === 0)
      );
      for (const person of others) {
        const pr = getPriority(skills, person.id, group, slot.position.id);
        if (isNormalRank(cur.priority ?? 0) && pr === EMERGENCY_PRIORITY) continue;
        if (isReserveBackup(person)) {
          const byId = new Map(people.map((p) => [p.id, p]));
          const already = processHasQualifiedHolder(
            filled,
            required.filter((s) => s.position.process === slot.position.process),
            slot.position.process,
            byId,
            group
          );
          const current = byId.get(cur.personId);
          if (already && current && personMeetsProcessQualifications(current, slot.position.process, group)) continue;
          if (already && current && !personMeetsProcessQualifications(person, slot.position.process, group)) continue;
          if (already && !personMeetsProcessQualifications(person, slot.position.process, group)) continue;
          if (already) continue;
        }
        const next = new Map(Array.from(filled.entries()));
        next.set(slot.key, { personId: person.id, station: slot.position.process, positionId: slot.position.id, priority: pr });
        const sc = scoreRequired(next, required, people, prev, skills, catalog, group);
        if (cmpScore(sc, best) < 0) {
          filled.clear();
          Array.from(next.entries()).forEach(([k, v]) => filled.set(k, v));
          best = sc;
          improved = true;
          taken.clear();
          Array.from(filled.values()).forEach((a) => taken.add(a.personId));
          break;
        }
      }
      if (improved) break;
    }
    if (!improved) break;
  }
}

function placeLeftovers(
  rows: Assignment[],
  roster: Person[],
  skills: SkillMatrix,
  catalog: PositionCatalog,
  group: ProductGroup,
  prev: Map<string, Assignment>,
  period: PeriodId,
  opts: AssignOptions = {}
): Assignment[] {
  const byId = new Map(roster.map((p) => [p.id, p]));
  const leftover = rows.filter((r) => r.station === "unassigned");
  const kept = rows.filter((r) => r.station !== "unassigned");
  const counts = new Map<string, number>();
  for (const row of kept) {
    if (row.positionId) counts.set(row.positionId, (counts.get(row.positionId) ?? 0) + 1);
  }
  const fallback: ProcessId[] = ["topping", "inner", "outer", "rnd", "office"];
  const extra: Assignment[] = [];
  for (const row of leftover) {
    const person = byId.get(row.personId);
    if (!person) continue;
    if (isFieldBackup(person) && isAssignedOfficePerson(person, skills, catalog, group)) {
      extra.push(row);
      continue;
    }
    const scored = fallback.flatMap((process) => {
      const defs = positionsForProcess(catalog, group, process);
      return defs.flatMap((d) => {
          const pr = getPriority(skills, person.id, group, d.id);
          if (pr === 0) return [];
          if (!canTakeProcess(person, process, group)) return [];
          if (!eligibleForDoughPolicy(person, process, opts)) return [];
          const range = staffingForPosition(d, period);
          const cur = counts.get(d.id) ?? 0;
          if (cur >= range.max) return [];
          if (!isUsablePriority(pr, cur < range.min)) return [];
          let sc = (6 - pr) * 10;
          if (person.preferred === process) sc += 8;
          if (prev.get(person.id)?.positionId === d.id) sc += 12;
          if (prev.get(person.id)?.station === process) sc += 6;
          const prevSt = prev.get(person.id)?.station;
          if (prevSt && floorsDiffer(prevSt, process)) return [];
          return [{ process, d, pr, sc }];
        });
    });
    scored.sort((a, b) => b.sc - a.sc);
    const best = scored[0];
    if (!best) {
      extra.push(row);
      continue;
    }
    counts.set(best.d.id, (counts.get(best.d.id) ?? 0) + 1);
    extra.push({ personId: person.id, station: best.process, positionId: best.d.id, priority: best.pr });
  }
  return [...kept, ...extra];
}

function dryLunchScore(
  people: Person[],
  slots: Slot[],
  skills: SkillMatrix,
  group: ProductGroup,
  catalog: PositionCatalog,
  startMap: Map<string, Assignment>,
  opts: AssignOptions = {}
): number {
  const out = assignSlots(people, slots, skills, group, startMap, catalog, { ...opts, strictFloor: true, backups: [] });
  const byId = new Map(people.map((p) => [p.id, p]));
  let missingQual = 0;
  const processes = Array.from(new Set(slots.filter((s) => s.required).map((s) => s.position.process)));
  for (const process of processes) {
    if (requiredQualificationsForProcess(process, group).length === 0) continue;
    const required = slots.filter((s) => s.required && s.position.process === process);
    if (required.length === 0) continue;
    const holders = out.assignments
      .filter((a) => a.station === process)
      .map((a) => byId.get(a.personId))
      .filter((p): p is Person => Boolean(p));
    if (!holders.some((p) => personMeetsProcessQualifications(p, process, group))) missingQual += 1;
  }
  let floorMoves = 0;
  for (const a of out.assignments) {
    if (a.station === "unassigned") continue;
    const prevA = startMap.get(a.personId);
    if (prevA && floorsDiffer(prevA.station, a.station)) floorMoves += 1;
  }
  return missingQual * 80 + out.unfilled.length * 20 + floorMoves;
}

function partitionLunch(
  eaters: Person[],
  slots: Slot[],
  skills: SkillMatrix,
  group: ProductGroup,
  doughCore: Person[],
  doughCanRotate: boolean,
  catalog: PositionCatalog,
  startMap: Map<string, Assignment>
): { waveA: Person[]; waveB: Person[]; warnings: RotationWarning[] } {
  const warnings: RotationWarning[] = [];
  const workCount = slots.filter((s) => s.required).length;
  const sizeB = Math.min(eaters.length, Math.max(workCount, Math.ceil(eaters.length / 2)));
  const A: Person[] = [];
  const B: Person[] = [];
  const placed = new Set<string>();

  const heatingSlots = slots.filter((s) => s.position.process === "heating" && s.required);
  heatingSlots.sort(
    (a, b) =>
      capableOf(eaters, skills, group, a.position.id, new Set()).length -
      capableOf(eaters, skills, group, b.position.id, new Set()).length
  );

  const pickFor = (pool: Person[], slot: Slot, preferIds: Set<string>) => {
    const candidates = capableOf(pool, skills, group, slot.position.id, placed).filter((p) =>
      canTakeProcess(p, slot.position.process, group)
    );
    const normal = candidates.filter((p) => isNormalRank(getPriority(skills, p.id, group, slot.position.id)));
    const base = normal.length > 0 ? normal : candidates;
    const stay = base.filter((p) => staysOnFloor(p, slot.position.process, startMap));
    const source = stay.length > 0 ? stay : base.filter((p) => !hardStayFloor(p));
    return [...source].sort((a, b) => {
      const pa = getPriority(skills, a.id, group, slot.position.id);
      const pb = getPriority(skills, b.id, group, slot.position.id);
      const da = (preferIds.has(a.id) ? 50 : 0) + (5 - pa) * 10;
      const db = (preferIds.has(b.id) ? 50 : 0) + (5 - pb) * 10;
      return db - da || byName(a, b);
    })[0];
  };

  const doughIds = new Set(doughCanRotate ? doughCore.map((p) => p.id) : []);

  for (const slot of heatingSlots) {
    const capAll = capableOf(eaters, skills, group, slot.position.id, new Set());
    if (capAll.length < 2) {
      warnings.push({
        kind: "lunchCoverage",
        message: `${slot.position.label} 가능자가 ${capAll.length}명뿐이라 11시·12시 양쪽을 채울 수 없습니다.`,
      });
    }
    const bHas = B.some((p) => getPriority(skills, p.id, group, slot.position.id) > 0);
    const aHas = A.some((p) => getPriority(skills, p.id, group, slot.position.id) > 0);
    if (!bHas) {
      const pick = pickFor(eaters, slot, doughIds);
      if (pick) {
        B.push(pick);
        placed.add(pick.id);
      }
    }
    if (!aHas) {
      const pick = pickFor(eaters, slot, new Set());
      if (pick) {
        A.push(pick);
        placed.add(pick.id);
      }
    }
  }

  const fillQuota = (posId: string, process: ProcessId, need: number) => {
    const isOuterAnchor = (p: Person) => process === "outer" && startMap.get(p.id)?.station === "outer";
    const isProcessAnchor = (p: Person) => startMap.get(p.id)?.station === process;
    const countIn = (arr: Person[]) =>
      arr.filter((p) => getPriority(skills, p.id, group, posId) > 0 && staysOnFloor(p, process, startMap)).length;
    for (const side of [B, A]) {
      while (countIn(side) < need) {
        const open = eaters.filter((p) => !placed.has(p.id) && canTakeProcess(p, process, group));
        const anchors = open.filter((p) => isOuterAnchor(p) || (process !== "outer" && isProcessAnchor(p) && staysOnFloor(p, process, startMap)));
        const stay = open.filter((p) => staysOnFloor(p, process, startMap));
        const softFallback = open.filter(
          (p) => !hardStayFloor(p) && startMap.get(p.id)?.station !== "inner"
        );
        const pool =
          anchors.length > 0 ? anchors : stay.length > 0 ? stay : process === "outer" ? softFallback : open.filter((p) => !hardStayFloor(p));
        const pick = pickPreferredCapable(pool, skills, group, posId, true);
        if (!pick) break;
        side.push(pick);
        placed.add(pick.id);
      }
    }
  };
  const fillRequiredQuals = (posId: string, process: ProcessId) => {
    const keys = requiredQualificationsForProcess(process, group);
    if (keys.length === 0) return;
    const sideHas = (arr: Person[]) =>
      arr.some(
        (p) =>
          personMeetsProcessQualifications(p, process, group) &&
          getPriority(skills, p.id, group, posId) > 0 &&
          staysOnFloor(p, process, startMap)
      );
    for (const side of [B, A]) {
      if (sideHas(side)) continue;
      const open = eaters.filter(
        (p) =>
          !placed.has(p.id) &&
          canTakeProcess(p, process, group) &&
          personMeetsProcessQualifications(p, process, group) &&
          getPriority(skills, p.id, group, posId) > 0
      );
      const stay = open.filter((p) => staysOnFloor(p, process, startMap));
      const pick = pickPreferredCapable(stay.length > 0 ? stay : open.filter((p) => !hardStayFloor(p)), skills, group, posId, true);
      if (!pick) continue;
      side.push(pick);
      placed.add(pick.id);
    }
  };
  const lunchNeeds = new Map<string, { process: ProcessId; need: number }>();
  for (const slot of slots) {
    if (!slot.required || !processNeedsStaffing(slot.position.process)) continue;
    const cur = lunchNeeds.get(slot.position.id);
    lunchNeeds.set(slot.position.id, { process: slot.position.process, need: (cur?.need ?? 0) + 1 });
  }
  for (const [posId, row] of Array.from(lunchNeeds.entries())) fillRequiredQuals(posId, row.process);
  for (const [posId, row] of Array.from(lunchNeeds.entries())) fillQuota(posId, row.process, row.need);

  const rest = eaters.filter((p) => !placed.has(p.id)).sort((a, b) => {
    const da = doughIds.has(a.id) ? 1 : 0;
    const db = doughIds.has(b.id) ? 1 : 0;
    return db - da || byName(a, b);
  });
  for (const person of rest) {
    if (B.length < sizeB) {
      B.push(person);
    } else {
      A.push(person);
    }
    placed.add(person.id);
  }

  // 같은 포지션 가능자·외포장 가능자가 한쪽에 몰리면 스왑
  const scorePartition = (a: Person[], b: Person[]) =>
    dryLunchScore(b, slots, skills, group, catalog, startMap) +
    dryLunchScore(a, slots, skills, group, catalog, startMap);
  let bestA = A;
  let bestB = B;
  let best = scorePartition(A, B);
  for (let i = 0; i < 80 && best > 0; i++) {
    let improved = false;
    for (const pa of bestA) {
      for (const pb of bestB) {
        const nextA = bestA.map((p) => (p.id === pa.id ? pb : p));
        const nextB = bestB.map((p) => (p.id === pb.id ? pa : p));
        const sc = scorePartition(nextA, nextB);
        if (sc < best) {
          best = sc;
          bestA = nextA;
          bestB = nextB;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
    if (!improved) break;
  }

  if (best > 0) {
    warnings.push({
      kind: "lunchCoverage",
      message: `점심조를 나눠도 필수포지션 ${best}자리가 비는 배분이 됩니다. 숙련도를 보강하거나 휴무를 조정하세요.`,
    });
  }
  return { waveA: bestA, waveB: bestB, warnings };
}

function toPrevWorkMap(...waves: Assignment[][]): Map<string, Assignment> {
  const map = new Map<string, Assignment>();
  for (const rows of waves) {
    for (const row of rows) {
      if (row.station === "lunch" || row.station === "off" || row.station === "unassigned") continue;
      map.set(row.personId, row);
    }
  }
  return map;
}

function officeRows(
  office: Person[],
  catalog: PositionCatalog,
  group: ProductGroup,
  skills: SkillMatrix,
  already: Set<string> = new Set()
): Assignment[] {
  const def = positionsForProcess(catalog, group, "office")[0];
  return office.flatMap((p) => {
    if (already.has(p.id)) return [];
    const pr = def ? getPriority(skills, p.id, group, def.id) : 0;
    if (pr === 0) return [];
    return [{ personId: p.id, station: "office" as const, positionId: def?.id, priority: pr }];
  });
}

function offRows(roster: Person[], period: PeriodId): Assignment[] {
  return roster
    .filter((p) => isFullDayLeave(p.leaveKind) || !p.present || (p.present && !isAvailableInPeriod(p, period)))
    .map((p) => ({ personId: p.id, station: "off" as const }));
}

function onDuty(
  roster: Person[],
  period: PeriodId,
  group: "floor" | "office",
  skills: SkillMatrix,
  catalog: PositionCatalog,
  productGroup: ProductGroup
): Person[] {
  return roster.filter((p) => {
    if (!isAvailableInPeriod(p, period)) return false;
    const office = isAssignedOfficePerson(p, skills, catalog, productGroup);
    return group === "office" ? office : !office;
  });
}

function fieldBackupPool(
  roster: Person[],
  skills: SkillMatrix,
  catalog: PositionCatalog,
  group: ProductGroup,
  period: PeriodId
): Person[] {
  return roster.filter(
    (p) =>
      isAvailableInPeriod(p, period) &&
      isFieldBackup(p) &&
      isAssignedOfficePerson(p, skills, catalog, group)
  );
}

function applyFixedDoughTargets(
  targets: Record<PeriodId, StaffingTarget>,
  catalog: PositionCatalog,
  group: ProductGroup,
  minStaff: number,
  doughCoreCount: number
) {
  const doughPos = positionsForProcess(catalog, group, "dough")[0];
  if (!doughPos) return;
  const max = Math.max(minStaff, doughCoreCount);
  for (const period of PERIODS) {
    const existing = targets[period.id].positions.find((p) => p.process === "dough" && p.positionId === doughPos.id);
    if (existing) {
      existing.min = minStaff;
      existing.max = max;
    } else {
      targets[period.id].positions.push({
        positionId: doughPos.id,
        process: "dough",
        label: doughPos.label,
        min: minStaff,
        max,
      });
    }
  }
}

function forceDoughPeople(
  people: Person[],
  doughPos: PositionDef | undefined,
  cap: number,
  skills: SkillMatrix,
  group: ProductGroup,
  warnings: RotationWarning[]
): { taken: Set<string>; forced: Assignment[] } {
  const taken = new Set<string>();
  const forced: Assignment[] = [];
  if (!doughPos || cap <= 0) return { taken, forced };
  for (const person of people.slice(0, cap)) {
    const pr = getPriority(skills, person.id, group, doughPos.id);
    if (pr === 0) {
      warnings.push({ kind: "unfilled", message: `${person.name}은(는) 반죽 포지션이 불가입니다.` });
      continue;
    }
    taken.add(person.id);
    forced.push({ personId: person.id, station: "dough", positionId: doughPos.id, priority: pr });
  }
  return { taken, forced };
}

function appendOfficeAndOff(
  rows: Assignment[],
  roster: Person[],
  period: PeriodId,
  catalog: PositionCatalog,
  group: ProductGroup,
  skills: SkillMatrix
): Assignment[] {
  const already = new Set(rows.map((r) => r.personId));
  return [
    ...rows,
    ...officeRows(onDuty(roster, period, "office", skills, catalog, group), catalog, group, skills, already),
    ...offRows(roster, period).filter((r) => !already.has(r.personId)),
  ];
}

export function generateRotation(input: GenerateInput): GenerateResult {
  const { line, modes, catalog, skills } = input;
  const group = productGroup(line);
  const visible = visibleRotationRoster(input.roster, input.workDate);
  const roster = visible.filter((p) => hasAssignableSkill(skills, p.id, catalog, group));
  const impact = computeImpact(line, modes);
  const warnings: RotationWarning[] = [];
  const present = roster.filter((p) => p.present);
  const floor = present.filter((p) => !isAssignedOfficePerson(p, skills, catalog, group));
  const startFloor = onDuty(roster, "start", "floor", skills, catalog, group);
  const lunch1Floor = onDuty(roster, "lunch1", "floor", skills, catalog, group);
  const lunch2Floor = onDuty(roster, "lunch2", "floor", skills, catalog, group);
  const afterFloor = onDuty(roster, "after", "floor", skills, catalog, group);
  const doughCore = startFloor.filter((p) => isDoughCorePerson(p));
  const doughSettings = normalizeDoughSettings(input.doughSettings, catalog, group);
  const doughPolicy = doughSettings.rotationPolicy;
  const doughMin = doughSettings.minStaff;
  const doughCanRotate = doughPolicy === "FIXED_DOUGH" ? false : impact.doughCanRotate && doughCore.length > 0;
  const targets = periodTargets(catalog, group, doughCore.length, doughCanRotate);
  if (doughPolicy === "FIXED_DOUGH") {
    applyFixedDoughTargets(targets, catalog, group, doughMin, doughCore.length);
  }
  const assignOpts: AssignOptions = {
    doughPolicy,
    doughCoreIds: new Set(doughCore.map((p) => p.id)),
  };
  const heatN = heatingTarget(catalog, group);
  const empty: PeriodAssignments = { start: [], lunch1: [], lunch2: [], after: [] };

  if (heatN === 0) {
    warnings.push({ kind: "unfilled", message: "이 제품군에 가열 포지션이 없습니다. 포지션을 추가하세요." });
    return finish(empty, visible, targets, warnings, impact, modes, catalog, group, skills, true);
  }
  if (startFloor.length === 0) {
    warnings.push({ kind: "unfilled", message: "출근 인원이 없습니다." });
    return finish(empty, visible, targets, warnings, impact, modes, catalog, group, skills, true);
  }
  if (doughCore.length < doughMin) {
    warnings.push({
      kind: "other",
      message: `반죽고정 필요 ${doughMin}명 / 출근 ${doughCore.length}명`,
    });
  }

  const doughPos = positionsForProcess(catalog, group, "dough")[0];
  const startSlots = buildSlots(catalog, group, "start", targets.start);
  const startPrev = new Map<string, Assignment>();
  const startDoughCap = targets.start.positions.find((p) => p.process === "dough")?.max ?? 0;
  const startForced = forceDoughPeople(doughCore, doughPos, startDoughCap, skills, group, warnings);
  const startPool = startFloor.filter((p) => !startForced.taken.has(p.id));
  const startRemainSlots = startSlots.filter((s) => s.position.process !== "dough");
  const startOut = assignSlots(startPool, startRemainSlots, skills, group, startPrev, catalog, {
    ...assignOpts,
    backups: fieldBackupPool(roster, skills, catalog, group, "start"),
  });
  warnings.push(...startOut.warnings);
  let start = placeLeftovers(
    [...startForced.forced, ...startOut.assignments],
    roster,
    skills,
    catalog,
    group,
    startPrev,
    "start",
    assignOpts
  );
  start = appendOfficeAndOff(start, roster, "start", catalog, group, skills);
  warnings.push(...unfilledWarnings(startOut.unfilled, "시작"));

  if (!modes.lunch) {
    const copy = (rows: Assignment[]) => rows.map((r) => ({ ...r }));
    const assignments: PeriodAssignments = { start, lunch1: copy(start), lunch2: copy(start), after: copy(start) };
    return finish(assignments, visible, targets, warnings, impact, modes, catalog, group, skills, startOut.unfilled.length > 0);
  }

  const lunchSlots = buildSlots(catalog, group, "lunch1", targets.lunch1);
  const allDayFloor = floor.filter((p) => isAvailableInPeriod(p, "start") && isAvailableInPeriod(p, "after"));
  const halfAm = floor.filter((p) => p.leaveKind === "half_am" || p.leaveKind === "half");
  const halfPm = floor.filter((p) => p.leaveKind === "half_pm");
  const eaters = doughCanRotate ? allDayFloor : allDayFloor.filter((p) => !isDoughCorePerson(p));
  const part = partitionLunch(eaters, lunchSlots, skills, group, doughCore, doughCanRotate, catalog, toPrevWorkMap(start));
  warnings.push(...part.warnings);
  const doughHeld =
    doughPolicy === "FIXED_DOUGH"
      ? []
      : doughCanRotate
        ? []
        : doughCore.filter((p) => eaters.every((e) => e.id !== p.id) && lunch1Floor.some((x) => x.id === p.id));
  const lunchDoughForce =
    doughPolicy === "FIXED_DOUGH"
      ? forceDoughPeople(
          doughCore.filter((p) => lunch1Floor.some((x) => x.id === p.id)),
          doughPos,
          targets.lunch1.positions.find((p) => p.process === "dough")?.max ?? 0,
          skills,
          group,
          warnings
        )
      : { taken: new Set<string>(), forced: [] as Assignment[] };
  const lunch1Work = [
    ...part.waveB.filter((p) => lunch1Floor.some((x) => x.id === p.id) && !lunchDoughForce.taken.has(p.id)),
    ...doughHeld,
  ];
  const lunch2Work = [
    ...part.waveA.filter((p) => lunch2Floor.some((x) => x.id === p.id) && !lunchDoughForce.taken.has(p.id)),
    ...doughHeld.filter((p) => lunch2Floor.some((x) => x.id === p.id)),
    ...halfPm.filter((p) => !lunchDoughForce.taken.has(p.id)),
  ];
  const lunch1Eat = [...part.waveA.filter((p) => lunch1Floor.some((x) => x.id === p.id)), ...halfAm];
  const lunch2Eat = part.waveB.filter((p) => lunch2Floor.some((x) => x.id === p.id));

  const lunchRemain = doughPolicy === "FIXED_DOUGH" ? lunchSlots.filter((s) => s.position.process !== "dough") : lunchSlots;
  const lunch1Out = assignSlots(lunch1Work, lunchRemain, skills, group, toPrevWorkMap(start), catalog, {
    ...assignOpts,
    backups: fieldBackupPool(roster, skills, catalog, group, "lunch1"),
  });
  warnings.push(...lunch1Out.warnings, ...unfilledWarnings(lunch1Out.unfilled, "1차 교대"));
  const lunch1Placed = [
    ...placeLeftovers(
      [...lunchDoughForce.forced, ...lunch1Out.assignments],
      roster,
      skills,
      catalog,
      group,
      toPrevWorkMap(start),
      "lunch1",
      assignOpts
    ),
    ...lunch1Eat.map((p) => ({ personId: p.id, station: "lunch" as const })),
  ];
  const lunch1 = appendOfficeAndOff(lunch1Placed, roster, "lunch1", catalog, group, skills);

  const lunch2Slots = buildSlots(catalog, group, "lunch2", targets.lunch2);
  const lunch2Remain = doughPolicy === "FIXED_DOUGH" ? lunch2Slots.filter((s) => s.position.process !== "dough") : lunch2Slots;
  const lunch2DoughForce =
    doughPolicy === "FIXED_DOUGH"
      ? forceDoughPeople(
          doughCore.filter((p) => lunch2Floor.some((x) => x.id === p.id)),
          doughPos,
          targets.lunch2.positions.find((p) => p.process === "dough")?.max ?? 0,
          skills,
          group,
          warnings
        )
      : lunchDoughForce;
  const lunch2Out = assignSlots(lunch2Work, lunch2Remain, skills, group, toPrevWorkMap(start, lunch1Placed), catalog, {
    ...assignOpts,
    backups: fieldBackupPool(roster, skills, catalog, group, "lunch2"),
  });
  warnings.push(...lunch2Out.warnings, ...unfilledWarnings(lunch2Out.unfilled, "2차 교대"));
  const lunch2Placed = [
    ...placeLeftovers(
      [...(doughPolicy === "FIXED_DOUGH" ? lunch2DoughForce.forced : []), ...lunch2Out.assignments],
      roster,
      skills,
      catalog,
      group,
      toPrevWorkMap(start, lunch1Placed),
      "lunch2",
      assignOpts
    ),
    ...lunch2Eat.map((p) => ({ personId: p.id, station: "lunch" as const })),
  ];
  const lunch2 = appendOfficeAndOff(lunch2Placed, roster, "lunch2", catalog, group, skills);

  const afterSlots = buildSlots(catalog, group, "after", targets.after);
  const afterDoughForce =
    doughPolicy === "FIXED_DOUGH"
      ? forceDoughPeople(
          doughCore.filter((p) => afterFloor.some((x) => x.id === p.id)),
          doughPos,
          targets.after.positions.find((p) => p.process === "dough")?.max ?? 0,
          skills,
          group,
          warnings
        )
      : { taken: new Set<string>(), forced: [] as Assignment[] };
  const afterPool = afterFloor.filter((p) => !afterDoughForce.taken.has(p.id));
  const afterRemain = doughPolicy === "FIXED_DOUGH" ? afterSlots.filter((s) => s.position.process !== "dough") : afterSlots;
  const afterOut = assignSlots(afterPool, afterRemain, skills, group, toPrevWorkMap(start, lunch1Placed, lunch2Placed), catalog, {
    ...assignOpts,
    backups: fieldBackupPool(roster, skills, catalog, group, "after"),
  });
  warnings.push(...afterOut.warnings, ...unfilledWarnings(afterOut.unfilled, "13시 이후"));
  const afterPlaced = placeLeftovers(
    [...afterDoughForce.forced, ...afterOut.assignments],
    roster,
    skills,
    catalog,
    group,
    toPrevWorkMap(start, lunch1Placed, lunch2Placed),
    "after",
    assignOpts
  );
  const after = appendOfficeAndOff(afterPlaced, roster, "after", catalog, group, skills);

  const failed =
    startOut.unfilled.length + lunch1Out.unfilled.length + lunch2Out.unfilled.length + afterOut.unfilled.length > 0;
  const assignments: PeriodAssignments = { start, lunch1, lunch2, after };
  return finish(assignments, visible, targets, warnings, impact, modes, catalog, group, skills, failed);
}

function unfilledWarnings(slots: Slot[], periodLabel: string): RotationWarning[] {
  return slots.map((s) => ({
    kind: "unfilled" as const,
    message: `${periodLabel} ${s.position.label} 자리가 비었습니다. 인원이 있어도 이 포지션 가능자가 없으면 실패입니다.`,
  }));
}

function finish(
  assignments: PeriodAssignments,
  roster: Person[],
  targets: Record<PeriodId, StaffingTarget>,
  warnings: RotationWarning[],
  impact: ProductionImpact,
  modes: RotationModes,
  catalog: PositionCatalog,
  group: ProductGroup,
  skills: SkillMatrix,
  failed: boolean
): GenerateResult {
  const withOff: PeriodAssignments = {
    start: assignments.start,
    lunch1: assignments.lunch1,
    lunch2: assignments.lunch2,
    after: assignments.after,
  };
  for (const period of PERIODS) {
    const rows = [...withOff[period.id]];
    const assigned = new Set(rows.map((row) => row.personId));
    for (const person of roster) {
      if (assigned.has(person.id)) continue;
      if (isRotationExcluded(person)) continue;
      if (isFullDayLeave(person.leaveKind) || !person.present || !isAvailableInPeriod(person, period.id)) {
        rows.push({ personId: person.id, station: "off" });
        assigned.add(person.id);
        continue;
      }
      if (hasNoSkillConfig(skills, person, catalog, group)) {
        rows.push({ personId: person.id, station: "unassigned", unassignedReason: "NO_SKILL_CONFIG" });
        assigned.add(person.id);
        continue;
      }
      if (!hasAssignableSkill(skills, person.id, catalog, group)) continue;
      rows.push({ personId: person.id, station: "unassigned", unassignedReason: "NO_AVAILABLE_SLOT" });
      assigned.add(person.id);
    }
    withOff[period.id] = rows.map((row) => {
      if (row.station !== "unassigned" || row.unassignedReason) return row;
      const person = roster.find((p) => p.id === row.personId);
      if (!person) return row;
      return {
        ...row,
        unassignedReason: hasNoSkillConfig(skills, person, catalog, group) ? "NO_SKILL_CONFIG" : "NO_AVAILABLE_SLOT",
      };
    });
  }
  const byId = new Map(roster.map((p) => [p.id, p]));
  const checks = buildChecks(withOff, targets, roster, modes, catalog, group, skills);
  warnings.push(...qualificationGapWarnings(withOff, targets, roster, group));
  if (modes.splitShift) {
    const lateCapable = roster.filter((p) => p.present && p.shift === "0900-1900" && hasAnyHeating(p.id, catalog, group, skills));
    const need = heatingTarget(catalog, group);
    if (lateCapable.length < need) {
      warnings.push({
        kind: "other",
        message: `출퇴근 분리로 가열을 1시간 연장하려면 가열 포지션 가능 9시 출근이 ${need}명 필요합니다. 현재 ${lateCapable.length}명.`,
      });
    }
  }
  for (const period of PERIODS) {
    const dups = findDuplicateIds(withOff[period.id]).map((id) => byId.get(id)?.name ?? id);
    if (dups.length > 0) {
      warnings.push({ kind: "unfilled", message: `${period.short} 중복 배정: ${dups.join(", ")}` });
    }
  }
  const floorMoves = findFloorMoves(withOff, byId);
  if (floorMoves.length > 0) {
    warnings.push({
      kind: "other",
      message: `1층↔2층 이동 ${floorMoves.length}건 (${floorMoves.slice(0, 4).join(", ")}${floorMoves.length > 4 ? " 외" : ""}). 외포장만 1층입니다.`,
    });
  }
  const deduped = dedupeWarnings(warnings);
  return {
    assignments: withOff,
    targets,
    checks,
    warnings: deduped,
    impact,
    failed: failed || checks.some((c) => !c.ok && (c.id.startsWith("pos:") || c.id.startsWith("qual:"))),
  };
}

function qualificationGapWarnings(
  assignments: PeriodAssignments,
  targets: Record<PeriodId, StaffingTarget>,
  roster: Person[],
  group: ProductGroup
): RotationWarning[] {
  const byId = new Map(roster.map((p) => [p.id, p]));
  const out: RotationWarning[] = [];
  for (const period of PERIODS) {
    const rows = assignments[period.id];
    for (const need of targets[period.id].positions) {
      const keys = requiredQualificationsForProcess(need.process, group);
      if (need.min <= 0 || keys.length === 0) continue;
      const workers = rows
        .filter((r) => r.positionId === need.positionId || (r.station === need.process && !r.positionId))
        .map((r) => byId.get(r.personId))
        .filter((p): p is Person => Boolean(p));
      if (workers.some((p) => personMeetsProcessQualifications(p, need.process, group))) continue;
      const labels = keys.map((k) => qualificationLabel(k)).join(", ");
      out.push({
        kind: "unfilled",
        message: `${period.short} ${need.label} 인원은 ${workers.length}명이지만 ${labels} 가능자가 없습니다.`,
      });
    }
  }
  return out;
}

function hasAnyHeating(personId: string, catalog: PositionCatalog, group: ProductGroup, skills: SkillMatrix): boolean {
  return heatingPositions(catalog, group).some((p) => getPriority(skills, personId, group, p.id) > 0);
}

function findDuplicateIds(rows: Assignment[]): string[] {
  const n = new Map<string, number>();
  for (const row of rows) n.set(row.personId, (n.get(row.personId) ?? 0) + 1);
  return Array.from(n.entries()).filter(([, c]) => c > 1).map(([id]) => id);
}

function findFloorMoves(assignments: PeriodAssignments, byId: Map<string, Person>): string[] {
  const out: string[] = [];
  const work = new Map<string, Assignment[]>();
  for (const period of PERIODS) {
    for (const row of assignments[period.id]) {
      if (row.station === "lunch" || row.station === "off" || row.station === "unassigned") continue;
      const list = work.get(row.personId) ?? [];
      list.push(row);
      work.set(row.personId, list);
    }
  }
  for (const [personId, rows] of Array.from(work.entries())) {
    for (let i = 1; i < rows.length; i++) {
      if (!floorsDiffer(rows[i - 1].station, rows[i].station)) continue;
      const name = byId.get(personId)?.name ?? personId;
      out.push(`${name} ${processLabel(rows[i - 1].station)}→${processLabel(rows[i].station)}`);
    }
  }
  return out;
}

function dedupeWarnings(warnings: RotationWarning[]): RotationWarning[] {
  const seen = new Set<string>();
  const out: RotationWarning[] = [];
  for (const w of warnings) {
    const k = `${w.kind}:${w.message}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
  }
  return out;
}

export function buildChecks(
  assignments: PeriodAssignments,
  targets: Record<PeriodId, StaffingTarget>,
  roster: Person[],
  modes: RotationModes,
  catalog: PositionCatalog,
  group: ProductGroup,
  skills: SkillMatrix
): ConstraintCheck[] {
  const checks: ConstraintCheck[] = [];
  const byId = new Map(roster.map((p) => [p.id, p]));
  for (const period of PERIODS) {
    const rows = assignments[period.id];
    const t = targets[period.id];
    const heatFilled = heatingPositions(catalog, group).filter((pos) =>
      rows.some((r) => r.positionId === pos.id && r.station === "heating")
    ).length;
    checks.push({
      id: `pos:${period.id}:heating`,
      label: `${period.short} 가열 포지션`,
      ok: heatFilled === t.heating && t.heating > 0,
      actual: `${heatFilled}/${t.heating}자리`,
      expected: `필수 ${t.heating}자리 전부`,
    });
    for (const need of t.positions) {
      if (need.min <= 0 && need.max <= 0) continue;
      const n = rows.filter((r) => r.positionId === need.positionId || (r.station === need.process && !r.positionId)).length;
      const rangeLabel = need.min === need.max ? `${need.min}명` : `${need.min}~${need.max}명`;
      checks.push({
        id: `count:${period.id}:${need.positionId}`,
        label: `${period.short} ${need.label}`,
        ok: n >= need.min && n <= need.max,
        actual: `${n}명`,
        expected: rangeLabel,
      });
      const qualKeys = requiredQualificationsForProcess(need.process, group);
      if (need.min > 0 && qualKeys.length > 0) {
        const workers = rows
          .filter((r) => r.positionId === need.positionId || (r.station === need.process && !r.positionId))
          .map((r) => byId.get(r.personId))
          .filter((p): p is Person => Boolean(p));
        const ok = workers.some((p) => personMeetsProcessQualifications(p, need.process, group));
        checks.push({
          id: `qual:${period.id}:${need.positionId}:${qualKeys.join(",")}`,
          label: `${period.short} ${need.label} 필수자격`,
          ok,
          actual: ok ? "충족" : "없음",
          expected: `${qualKeys.map((k) => qualificationLabel(k)).join(", ")} 최소 1명`,
        });
      }
    }
  }

  if (modes.lunch) {
    const ate = new Map<string, number>();
    for (const period of ["lunch1", "lunch2"] as PeriodId[]) {
      for (const row of assignments[period]) {
        if (row.station === "lunch") ate.set(row.personId, (ate.get(row.personId) ?? 0) + 1);
      }
    }
    const blocked = doughRotationBlocked(modes);
    const floor = roster.filter((p) => p.present && !isAssignedOfficePerson(p, skills, catalog, group));
    const onDoughBothLunch = (p: Person) => {
      const a1 = assignments.lunch1.find((r) => r.personId === p.id);
      const a2 = assignments.lunch2.find((r) => r.personId === p.id);
      return a1?.station === "dough" && a2?.station === "dough";
    };
    const mustEat = (blocked ? floor.filter((p) => !isDoughCorePerson(p)) : floor)
      .filter((p) => !hasNoSkillConfig(skills, p, catalog, group))
      .filter(
      (p) =>
        !onDoughBothLunch(p) &&
        (isAvailableInPeriod(p, "lunch1") || isAvailableInPeriod(p, "lunch2"))
    );
    const missing = mustEat.filter((p) => (ate.get(p.id) ?? 0) === 0);
    const double = floor.filter((p) => (ate.get(p.id) ?? 0) > 1);
    checks.push({
      id: "lunch:once",
      label: "현장 식사 1회",
      ok: missing.length === 0 && double.length === 0,
      actual:
        missing.length === 0 && double.length === 0
          ? "전원 1회"
          : `미식사 ${missing.map((p) => p.name).join(", ") || "없음"} / 중복 ${double.map((p) => p.name).join(", ") || "없음"}`,
      expected: "1회",
    });
  }

  const skillFail: string[] = [];
  for (const period of PERIODS) {
    for (const row of assignments[period.id]) {
      const person = byId.get(row.personId);
      if (!person) continue;
      if (!canAssign(skills, person.id, group, row.positionId, row.station)) {
        if (row.station !== "unassigned" && !hasNoSkillConfig(skills, person, catalog, group)) {
          skillFail.push(`${person.name}→${row.positionId ?? row.station}`);
        }
      }
    }
  }
  checks.push({
    id: "skills",
    label: "불가 인력 배치",
    ok: skillFail.length === 0,
    actual: skillFail.length === 0 ? "없음" : skillFail.slice(0, 8).join(", "),
    expected: "0건",
  });
  return checks;
}

export function movePerson(
  assignments: PeriodAssignments,
  period: PeriodId,
  personId: string,
  station: StationId,
  positionId: string | undefined,
  skills: SkillMatrix,
  group: ProductGroup,
  roster: Person[]
): { assignments: PeriodAssignments; error?: string; warning?: string } {
  const person = roster.find((p) => p.id === personId);
  if (!person) return { assignments, error: "해당 시간대에 없는 사람입니다." };
  if (isRotationExcluded(person)) {
    return { assignments, error: `${person.name}은(는) 로테이션 제외 대상입니다.` };
  }
  const workStation = station !== "lunch" && station !== "off" && station !== "unassigned";
  if (workStation && (!person.present || isFullDayLeave(person.leaveKind))) {
    return { assignments, error: `${person.name}은(는) 휴무·미출근이라 작업 자리에 넣을 수 없습니다.` };
  }
  if (workStation && !isAvailableInPeriod(person, period)) {
    return { assignments, error: `${person.name}은(는) 이 시간대에 근무할 수 없습니다.` };
  }
  const noSkillConfig = hasNoSkillConfig(skills, person, undefined, group);
  if (!noSkillConfig && !canAssign(skills, personId, group, positionId, station)) {
    return { assignments, error: `${person.name}은(는) 해당 포지션에 배치 불가입니다.` };
  }
  const rows = [...assignments[period]];
  const fromIdx = rows.findIndex((r) => r.personId === personId);
  if (fromIdx < 0) return { assignments, error: "해당 시간대에 없는 사람입니다." };
  const mover = rows[fromIdx];
  const uniqueSeat = station === "heating" || station === "rnd";
  const occupantIdx =
    uniqueSeat && positionId
      ? rows.findIndex((r) => r.personId !== personId && r.positionId === positionId && r.station === station)
      : -1;

  const priority = positionId ? getPriority(skills, personId, group, positionId) : undefined;
  rows[fromIdx] = {
    personId,
    station,
    positionId,
    priority: priority || undefined,
    unassignedReason:
      station === "unassigned" ? (noSkillConfig ? "NO_SKILL_CONFIG" : "NO_AVAILABLE_SLOT") : undefined,
  };

  if (occupantIdx >= 0) {
    const other = rows[occupantIdx];
    const otherCan = canAssign(skills, other.personId, group, mover.positionId, mover.station);
    if (otherCan) {
      const op = mover.positionId ? getPriority(skills, other.personId, group, mover.positionId) : undefined;
      rows[occupantIdx] = {
        personId: other.personId,
        station: mover.station,
        positionId: mover.positionId,
        priority: op || undefined,
        unassignedReason: mover.station === "unassigned" ? mover.unassignedReason : undefined,
      };
    } else {
      const otherPerson = roster.find((p) => p.id === other.personId);
      rows[occupantIdx] = {
        personId: other.personId,
        station: "unassigned",
        unassignedReason:
          otherPerson && hasNoSkillConfig(skills, otherPerson, undefined, group)
            ? "NO_SKILL_CONFIG"
            : "NO_AVAILABLE_SLOT",
      };
    }
  }
  return {
    assignments: { ...assignments, [period]: rows },
    warning: noSkillConfig && workStation
      ? "이 직원은 현재 제품군의 숙련도가 설정되지 않았습니다. 관리자 판단으로 수동 배치합니다."
      : undefined,
  };
}

export function peopleOn(
  rows: Assignment[],
  roster: Person[],
  match: { station?: StationId; positionId?: string }
): { person: Person; assignment: Assignment }[] {
  return rows
    .filter((r) => (match.station ? r.station === match.station : true) && (match.positionId ? r.positionId === match.positionId : true))
    .map((r) => {
      const person = roster.find((p) => p.id === r.personId);
      return person ? { person, assignment: r } : null;
    })
    .filter((x): x is { person: Person; assignment: Assignment } => x !== null);
}

export { PROCESSES };
