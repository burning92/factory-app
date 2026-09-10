/**
 * 09~19조에 결원이 나 18~19 필수자리를 못 채울 때, 하루만 09~19로 바꿔 쓸 후보를 고른다.
 * 근무시간이 실제로 바뀌는 일이라 여기서는 추천만 하고 확정은 관리자가 한다.
 */
import { anchorRankLabel, getPriority, meetsAnchorRank } from "./catalog";
import { isFullDayLeave } from "./planningLeave";
import { canTakeProcess, isNightShiftBackup, isRotationExcluded, preferredProcess } from "./personRules";
import { hasQualification, qualificationLabel, requiredQualificationsForProcess } from "./qualifications";
import { hasShiftOverride, personWorksDuringPeriod } from "./workHours";
import type {
  PeriodAssignments,
  PeriodId,
  Person,
  PositionCatalog,
  ProcessId,
  ProductGroup,
  ShiftGap,
  ShiftSubstitutePlan,
  SkillMatrix,
  StaffingTarget,
  SubstituteCandidate,
} from "./types";

/** 대체근무가 필요한지 보는 구간. 09~19조만 남는 시간대다 */
const TARGET_PERIOD: PeriodId = "closing";

function rowsAt(assignments: PeriodAssignments, positionId: string, process: string) {
  return assignments[TARGET_PERIOD].filter((row) =>
    row.positionId ? row.positionId === positionId : row.station === process
  );
}

/** 실제 배치 결과에서 18~19 필수정원·필수자격이 모자란 자리를 뽑는다 */
export function closingGaps(
  assignments: PeriodAssignments,
  targets: Record<PeriodId, StaffingTarget>,
  roster: Person[],
  group: ProductGroup
): ShiftGap[] {
  const byId = new Map(roster.map((p) => [p.id, p]));
  const gaps: ShiftGap[] = [];
  for (const need of targets[TARGET_PERIOD].positions) {
    if (need.min <= 0) continue;
    const rows = rowsAt(assignments, need.positionId, need.process);
    const holders = rows.map((row) => row.personId);
    // 가열 마감은 '상' 한 명이 상주해야 한다. 그 사람이 있으면 나머지는 낮은 숙련이 백업으로 들어와도 된다
    const needsAnchor =
      needsTopRankAnchor(need.process) && !rows.some((row) => meetsAnchorRank(need.process, row.priority ?? 0));
    const missing = need.min - holders.length;
    if (missing > 0) {
      gaps.push({
        positionId: need.positionId,
        process: need.process,
        label: need.label,
        missing,
        ...(needsAnchor ? { anchorRank: anchorRankLabel(need.process) } : {}),
      });
      continue;
    }
    if (needsAnchor) {
      gaps.push({
        positionId: need.positionId,
        process: need.process,
        label: need.label,
        missing: 1,
        anchorRank: anchorRankLabel(need.process),
      });
    }
    for (const key of requiredQualificationsForProcess(need.process, group)) {
      const covered = holders.some((id) => {
        const person = byId.get(id);
        return person ? hasQualification(person, key, group) : false;
      });
      if (covered) continue;
      gaps.push({
        positionId: need.positionId,
        process: need.process,
        label: need.label,
        missing: 1,
        qualification: qualificationLabel(key),
      });
    }
  }
  return gaps;
}

/** 가열 마감처럼 '상' 한 명이 반드시 있어야 하는 공정 */
function needsTopRankAnchor(process: ProcessId): boolean {
  return process === "heatingClose";
}

function coversGap(
  person: Person,
  gap: ShiftGap,
  skills: SkillMatrix,
  group: ProductGroup
): boolean {
  const rank = getPriority(skills, person.id, group, gap.positionId);
  if (rank <= 0) return false;
  // 비어 있는 자리가 '상' 자리면 '상' 보유자만 메울 수 있다
  if (gap.anchorRank && !meetsAnchorRank(gap.process, rank)) return false;
  if (!canTakeProcess(person, gap.process, group)) return false;
  return requiredQualificationsForProcess(gap.process, group).every((key) =>
    hasQualification(person, key, group)
  );
}

/** 08~09에 하던 일이 많을수록 근무조를 바꿨을 때 배치가 크게 흔들린다 */
function disruption(person: Person, assignments: PeriodAssignments): number {
  const row = assignments.early.find((a) => a.personId === person.id);
  if (!row) return 0;
  if (row.station === "heating") return 2;
  return row.positionId ? 1 : 0;
}

function bestRank(person: Person, gaps: ShiftGap[], skills: SkillMatrix, group: ProductGroup): number {
  let best = 9;
  for (const gap of gaps) {
    const rank = getPriority(skills, person.id, group, gap.positionId);
    if (rank > 0 && rank < best) best = rank;
  }
  return best;
}

