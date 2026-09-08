/**
 * 실제 근무 구간. startMin·endMin은 자정 기준 분.
 * production=false면 정상 생산이 아니라 마감 작업 구간이라 가열 자리를 만들지 않는다.
 * start·lunch1·lunch2·after는 예전 키를 그대로 써서 저장된 정원·배치가 이어진다.
 * 구간 경계는 실제 출퇴근 시각의 합집합이다. 새 퇴근 시각이 생기면 그 시각에서 구간을 나눠야
 * 그 사람이 남은 시간대에 근무하는 것처럼 보이지 않는다.
 */
export const PERIODS = [
  { id: "early", label: "08:00–09:00", short: "08시", startMin: 480, endMin: 540, production: true },
  { id: "start", label: "09:00–11:00", short: "09시 합류", startMin: 540, endMin: 660, production: true },
  { id: "lunch1", label: "11:00–12:00", short: "1차 교대", startMin: 660, endMin: 720, production: true },
  { id: "lunch2", label: "12:00–13:00", short: "2차 교대", startMin: 720, endMin: 780, production: true },
  { id: "after", label: "13:00–15:30", short: "오후", startMin: 780, endMin: 930, production: true },
  { id: "late", label: "15:30–17:00", short: "늦은 오후", startMin: 930, endMin: 1020, production: true },
  { id: "evening", label: "17:00–18:00", short: "17시 이후", startMin: 1020, endMin: 1080, production: true },
  { id: "closing", label: "18:00–19:00", short: "마감", startMin: 1080, endMin: 1140, production: false },
] as const;

export type PeriodId = (typeof PERIODS)[number]["id"];

export const PROCESSES = [
  { id: "heating", label: "가열" },
  { id: "heatingClose", label: "가열 마감" },
  { id: "inner", label: "내포장" },
  { id: "outer", label: "외포장" },
  { id: "topping", label: "토핑" },
  { id: "dough", label: "반죽" },
  { id: "rnd", label: "R&D" },
  { id: "office", label: "사무" },
] as const;

export type ProcessId = (typeof PROCESSES)[number]["id"];

export const STATIONS = [
  ...PROCESSES,
  { id: "lunch", label: "식사" },
  { id: "off", label: "휴무" },
  /** 이 시간대는 근무조 밖이라 출근 전이거나 이미 퇴근 */
  { id: "outside", label: "근무 외" },
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

/** 근무조. "HHMM-HHMM" 문자열이라 06:00–15:30 같은 조는 값만 늘리면 된다 */
export type ShiftId = "0800-1800" | "0900-1900" | (string & {});

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

export type QualificationsByGroup = Partial<Record<ProductGroup, RotationQualifications>>;

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
  /** 09~19조에 결원이 나면 그날 하루 09~19로 바꿔 쓸 수 있는 사람 */
  nightShiftBackup?: boolean;
  /** 제품군별 기계·공정 자격. 포노와 파베이크를 따로 둔다 */
  qualificationsByGroup?: QualificationsByGroup;
  /** 해당 제품군 숙련을 한 번이라도 저장함. 1~5 행이 없어도 명시적 불가와 미설정을 가른다 */
  skillConfiguredGroups?: ProductGroup[];
};

export type Person = {
  id: string;
  name: string;
  /** 주공정. 자동배치는 포지션 숙련도를 본다 */

  preferred: ProcessId;
  /** 프로필 기본 근무조. 대체근무를 확정해도 이 값은 바뀌지 않는다 */
  shift: ShiftId;
  /** 그날 하루만 쓰는 근무조. 다음날은 다시 기본 shift로 돌아간다 */
  shiftOverride?: ShiftId | null;
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

/** 저장본에는 나중에 생긴 구간이 없을 수 있어 부분값을 허용한다 */
export type SavedPositionStaffing = Partial<Record<PeriodId, PeriodStaffRange>>;

export type PositionDef = {
  id: string;
  label: string;
  process: ProcessId;
  staffing?: SavedPositionStaffing;
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

/** 18~19 필수자리를 09~19조만으로 못 채울 때 내는 대체근무 추천 */
export type ShiftGap = {
  positionId: string;
  process: ProcessId;
  label: string;
  missing: number;
  /** 이 자리에 필요한 자격 이름. 자격 때문에 빈 자리면 채운다 */
  qualification?: string;
  /** 이 자리를 이끌 숙련(가열 마감은 '상'). 그 숙련이 비어 있을 때만 채운다 */
  anchorRank?: string;
};

export type SubstituteCandidate = {
  personId: string;
  name: string;
  /** 메울 수 있는 자리 라벨 */
  covers: string[];
  reason: string;
};

export type ShiftSubstitutePlan = {
  gaps: ShiftGap[];
  candidates: SubstituteCandidate[];
  /** 이미 대체로 확정된 사람 */
  confirmed: string[];
  message: string;
};

export type GenerateResult = {
  assignments: PeriodAssignments;
  targets: Record<PeriodId, StaffingTarget>;
  checks: ConstraintCheck[];
  warnings: RotationWarning[];
  impact: ProductionImpact;
  failed: boolean;
  /** 결원이 없으면 없음 */
  substitutePlan?: ShiftSubstitutePlan;
};
