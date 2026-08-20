export const PERIODS = [
  { id: "start", label: "08:00–11:00", short: "시작" },
  { id: "lunch1", label: "11:00–12:00", short: "1차 교대" },
  { id: "lunch2", label: "12:00–13:00", short: "2차 교대" },
  { id: "after", label: "13:00 이후", short: "오후" },
] as const;

export type PeriodId = (typeof PERIODS)[number]["id"];

export const PROCESSES = [
  { id: "heating", label: "가열" },
  { id: "inner", label: "내포장" },
  { id: "outer", label: "외포장" },
  { id: "topping", label: "토핑" },
  { id: "dough", label: "반죽" },
  { id: "cleanup", label: "반죽 마감" },
  { id: "rnd", label: "R&D" },
  { id: "office", label: "사무" },
] as const;

export type ProcessId = (typeof PROCESSES)[number]["id"];

export const STATIONS = [
  ...PROCESSES,
  { id: "lunch", label: "식사" },
  { id: "off", label: "휴무" },
  { id: "unassigned", label: "미배치" },
] as const;

export type StationId = (typeof STATIONS)[number]["id"];

/** 0 불가 · 1~4 후보 순번 · 5 비상(정상 후보가 없을 때만) */
export type Priority = 0 | 1 | 2 | 3 | 4 | 5;

export const EMERGENCY_PRIORITY: Priority = 5;

export const PRIORITY_OPTIONS: { value: Priority; label: string; short: string }[] = [
  { value: 0, label: "불가", short: "불가" },
  { value: 1, label: "1순위", short: "1" },
  { value: 2, label: "2순위", short: "2" },
  { value: 3, label: "3순위", short: "3" },
  { value: 4, label: "4순위", short: "4" },
  { value: 5, label: "비상", short: "비상" },
];

export type ShiftId = "0800-1800" | "0900-1900";

export type ProductLine =
  | "phono_signature"
  | "phono_basil"
  | "phono_corn"
  | "phono_ricotta"
  | "parbake";

export type ProductGroup = "phono_signature" | "phono_basil_corn" | "phono_ricotta" | "parbake";

export type Person = {
  id: string;
  name: string;
  /** 주공정. 자동배치 참고값일 뿐, 스킬 본문은 포지션 우선순위 */
  preferred: ProcessId;
  shift: ShiftId;
  group: "floor" | "office";
  present: boolean;
  /** 생산계획 연월차·반차·기타. 날짜별로만 채움 */
  leaveKind?: "none" | "annual" | "other" | "half" | "half_am" | "half_pm";
};

export type PositionDef = {
  id: string;
  label: string;
  process: ProcessId;
};

export type PositionCatalog = Record<ProductGroup, PositionDef[]>;

/** 작업자 × 제품군 × 세부포지션 → 우선순위 */
export type SkillMatrix = Record<string, Partial<Record<ProductGroup, Record<string, Priority>>>>;

export type Assignment = {
  personId: string;
  station: StationId;
  positionId?: string;
  priority?: Priority;
};

export type PeriodAssignments = Record<PeriodId, Assignment[]>;

export type StaffingTarget = {
  heating: number;
  inner: number;
  outer: number;
  dough: number;
};

export type RotationModes = {
  lunch: boolean;
  breakRotation: boolean;
  splitShift: boolean;
};

export type ConstraintCheck = {
  id: string;
  label: string;
  ok: boolean;
  actual: string;
  expected: string;
};

export type RotationWarning = {
  kind: "emergency" | "rank4" | "rank3" | "preferredLeave" | "unfilled" | "lunchCoverage" | "other";
  message: string;
};

export type ProductionImpact = {
  hourlyQty: number;
  extraHours: number;
  extraQty: number;
  lunchHours: number;
  breakHours: number;
  shiftHours: number;
  doughCanRotate: boolean;
  doughNote: string;
};

export type GenerateInput = {
  roster: Person[];
  line: ProductLine;
  modes: RotationModes;
  catalog: PositionCatalog;
  skills: SkillMatrix;
};

export type GenerateResult = {
  assignments: PeriodAssignments;
  targets: Record<PeriodId, StaffingTarget>;
  checks: ConstraintCheck[];
  warnings: RotationWarning[];
  impact: ProductionImpact;
  failed: boolean;
};
