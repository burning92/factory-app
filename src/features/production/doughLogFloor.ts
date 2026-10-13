/** 반죽 사용량 층. 같은 사용일자 행의 meta.floors 안에 2층·3층을 따로 둔다. */
export type DoughProductionFloor = "2F" | "3F";

export interface DoughFloorIngredientLine {
  사용량_g: number;
  lot: string;
}

export interface DoughFloorEntry {
  author_name: string | null;
  dough_date: string | null;
  target_quantity?: number;
  dough_id?: string;
  hydration_percent?: number;
  dough_ingredients: Record<string, DoughFloorIngredientLine[]>;
  dust_oil: Record<string, DoughFloorIngredientLine[]>;
}

export type DoughFloorMap = Partial<Record<DoughProductionFloor, DoughFloorEntry>>;

const FLOOR_ORDER: DoughProductionFloor[] = ["2F", "3F"];

export function isDoughProductionFloor(value: unknown): value is DoughProductionFloor {
  return value === "2F" || value === "3F";
}

export function doughFloorLabel(floor: DoughProductionFloor | null | undefined): string {
  if (floor === "2F") return "2층";
  if (floor === "3F") return "3층";
  return "";
}

export function doughLogMapKey(usageDate: string, floor?: DoughProductionFloor | null): string {
  const date = usageDate.slice(0, 10);
  return floor ? `${date}|${floor}` : date;
}

export function doughFloorRank(floor: DoughProductionFloor | null | undefined): number {
  if (floor === "2F") return 0;
  if (floor === "3F") return 1;
  return 2;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readLines(value: unknown): Record<string, DoughFloorIngredientLine[]> {
  const rec = asRecord(value);
  if (!rec) return {};
  const out: Record<string, DoughFloorIngredientLine[]> = {};
  for (const [name, lines] of Object.entries(rec)) {
    if (!Array.isArray(lines)) continue;
    const parsed = lines
      .map((line) => {
        const row = asRecord(line);
        if (!row) return null;
        const g = Number(row.사용량_g);
        return {
          사용량_g: Number.isFinite(g) ? Math.max(0, g) : 0,
          lot: row.lot != null && String(row.lot).trim() !== "" ? String(row.lot).trim() : "—",
        };
      })
      .filter((line): line is DoughFloorIngredientLine => line != null);
    if (parsed.length > 0) out[name] = parsed;
  }
  return out;
}

function normalizeEntry(value: unknown): DoughFloorEntry {
  const row = asRecord(value) ?? {};
  const target = Number(row.target_quantity);
  const hydration = Number(row.hydration_percent);
  const doughId = row.dough_id != null ? String(row.dough_id).trim() : "";
  const doughDate = row.dough_date != null ? String(row.dough_date).slice(0, 10) : "";
  return {
    author_name: row.author_name != null && String(row.author_name).trim() !== "" ? String(row.author_name).trim() : null,
    dough_date: doughDate || null,
    target_quantity: Number.isFinite(target) ? Math.round(target) : undefined,
    dough_id: doughId || undefined,
    hydration_percent: Number.isFinite(hydration) ? hydration : undefined,
    dough_ingredients: readLines(row.dough_ingredients),
    dust_oil: readLines(row.dust_oil),
  };
}

/** meta.floors 가 있으면 층별 기록. 없으면 예전 통합 기록이다. */
export function readDoughFloors(meta: unknown): DoughFloorMap | null {
  const root = asRecord(meta);
  const floors = asRecord(root?.floors);
  if (!floors) return null;
  const out: DoughFloorMap = {};
  for (const floor of FLOOR_ORDER) {
    if (floors[floor] == null) continue;
    out[floor] = normalizeEntry(floors[floor]);
  }
  return out["2F"] || out["3F"] ? out : null;
}

/** 다른 층은 유지한 채 한 층만 갈아끼운다. */
export function mergeDoughFloor(meta: unknown, floor: DoughProductionFloor, entry: DoughFloorEntry): Record<string, unknown> {
  const base = asRecord(meta) ? { ...(meta as Record<string, unknown>) } : {};
  const current = readDoughFloors(base) ?? {};
  delete base.target_quantity;
  delete base.dough_id;
  delete base.hydration_percent;
  return { ...base, floors: { ...current, [floor]: entry } };
}

export function removeDoughFloor(meta: unknown, floor: DoughProductionFloor): { meta: Record<string, unknown>; empty: boolean } {
  const base = asRecord(meta) ? { ...(meta as Record<string, unknown>) } : {};
  const current: DoughFloorMap = { ...(readDoughFloors(base) ?? {}) };
  delete current[floor];
  const empty = !current["2F"] && !current["3F"];
  if (empty) {
    delete base.floors;
    return { meta: base, empty: true };
  }
  delete base.target_quantity;
  delete base.dough_id;
  delete base.hydration_percent;
  return { meta: { ...base, floors: current }, empty: false };
}

export function earliestDoughDate(floors: DoughFloorMap): string | null {
  const dates = FLOOR_ORDER.map((floor) => floors[floor]?.dough_date).filter((date): date is string => !!date);
  dates.sort();
  return dates[0] ?? null;
}
