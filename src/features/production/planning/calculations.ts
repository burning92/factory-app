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

/** 고정 공휴일 + 2026(운영 시작 연도) 주요 공휴일. 필요 시 연도별 확장. */
const KOREA_HOLIDAYS = new Set<string>([
  "2026-01-01",
  "2026-03-01",
  "2026-05-05",
  "2026-06-06",
  "2026-08-15",
  "2026-10-03",
  "2026-10-09",
  "2026-12-25",
]);

export function isKoreanPublicHoliday(dateIso: string): boolean {
  return KOREA_HOLIDAYS.has(dateIso);
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

function qtyToG(qty: number, boxWeightG: number, unitWeightG: number): number {
  if (unitWeightG > 0) return qty * unitWeightG;
  if (boxWeightG > 0) return qty * boxWeightG;
  return qty;
}

function stockByMaterialG(params: {
  materialRows: PlanningMaterialRow[];
  inventoryRows: PlanningInventoryRow[];
}): Map<string, number> {
  const { materialRows, inventoryRows } = params;
  const byItemCode = new Map<string, number>();
  for (const inv of inventoryRows) {
    const current = byItemCode.get(inv.item_code) ?? 0;
    byItemCode.set(inv.item_code, current + qtyToG(Number(inv.qty) || 0, Number(inv.box_weight_g) || 0, Number(inv.unit_weight_g) || 0));
  }
  const byMaterial = new Map<string, number>();
  for (const m of materialRows) {
    const code = m.inventory_item_code?.trim();
    if (!code) continue;
    byMaterial.set(m.material_name, byItemCode.get(code) ?? 0);
  }
  return byMaterial;
}

function baseProductName(productNameSnapshot: string): string {
  const name = productNameSnapshot.trim();
  const idx = name.indexOf(" - ");
  if (idx < 0) return name;
  return name.slice(0, idx).trim();
}

export function computeMaterialRequirements(params: {
  entries: PlanningEntryRow[];
  bomRows: PlanningBomRow[];
  materialRows: PlanningMaterialRow[];
  inventoryRows: PlanningInventoryRow[];
  startDate: string;
  endDate: string;
}): MaterialRequirementRow[] {
  const { entries, bomRows, materialRows, inventoryRows, startDate, endDate } = params;
  const bomByProduct = indexBomByProduct(bomRows);
  const requiredByMaterial = new Map<string, number>();

  for (const entry of entries) {
    if (entry.plan_date < startDate || entry.plan_date > endDate) continue;
    const bomList = bomByProduct.get(entry.product_name_snapshot.trim()) ?? [];
    for (const bom of bomList) {
      const curr = requiredByMaterial.get(bom.material_name) ?? 0;
      requiredByMaterial.set(bom.material_name, curr + entry.qty * bom.bom_g_per_ea);
    }
  }

  const stockMap = stockByMaterialG({ materialRows, inventoryRows });
  const allNames = new Set<string>([...Array.from(requiredByMaterial.keys()), ...Array.from(stockMap.keys())]);
  const rows: MaterialRequirementRow[] = [];
  for (const materialName of Array.from(allNames)) {
    const required = requiredByMaterial.get(materialName) ?? 0;
    const stock = stockMap.get(materialName) ?? 0;
    const shortage = Math.max(0, required - stock);
    rows.push({
      material_name: materialName,
      required_g: Number(required.toFixed(2)),
      stock_g: Number(stock.toFixed(2)),
      shortage_g: Number(shortage.toFixed(2)),
      order_required_g: Number(shortage.toFixed(2)),
    });
  }
  return rows
    .filter((r) => r.required_g > 0 || r.stock_g > 0)
    .sort((a, b) => b.shortage_g - a.shortage_g || b.required_g - a.required_g || a.material_name.localeCompare(b.material_name));
}

export function computeMonthlySummary(params: {
  year: number;
  month: number;
  entries: PlanningEntryRow[];
  notes: PlanningNoteRow[];
  materialRows: PlanningMaterialRow[];
  bomRows: PlanningBomRow[];
  inventoryRows: PlanningInventoryRow[];
}): {
  totalQty: number;
  topProducts: { productName: string; qty: number }[];
  plannedDays: number;
  noteDays: number;
  shortageMaterialsCount: number;
  topMaterials: { materialName: string; requiredG: number }[];
} {
  const { year, month, entries, notes, materialRows, bomRows, inventoryRows } = params;
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
  const start = ymd(year, month, 1);
  const end = ymd(year, month, monthDays(year, month));
  const materialRowsResult = computeMaterialRequirements({
    entries,
    bomRows,
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
