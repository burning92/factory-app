/**
 * 냉장 · 냉동온도 측정 — 키·기준·이탈 판정·냉동고 자동 음수 처리
 */

import type { HygieneFormResults } from "@/features/daily/hygieneChecklist";
import { COLD_STORAGE_HYGIENE_CHECKLIST } from "@/features/daily/coldStorageHygieneChecklist";

export type ColdStorageTempKey =
  | "floor1_refrigerator"
  | "floor1_freezer"
  | "dough_aging"
  | "topping_refrigerator"
  | "blast_freezer_1"
  | "blast_freezer_2";

export type ColdStorageTempKind = "chill_0_10" | "freezer_le18" | "freezer_le30";

export type ColdStorageTempDef = {
  key: ColdStorageTempKey;
  label: string;
  kind: ColdStorageTempKind;
  /** 냉동고 계열: 숫자만 입력 시 -Math.abs 로 저장 */
  autoNegative: boolean;
};

export const COLD_STORAGE_TEMPERATURE_DEFS: ColdStorageTempDef[] = [
  { key: "floor1_refrigerator", label: "1층 냉장창고", kind: "chill_0_10", autoNegative: false },
  { key: "floor1_freezer", label: "1층 냉동창고", kind: "freezer_le18", autoNegative: true },
  { key: "dough_aging", label: "도우숙성고", kind: "chill_0_10", autoNegative: false },
  { key: "topping_refrigerator", label: "토핑냉장고", kind: "chill_0_10", autoNegative: false },
  { key: "blast_freezer_1", label: "급속냉동고 1", kind: "freezer_le30", autoNegative: true },
  { key: "blast_freezer_2", label: "급속냉동고 2", kind: "freezer_le30", autoNegative: true },
];

export const COLD_STORAGE_FREEZER_KEYS = new Set<ColdStorageTempKey>(
  COLD_STORAGE_TEMPERATURE_DEFS.filter((d) => d.autoNegative).map((d) => d.key)
);

export function roundOneDecimal(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 빈 문자열이면 null */
export function parseOptionalNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return roundOneDecimal(n);
}

/**
 * 냉동고 계열 입력: 양수면 -Math.abs, 이미 음수면 유지. 소수점 1자리.
 * 빈 문자열은 그대로 반환.
 */
export function applyFreezerSignOnBlur(raw: string): string {
  const t = raw.trim();
  if (t === "") return "";
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n)) return raw;
  if (n < 0) return String(roundOneDecimal(n));
  return String(roundOneDecimal(-Math.abs(n)));
}

function defByKey(key: ColdStorageTempKey): ColdStorageTempDef | undefined {
  return COLD_STORAGE_TEMPERATURE_DEFS.find((d) => d.key === key);
}

/** 기준 이탈 여부 (값이 없으면 이탈로 보지 않음) */
export function isTempOutOfRange(kind: ColdStorageTempKind, value: number | null): boolean {
  if (value == null) return false;
  switch (kind) {
    case "chill_0_10":
      return value < 0 || value > 10;
    case "freezer_le18":
      return value > -18;
    case "freezer_le30":
      return value > -30;
    default:
      return false;
  }
}

export function isTempKeyOutOfRange(key: ColdStorageTempKey, value: number | null): boolean {
  const d = defByKey(key);
  if (!d) return false;
  return isTempOutOfRange(d.kind, value);
}

function criterionLabel(kind: ColdStorageTempKind): string {
  switch (kind) {
    case "chill_0_10":
      return "기준 0~10℃";
    case "freezer_le18":
      return "기준 -18℃ 이하";
    case "freezer_le30":
      return "기준 -30℃ 이하";
    default:
      return "";
  }
}

export type TempPeriodLabel = "오전" | "오후";

export function formatTempDeviationLine(
  def: ColdStorageTempDef,
  period: TempPeriodLabel,
  value: number
): string {
  return `${def.label}(${period}): ${value.toFixed(1)}℃ / ${criterionLabel(def.kind)}`;
}

/** 점검 항목 부적합 + 온도 기준 이탈을 한 이탈내용 문자열로 생성 */
export function buildColdStorageAutoDeviationText(
  results: HygieneFormResults,
  amTemps: Record<ColdStorageTempKey, string>,
  pmTemps: Record<ColdStorageTempKey, string>
): string {
  const lines: string[] = [];

  COLD_STORAGE_HYGIENE_CHECKLIST.forEach((cat, ci) => {
    cat.items.forEach((item, qi) => {
      const key = `${ci}-${qi}`;
      if (results[key] === "X") {
        lines.push(`${item.label}: 부적합`);
      }
    });
  });

  const appendPeriod = (period: TempPeriodLabel, temps: Record<ColdStorageTempKey, string>) => {
    COLD_STORAGE_TEMPERATURE_DEFS.forEach((def) => {
      const v = parseOptionalNum(temps[def.key] ?? "");
      if (v != null && isTempOutOfRange(def.kind, v)) {
        lines.push(formatTempDeviationLine(def, period, v));
      }
    });
  };

  appendPeriod("오전", amTemps);
  appendPeriod("오후", pmTemps);

  return lines.join("\n");
}

export function hasAnyChecklistFail(results: HygieneFormResults): boolean {
  return Object.values(results).some((v) => v === "X");
}

export function hasAnyTemperatureDeviation(
  amTemps: Record<ColdStorageTempKey, string>,
  pmTemps: Record<ColdStorageTempKey, string>
): boolean {
  const checkMap = (temps: Record<ColdStorageTempKey, string>) =>
    COLD_STORAGE_TEMPERATURE_DEFS.some((def) => {
      const v = parseOptionalNum(temps[def.key] ?? "");
      return v != null && isTempOutOfRange(def.kind, v);
    });
  return checkMap(amTemps) || checkMap(pmTemps);
}

export function emptyTempRow(): Record<ColdStorageTempKey, string> {
  return {
    floor1_refrigerator: "",
    floor1_freezer: "",
    dough_aging: "",
    topping_refrigerator: "",
    blast_freezer_1: "",
    blast_freezer_2: "",
  };
}