function gapText(gaps: ShiftGap[]): string {
  return gaps
    .map((gap) => {
      if (gap.qualification) return `${gap.label} ${gap.qualification} 보유자 ${gap.missing}명`;
      if (gap.anchorRank) return `${gap.label} ${gap.anchorRank} 숙련자 ${gap.missing}명`;
      return `${gap.label} ${gap.missing}명`;
    })
    .join(", ");
}

export function planNightShiftSubstitutes(input: {
  roster: Person[];
  assignments: PeriodAssignments;
  targets: Record<PeriodId, StaffingTarget>;
  catalog: PositionCatalog;
  group: ProductGroup;
  skills: SkillMatrix;
}): ShiftSubstitutePlan | undefined {
  const { roster, assignments, targets, group, skills } = input;
  const confirmed = roster.filter((p) => hasShiftOverride(p)).map((p) => p.name);
  const gaps = closingGaps(assignments, targets, roster, group);
  if (gaps.length === 0) {
    if (confirmed.length === 0) return undefined;
    return {
      gaps: [],
      candidates: [],
      confirmed,
      message: `09~19 대체근무 확정: ${confirmed.join(", ")}. 이 날짜에만 적용되고 다음날은 기본 근무조로 돌아갑니다.`,
    };
  }

  const pool = roster.filter(
    (person) =>
      isNightShiftBackup(person) &&
      !isRotationExcluded(person) &&
      person.present &&
      !isFullDayLeave(person.leaveKind) &&
      // 이미 18~19에 남는 사람은 대체 대상이 아니다
      !personWorksDuringPeriod(person, TARGET_PERIOD)
  );

  const candidates: SubstituteCandidate[] = pool
    .map((person) => {
      const covered = gaps.filter((gap) => coversGap(person, gap, skills, group));
      return { person, covered };
    })
    .filter((row) => row.covered.length > 0)
    .sort((a, b) => {
      // 부족한 자리를 더 많이 메우는 사람 → 숙련이 높은 사람 → 주공정이 맞는 사람 → 08~09 배치가 덜 흔들리는 사람
      if (a.covered.length !== b.covered.length) return b.covered.length - a.covered.length;
      const rankA = bestRank(a.person, a.covered, skills, group);
      const rankB = bestRank(b.person, b.covered, skills, group);
      if (rankA !== rankB) return rankA - rankB;
      const prefA = a.covered.some((gap) => gap.process === preferredProcess(a.person, group)) ? 0 : 1;
      const prefB = b.covered.some((gap) => gap.process === preferredProcess(b.person, group)) ? 0 : 1;
      if (prefA !== prefB) return prefA - prefB;
      const disA = disruption(a.person, assignments);
      const disB = disruption(b.person, assignments);
      if (disA !== disB) return disA - disB;
      return a.person.name.localeCompare(b.person.name, "ko");
    })
    .map(({ person, covered }) => {
      const rank = bestRank(person, covered, skills, group);
      const qual = covered.find((gap) => gap.qualification)?.qualification;
      const anchor = covered.find((gap) => gap.anchorRank)?.anchorRank;
      const parts = [`숙련 ${rank}순위`];
      if (anchor) parts.push(`${anchor} 숙련`);
      if (qual) parts.push(`${qual} 보유`);
      if (covered.some((gap) => gap.process === preferredProcess(person, group))) parts.push("주공정");
      if (disruption(person, assignments) > 0) parts.push("08~09 자리 비게 됨");
      return {
        personId: person.id,
        name: person.name,
        covers: covered.map((gap) => gap.label),
        reason: parts.join(" · "),
      };
    });

  const head = `09~19조 결원으로 18~19 ${gapText(gaps)}이(가) 부족합니다.`;
  const tail =
    candidates.length > 0
      ? `09~19 대체 가능자: ${candidates.map((c) => c.name).join(", ")}`
      : "09~19 대체근무 가능으로 지정된 사람이 없습니다. 개인조건에서 후보를 먼저 지정하세요.";
  return { gaps, candidates, confirmed, message: `${head} ${tail}` };
}

/** 확정한 사람만 그날 근무조를 바꾼다. 기본 shift는 그대로 둔다 */
export function applyShiftOverrides(
  roster: Person[],
  overrides: Record<string, string> | undefined
): Person[] {
  if (!overrides || Object.keys(overrides).length === 0) {
    return roster.some((p) => p.shiftOverride) ? roster.map((p) => ({ ...p, shiftOverride: null })) : roster;
  }
  return roster.map((person) => {
    const next = overrides[person.id] ?? null;
    if ((person.shiftOverride ?? null) === next) return person;
    return { ...person, shiftOverride: next };
  });
}
