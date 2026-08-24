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

/** 0 불가 · 1 상 · 2 중상 · 3 중 · 4 하 · 5 비상(숙련 가능자 없을 때만). 같은 숙련은 여러 명 가능 */
export type Priority = 0 | 1 | 2 | 3 | 4 | 5;

export const EMERGENCY_PRIORITY: Priority = 5;

export const PRIORITY_OPTIONS: { value: Priority; label: string; short: string }[] = [
  { value: 0, label: "불가", short: "불가" },
  { value: 1, label: "상", short: "상" },
  { value: 2, label: "중상", short: "중상" },
  { value: 3, label: "중", short: "중" },
  { value: 4, label: "하", short: "하" },
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

export type RotationQualificationKey = "threeSidePacker";

export type RotationQualifications = Partial<Record<RotationQualificationKey, boolean>> & {
  [key: string]: boolean | undefined;
};

export type DoughRotationPolicy = "CURRENT_LUNCH_BACKUP" | "FIXED_DOUGH";

export type DoughSettings = {
  minStaff?: number;
  rotationPolicy?: DoughRotationPolicy;
};

export type RotationOps = {
  dough?: DoughSettings;
};

export type PersonConstraints = {
  /** 숙련이 있어도 주공정 외 자리에는 안 넣음 */
  lockPreferred?: boolean;
  /** 시작 층에서 다른 층으로 안 내려감. 필수자리 폴백도 안 함 */
  stayFloor?: boolean;
  /** 반죽 고정조. false면 이름 기본값도 해제 */
  doughCore?: boolean;
  /** 당일 배치표에서 뺌. 숙련표에는 그대로 둠 */
  excluded?: boolean;
  /** 사무 기본이지만 필수자격 자리가 비면 현장에 투입 */
  fieldBackup?: boolean;
  /** 기계·공정 자격. 이름 하드코딩 대신 이 값만 본다 */
  qualifications?: RotationQualifications;
  /** 해당 제품군 숙련을 한 번이라도 저장함. 1~5 행이 없어도 명시적 불가와 미설정을 가른다 */
  skillConfiguredGroups?: ProductGroup[];
};

export type Person = {
  id: string;
  name: string;
  /** 주공정. 자동배치는 포지션 숙련도를 본다 */

  preferred: ProcessId;
  shift: ShiftId;
  group: "floor" | "office";
  present: boolean;
  /** 생산계획 연월차·반차·기타. 날짜별로만 채움 */
  leaveKind?: "none" | "annual" | "other" | "half" | "half_am" | "half_pm";
  /** 프로필 입사일. 당일보다 뒤면 배치표에서 제외 */
  hireDate?: string | null;
  constraints?: PersonConstraints;
};

export type PeriodStaffRange = {
  min: number;
  max: number;
};

/** 시간대별 최소·최대 인원. 가열·R&D는 두지 않음. */
export type PositionStaffing = Record<PeriodId, PeriodStaffRange>;

export type PositionDef = {
  id: string;
  label: string;
  process: ProcessId;
  staffing?: PositionStaffing;
};

export type PositionCatalog = Record<ProductGroup, PositionDef[]>;

/** 작업자 × 제품군 × 세부포지션 → 숙련도 */
export type SkillMatrix = Record<string, Partial<Record<ProductGroup, Record<string, Priority>>>>;

export type UnassignedReason = "NO_SKILL_CONFIG" | "NO_AVAILABLE_SLOT";

export type Assignment = {
  personId: string;
  station: StationId;
  positionId?: string;
  priority?: Priority;
  unassignedReason?: UnassignedReason;
};

export type PeriodAssignments = Record<PeriodId, Assignment[]>;

export type PositionStaffNeed = {
  positionId: string;
  process: ProcessId;
  label: string;
  min: number;
  max: number;
};

export type StaffingTarget = {
  heating: number;
  positions: PositionStaffNeed[];
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
  workDate?: string;
  doughSettings?: DoughSettings;
};

export type GenerateResult = {
  assignments: PeriodAssignments;
  targets: Record<PeriodId, StaffingTarget>;
  checks: ConstraintCheck[];
  warnings: RotationWarning[];
  impact: ProductionImpact;
  failed: boolean;
};
