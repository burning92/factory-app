import type {
  MaterialRequirementRow,
  PlanningBomRow,
  PlanningEntryRow,
  PlanningInventoryRow,
  PlanningManpowerRow,
  PlanningMaterialRow,
  PlanningNoteRow,
  PlanningProcessedRow,
  PlanningRangeMode,
  PlanningSubmaterialRow,
} from "./types";

export function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function monthDays(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function weekdayOfFirstDay(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

export function computeActualManpower(
  totalMembers: number,
  annualLeaveCount: number,
  halfDayCount: number,
  otherCount: number
): number {
  const value = totalMembers - annualLeaveCount - halfDayCount * 0.5 - otherCount;
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

/** 운영 기준 공휴일/휴무일 매핑. 필요 시 연도별 확장. */
const KOREA_HOLIDAY_NAME_BY_DATE = new Map<string, string>([
  ["2026-01-01", "신정"],
  ["2026-02-16", "설날 연휴"],
  ["2026-02-17", "설날"],
  ["2026-02-18", "설날 연휴"],
  ["2026-03-01", "삼일절"],
  ["2026-05-01", "근로자의날(노동절)"],
  ["2026-05-05", "어린이날"],
  ["2026-05-24", "부처님오신날"],
  ["2026-05-25", "부처님 (대체)"],
  ["2026-06-03", "지방선거"],
  ["2026-06-06", "현충일"],
  ["2026-07-17", "제헌절"],
  ["2026-08-15", "광복절"],
  ["2026-08-17", "광복절(대체)"],
  ["2026-09-24", "추석 연휴"],
  ["2026-09-25", "추석"],
  ["2026-09-26", "추석 연휴"],
  ["2026-10-03", "개천절"],
  ["2026-10-05", "개천절(대체)"],
  ["2026-10-09", "한글날"],
  ["2026-12-25", "크리스마스"],
  ["2027-01-01", "신정"],
  ["2027-02-06", "설날 연휴"],
  ["2027-02-07", "설날"],
  ["2027-02-08", "설날 연휴"],
  ["2027-02-09", "설날 (대체)"],
  ["2027-03-01", "삼일절"],
  ["2027-05-01", "근로자의날(노동절)"],
  ["2027-05-05", "어린이날"],
  ["2027-05-13", "부처님오신날"],
  ["2027-06-06", "현충일"],
  ["2027-06-07", "현충일 (대체)"],
  ["2027-08-15", "광복절"],
  ["2027-08-16", "광복절 (대체)"],
  ["2027-09-14", "추석 연휴"],
  ["2027-09-15", "추석"],
  ["2027-09-16", "추석 연휴"],
  ["2027-10-03", "개천절"],
  ["2027-10-04", "개천절 (대체)"],
  ["2027-10-09", "한글날"],
  ["2027-10-11", "한글날 (대체)"],
  ["2027-12-25", "크리스마스"],
  ["2027-12-27", "크리스마스 (대체)"],
]);

export function isKoreanPublicHoliday(dateIso: string): boolean {
  return KOREA_HOLIDAY_NAME_BY_DATE.has(dateIso);
}

export function getKoreanHolidayName(dateIso: string): string | null {
  return KOREA_HOLIDAY_NAME_BY_DATE.get(dateIso) ?? null;
}

export function getDateRange(params: {
  year: number;
  month: number;
  selectedDate: string;
  mode: PlanningRangeMode;
  customStart?: string;
  customEnd?: string;
}): { start: string; end: string } {
  const { year, month, selectedDate, mode, customStart, customEnd } = params;
  const startOfMonth = ymd(year, month, 1);
  const endOfMonth = ymd(year, month, monthDays(year, month));
  const today = new Date();
  const todayIso = ymd(today.getFullYear(), today.getMonth() + 1, today.getDate());

  if (mode === "day") return { start: selectedDate, end: selectedDate };
  if (mode === "from_selected") return { start: selectedDate, end: endOfMonth };
  if (mode === "from_today") {
    const start = todayIso >= startOfMonth && todayIso <= endOfMonth ? todayIso : startOfMonth;
    return { start, end: endOfMonth };
  }
  const start = customStart && customStart <= customEnd! ? customStart : startOfMonth;
  const end = customEnd && customEnd >= customStart! ? customEnd : endOfMonth;
  return { start, end };
}

function indexBomByProduct(rows: PlanningBomRow[]): Map<string, PlanningBomRow[]> {
  const map = new Map<string, PlanningBomRow[]>();
  for (const row of rows) {
    const key = row.product_name.trim();
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

function normalizeItemCode(code: string | null | undefined): string {
  return String(code ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function canonicalMaterialName(name: string): string {
  const n = String(name ?? "").trim();
  if (!n) return n;
  if (n.includes("토마토소스")) return "토마토소스";
  if (n.includes("베샤멜소스")) return "베샤멜소스";
  return n;
}

function stockByMaterialQty(params: {
  materialRows: PlanningMaterialRow[];
  inventoryRows: PlanningInventoryRow[];
}): {
  stockByMaterial: Map<string, number>;
  codeByMaterial: Map<string, Set<string>>;
  inventoryCodeSet: Set<string>;
} {
  const { materialRows, inventoryRows } = params;
  const byItemCode = new Map<string, number>();
  for (const inv of inventoryRows) {
    const code = normalizeItemCode(inv.item_code);
    if (!code) continue;
    const current = byItemCode.get(code) ?? 0;
    // 재고현황 페이지의 "재고수량(qty)" 기준을 그대로 사용한다. (이중 환산 금지)
    byItemCode.set(code, current + (Number(inv.qty) || 0));
  }
  const codeByMaterial = new Map<string, Set<string>>();
  for (const m of materialRows) {
    const materialKey = canonicalMaterialName(m.material_name);
    if (!materialKey) continue;
    const code = normalizeItemCode(m.inventory_item_code);
    if (!code) {
      if (!codeByMaterial.has(materialKey)) codeByMaterial.set(materialKey, new Set());
      continue;
    }
    const codes = codeByMaterial.get(materialKey) ?? new Set<string>();
    codes.add(code);
    codeByMaterial.set(materialKey, codes);
  }
  /** 같은 표시명(캐논)으로 묶일 때 item_code는 한 번만 집계한다. 행마다 더하면 동일 코드 재고가 2배로 잡힌다. */
  const byMaterial = new Map<string, number>();
  for (const [materialKey, codes] of Array.from(codeByMaterial.entries())) {
    let total = 0;
    for (const code of Array.from(codes)) {
      total += byItemCode.get(code) ?? 0;
    }
    byMaterial.set(materialKey, total);
  }
  return { stockByMaterial: byMaterial, codeByMaterial, inventoryCodeSet: new Set(byItemCode.keys()) };
}

/** 계획 행의 제품명에서 ` - 조건` 앞 베이스명만 추출 (집계·분류 공통) */
export function baseProductName(productNameSnapshot: string): string {
  const name = productNameSnapshot.trim();
  const idx = name.indexOf(" - ");
  if (idx < 0) return name;
  return name.slice(0, idx).trim();
}

/** `베이스 - 조건` 에서 조건 부분 (없으면 빈 문자열) */
export function productKindFromSnapshot(productNameSnapshot: string): string {
  const name = productNameSnapshot.trim();
  const idx = name.indexOf(" - ");
  if (idx < 0) return "";
  return name.slice(idx + 3).trim();
}

/**
 * 출력/집계/원료 환산 공통: 미니(2입) 또는 `(2입)` 표기 제품은 수량을 2배로 본다.
 * 미니+2입이 함께 있어도 한 번만 2배 적용한다.
 */
export function rollupQtyForPlanning(productNameSnapshot: string, rawQty: number): number {
  const q = Number(rawQty) || 0;
  if (q <= 0) return 0;
  const snap = productNameSnapshot.trim();
  const kind = productKindFromSnapshot(snap).trim();
  if (kind === "미니" || kind.startsWith("미니")) return q * 2;
  if (snap.includes("(2입)")) return q * 2;
  return q;
}

/**
 * 월간(또는 기간) 필요 원료 합계.
 * BOM 매칭 키는 **계획 행의 전체 스냅샷 문자열**(`product_name_snapshot`, 예: `마르게리따 - 일반`)이며
 * `bom.product_name` 과 정확히 일치해야 한다. 베이스명만으로는 조회하지 않음 → BOM 미연결 시 필요량 0.
 * 재고는 재고현황과 동일하게 `ecount_inventory_current.qty`를 item_code 기준 합산해 사용한다.
 */
export function computeMaterialRequirements(params: {
  entries: PlanningEntryRow[];
  bomRows: PlanningBomRow[];
  submaterialRows: PlanningSubmaterialRow[];
  materialRows: PlanningMaterialRow[];
  inventoryRows: PlanningInventoryRow[];
  startDate: string;
  endDate: string;
}): MaterialRequirementRow[] {
  const { entries, bomRows, submaterialRows, materialRows, inventoryRows, startDate, endDate } = params;
  const bomByProduct = indexBomByProduct(bomRows);
  const subByProduct = new Map<string, PlanningSubmaterialRow[]>();
  for (const s of submaterialRows) {
    if (!s.active) continue;
    if (!s.product_name_snapshot.trim()) continue;
    if ((Number(s.qty_g_per_ea) || 0) <= 0) continue;
    const key = s.product_name_snapshot.trim();
    const list = subByProduct.get(key) ?? [];
    list.push(s);
    subByProduct.set(key, list);
  }
  const requiredByMaterial = new Map<string, number>();

  for (const entry of entries) {
    if (entry.plan_date < startDate || entry.plan_date > endDate) continue;
    const snap = entry.product_name_snapshot.trim();
    const bomList = bomByProduct.get(snap) ?? [];
    const subList = subByProduct.get(snap) ?? [];
    const rollupQty = rollupQtyForPlanning(entry.product_name_snapshot, entry.qty);
    if (rollupQty <= 0) continue;
    for (const bom of bomList) {
      const materialKey = canonicalMaterialName(bom.material_name);
      if (!materialKey) continue;
      const curr = requiredByMaterial.get(materialKey) ?? 0;
      requiredByMaterial.set(materialKey, curr + rollupQty * bom.bom_g_per_ea);
    }
    for (const sub of subList) {
      const materialKey = canonicalMaterialName(sub.material_name);
      if (!materialKey) continue;
      const curr = requiredByMaterial.get(materialKey) ?? 0;
      requiredByMaterial.set(materialKey, curr + rollupQty * (Number(sub.qty_g_per_ea) || 0));
    }
  }

  const { stockByMaterial, codeByMaterial, inventoryCodeSet } = stockByMaterialQty({ materialRows, inventoryRows });
  const rows: MaterialRequirementRow[] = [];
  for (const materialName of Array.from(requiredByMaterial.keys())) {
    const required = requiredByMaterial.get(materialName) ?? 0;
    const stock = stockByMaterial.get(materialName) ?? 0;
    const mappedCodes = codeByMaterial.get(materialName) ?? new Set<string>();
    let stockStatus: MaterialRequirementRow["stock_status"] = "ok";
    if (mappedCodes.size === 0) stockStatus = "no_mapping";
    else if (!Array.from(mappedCodes).some((code) => inventoryCodeSet.has(code))) stockStatus = "no_inventory_match";
    else if (stock <= 0) stockStatus = "real_zero";
    const shortage = Math.max(0, required - stock);
    rows.push({
      material_name: materialName,
      required_g: Number(required.toFixed(2)),
      stock_g: Number(stock.toFixed(2)),
      shortage_g: Number(shortage.toFixed(2)),
      order_required_g: Number(shortage.toFixed(2)),
      stock_status: stockStatus,
    });
  }
  return rows
    .filter((r) => r.required_g > 0)
    .sort((a, b) => b.shortage_g - a.shortage_g || b.required_g - a.required_g || a.material_name.localeCompare(b.material_name));
}

export function computeMonthlySummary(params: {
  year: number;
  month: number;
  entries: PlanningEntryRow[];
  notes: PlanningNoteRow[];
  materialRows: PlanningMaterialRow[];
  bomRows: PlanningBomRow[];
  submaterialRows: PlanningSubmaterialRow[];
  inventoryRows: PlanningInventoryRow[];
}): {
  totalQty: number;
  topProducts: { productName: string; qty: number }[];
  plannedDays: number;
  noteDays: number;
  shortageMaterialsCount: number;
  topMaterials: { materialName: string; requiredG: number }[];
} {
  const { year, month, entries, notes, materialRows, bomRows, submaterialRows, inventoryRows } = params;
  const byProduct = new Map<string, number>();
  let totalQty = 0;
  const daySet = new Set<string>();
  for (const e of entries) {
    totalQty += e.qty;
    daySet.add(e.plan_date);
    const baseName = baseProductName(e.product_name_snapshot);
    byProduct.set(baseName, (byProduct.get(baseName) ?? 0) + e.qty);
  }
  const noteDays = new Set(notes.map((n) => n.plan_date)).size;
  const today = new Date();
  const todayIso = ymd(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const start = todayIso;
  const end = ymd(year, month, monthDays(year, month));
  const materialRowsResult = computeMaterialRequirements({
    entries,
    bomRows,
    submaterialRows,
    materialRows,
    inventoryRows,
    startDate: start,
    endDate: end,
  });
  const topMaterials = materialRowsResult
    .slice()
    .sort((a, b) => b.required_g - a.required_g)
    .slice(0, 5)
    .map((r) => ({ materialName: r.material_name, requiredG: r.required_g }));
  return {
    totalQty: Number(totalQty.toFixed(2)),
    topProducts: Array.from(byProduct.entries())
      .map(([productName, qty]) => ({ productName, qty: Number(qty.toFixed(2)) }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5),
    plannedDays: daySet.size,
    noteDays,
    shortageMaterialsCount: materialRowsResult.filter((r) => r.shortage_g > 0).length,
    topMaterials,
  };
}

export function computeProcessedRows(params: {
  entries: PlanningEntryRow[];
  notes: PlanningNoteRow[];
  manpowerRows: PlanningManpowerRow[];
}): PlanningProcessedRow[] {
  const { entries, notes, manpowerRows } = params;
  const notesByDate = new Map<string, string>();
  for (const n of notes) {
    const prev = notesByDate.get(n.plan_date);
    notesByDate.set(n.plan_date, prev ? `${prev}\n${n.note_text}` : n.note_text);
  }
  const manpowerByDate = new Map<string, number>();
  for (const m of manpowerRows) {
    manpowerByDate.set(m.plan_date, Number(m.actual_manpower ?? 0));
  }
  return entries
    .slice()
    .sort((a, b) => a.plan_date.localeCompare(b.plan_date) || a.sort_order - b.sort_order)
    .map((e) => ({
      plan_date: e.plan_date,
      product_name: e.product_name_snapshot,
      qty: e.qty,
      manpower: manpowerByDate.get(e.plan_date) ?? 0,
      note: notesByDate.get(e.plan_date) ?? "",
    }));
}
