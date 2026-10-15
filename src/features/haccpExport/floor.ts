export const FLOOR_VALUES = ["1층", "2층", "3층"] as const;
export type FloorValue = (typeof FLOOR_VALUES)[number];

const SKIP_KEYS = new Set([
  "id",
  "log_id",
  "created_at",
  "updated_at",
  "result",
  "conformity",
  "organization_code",
  "status",
]);

export function floorsMentioned(text: string): FloorValue[] {
  const found: FloorValue[] = [];
  if (text.includes("1층")) found.push("1층");
  if (text.includes("2층")) found.push("2층");
  if (text.includes("3층")) found.push("3층");
  return found;
}

/**
 * 항목에 적힌 층 문구가 정확히 하나일 때만 그 층을 반환한다.
 * 문구가 없거나 여러 층이면 null. 일지 이름이나 체크리스트 위치로 채우지 않는다.
 */
export function detectFloorFromRecord(row: Record<string, unknown>): FloorValue | null {
  const found = new Set<FloorValue>();
  for (const [key, value] of Object.entries(row)) {
    if (SKIP_KEYS.has(key) || typeof value !== "string") continue;
    for (const floor of floorsMentioned(value)) found.add(floor);
  }
  if (found.size !== 1) return null;
  return Array.from(found)[0];
}

/** 컬럼명에 floor1/floor3 또는 N층이 있을 때만. 없으면 null. */
export function detectFloorFromColumn(column: string): FloorValue | null {
  if (/floor1|_1층|1층/.test(column)) return "1층";
  if (/floor2|_2층|2층/.test(column)) return "2층";
  if (/floor3|_3층|3층/.test(column)) return "3층";
  return null;
}

export function isColdTempColumn(column: string): boolean {
  return /^(am|pm)_temp_.+_c$/.test(column);
}

export function isFloorValue(value: string): value is FloorValue {
  return (FLOOR_VALUES as readonly string[]).includes(value);
}
