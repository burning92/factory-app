import { rollupQtyForPlanning, ymd } from "@/features/production/planning/calculations";
import type { PlanningBomRow, PlanningEntryRow, PlanningInventoryRow, PlanningSubmaterialRow } from "@/features/production/planning/types";
import type {
  PurchasingDatePoint,
  PurchasingMaterialMasterRow,
  PurchasingOrderPolicy,
  PurchasingProductDriver,
  PurchasingStatus,
  PurchasingTableRow,
  PurchasingVendorItemRow,
} from "./types";

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

function toIsoDate(input: Date): string {
  return ymd(input.getFullYear(), input.getMonth() + 1, input.getDate());
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

export function getPurchasingRange(periodKey: "d7" | "d14" | "d30" | "month_end" | "month_next", todayIso: string): {
  start: string;
  end: string;
} {
  if (periodKey === "d7") return { start: todayIso, end: addDays(todayIso, 7) };
  if (periodKey === "d14") return { start: todayIso, end: addDays(todayIso, 14) };
  if (periodKey === "d30") return { start: todayIso, end: addDays(todayIso, 30) };
  const today = new Date(`${todayIso}T00:00:00`);
  const monthEnd = ymd(today.getFullYear(), today.getMonth() + 1, new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate());
  if (periodKey === "month_end") return { start: todayIso, end: monthEnd };
  const nextEnd = ymd(today.getFullYear(), today.getMonth() + 2, new Date(today.getFullYear(), today.getMonth() + 2, 0).getDate());
  return { start: todayIso, end: nextEnd };
}

function buildDailyRequirements(params: {
  entries: PlanningEntryRow[];
  bomRows: PlanningBomRow[];
  submaterialRows: PlanningSubmaterialRow[];
}): Map<string, Map<string, number>> {
  const { entries, bomRows, submaterialRows } = params;
  const bomByProduct = new Map<string, PlanningBomRow[]>();
  for (const bom of bomRows) {
    const key = bom.product_name.trim();
    const list = bomByProduct.get(key) ?? [];
    list.push(bom);
    bomByProduct.set(key, list);
  }
  const subByProduct = new Map<string, PlanningSubmaterialRow[]>();
  for (const sub of submaterialRows) {
    if (!sub.active) continue;
    const key = sub.product_name_snapshot.trim();
    const list = subByProduct.get(key) ?? [];
    list.push(sub);
    subByProduct.set(key, list);
  }

  const byDate = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    const snap = entry.product_name_snapshot.trim();
    const dateKey = entry.plan_date;
    const qty = rollupQtyForPlanning(snap, entry.qty);
    if (qty <= 0) continue;
    const dailyMap = byDate.get(dateKey) ?? new Map<string, number>();
    for (const bom of bomByProduct.get(snap) ?? []) {
      const materialKey = canonicalMaterialName(bom.material_name);
      const curr = dailyMap.get(materialKey) ?? 0;
      dailyMap.set(materialKey, curr + qty * (Number(bom.bom_g_per_ea) || 0));
    }
    for (const sub of subByProduct.get(snap) ?? []) {
      const materialKey = canonicalMaterialName(sub.material_name);
      const curr = dailyMap.get(materialKey) ?? 0;
      dailyMap.set(materialKey, curr + qty * (Number(sub.qty_g_per_ea) || 0));
    }
    byDate.set(dateKey, dailyMap);
  }
  return byDate;
}

function buildStockByMaterial(params: {
  materialRows: PurchasingMaterialMasterRow[];
  inventoryRows: PlanningInventoryRow[];
}): { stockByMaterial: Map<string, number>; codeByMaterial: Map<string, Set<string>>; typeByMaterial: Map<string, "raw_material" | "submaterial" | "unknown"> } {
  const { materialRows, inventoryRows } = params;
  const byCode = new Map<string, number>();
  for (const inv of inventoryRows) {
    const code = normalizeItemCode(inv.item_code);
    if (!code) continue;
    byCode.set(code, (byCode.get(code) ?? 0) + (Number(inv.qty) || 0));
  }
  const codeByMaterial = new Map<string, Set<string>>();
  for (const mat of materialRows) {
    const key = canonicalMaterialName(mat.material_name);
    if (!key) continue;
    const code = normalizeItemCode(mat.inventory_item_code);
    const set = codeByMaterial.get(key) ?? new Set<string>();
    if (code) set.add(code);
    codeByMaterial.set(key, set);
  }
  const stock = new Map<string, number>();
  const typeByMaterial = new Map<string, "raw_material" | "submaterial" | "unknown">();
  for (const [materialName, codes] of Array.from(codeByMaterial.entries())) {
    let total = 0;
    for (const code of Array.from(codes)) total += byCode.get(code) ?? 0;
    stock.set(materialName, total);
  }
  for (const mat of materialRows) {
    const key = canonicalMaterialName(mat.material_name);
    if (!key) continue;
    const prev = typeByMaterial.get(key);
    if (!prev) {
      typeByMaterial.set(key, mat.material_type);
    } else if (prev !== mat.material_type) {
      typeByMaterial.set(key, "unknown");
    }
  }
  return { stockByMaterial: stock, codeByMaterial, typeByMaterial };
}

function statusFromRow(row: Pick<PurchasingTableRow, "shortage_g" | "order_due_date">, todayIso: string): PurchasingStatus {
  if (row.shortage_g <= 0) return "safe";
  if (!row.order_due_date) return "scheduled";
  if (row.order_due_date <= todayIso) return "urgent";
  if (row.order_due_date <= addDays(todayIso, 3)) return "warning";
  return "scheduled";
}

function policyFromRaw(raw: string | null | undefined): PurchasingOrderPolicy {
  return raw === "on_demand" ? "on_demand" : "normal";
}

function buildProductDrivers(params: {
  entries: PlanningEntryRow[];
  bomRows: PlanningBomRow[];
  submaterialRows: PlanningSubmaterialRow[];
  rangeStart: string;
  rangeEnd: string;
}): Map<string, PurchasingProductDriver[]> {
  const { entries, bomRows, submaterialRows, rangeStart, rangeEnd } = params;
  const byProductMaterial = new Map<string, number>();
  const bomByProduct = new Map<string, PlanningBomRow[]>();
  for (const bom of bomRows) {
    const key = bom.product_name.trim();
    const list = bomByProduct.get(key) ?? [];
    list.push(bom);
    bomByProduct.set(key, list);
  }
  const subByProduct = new Map<string, PlanningSubmaterialRow[]>();
  for (const sub of submaterialRows) {
    if (!sub.active) continue;
    const key = sub.product_name_snapshot.trim();
    const list = subByProduct.get(key) ?? [];
    list.push(sub);
    subByProduct.set(key, list);
  }
  for (const entry of entries) {
    if (entry.plan_date < rangeStart || entry.plan_date > rangeEnd) continue;
    const snap = entry.product_name_snapshot.trim();
    const qty = rollupQtyForPlanning(snap, entry.qty);
    if (qty <= 0) continue;
    for (const bom of bomByProduct.get(snap) ?? []) {
      const materialKey = canonicalMaterialName(bom.material_name);
      const key = `${materialKey}__${snap}`;
      byProductMaterial.set(key, (byProductMaterial.get(key) ?? 0) + qty * (Number(bom.bom_g_per_ea) || 0));
    }
    for (const sub of subByProduct.get(snap) ?? []) {
      const materialKey = canonicalMaterialName(sub.material_name);
      const key = `${materialKey}__${snap}`;
      byProductMaterial.set(key, (byProductMaterial.get(key) ?? 0) + qty * (Number(sub.qty_g_per_ea) || 0));
    }
  }
  const result = new Map<string, PurchasingProductDriver[]>();
  for (const [key, req] of Array.from(byProductMaterial.entries())) {
    const [materialName, productNameSnapshot] = key.split("__");
    const list = result.get(materialName) ?? [];
    list.push({ product_name_snapshot: productNameSnapshot, required_g: Number(req.toFixed(2)) });
    result.set(materialName, list);
  }
  for (const [materialName, list] of Array.from(result.entries())) {
    result.set(
      materialName,
      list.slice().sort((a, b) => b.required_g - a.required_g).slice(0, 10)
    );
  }
  return result;
}

export function computePurchasingRows(params: {
  entries: PlanningEntryRow[];
  bomRows: PlanningBomRow[];
  submaterialRows: PlanningSubmaterialRow[];
  materialRows: PurchasingMaterialMasterRow[];
  vendorItemRows: PurchasingVendorItemRow[];
  inventoryRows: PlanningInventoryRow[];
  todayIso: string;
  rangeStart: string;
  rangeEnd: string;
}): PurchasingTableRow[] {
  const { entries, bomRows, submaterialRows, materialRows, vendorItemRows, inventoryRows, todayIso, rangeStart, rangeEnd } = params;
  const daily = buildDailyRequirements({ entries, bomRows, submaterialRows });
  const { stockByMaterial, codeByMaterial, typeByMaterial } = buildStockByMaterial({ materialRows, inventoryRows });
  const productDriversByMaterial = buildProductDrivers({ entries, bomRows, submaterialRows, rangeStart, rangeEnd });
  const primaryByCode = new Map<string, PurchasingVendorItemRow>();
  const primaryByName = new Map<string, PurchasingVendorItemRow>();
  for (const row of vendorItemRows) {
    if (!row.is_primary_vendor) continue;
    const codeKey = normalizeItemCode(row.material_code);
    if (codeKey && !primaryByCode.has(codeKey)) primaryByCode.set(codeKey, row);
    const nameKey = canonicalMaterialName(row.material_name_snapshot);
    const composite = `${row.material_type}__${nameKey}`;
    if (nameKey && !primaryByName.has(composite)) primaryByName.set(composite, row);
  }

  const dayKeys = Array.from(daily.keys()).sort((a, b) => a.localeCompare(b));
  const datePointsByMaterial = new Map<string, PurchasingDatePoint[]>();
  const reqByMaterial7 = new Map<string, number>();
  const reqByMaterial14 = new Map<string, number>();
  const reqByMaterialSelected = new Map<string, number>();
  for (const day of dayKeys) {
    const dayReqMap = daily.get(day) ?? new Map<string, number>();
    for (const [materialName, value] of Array.from(dayReqMap.entries())) {
      const points = datePointsByMaterial.get(materialName) ?? [];
      const prev = points.length > 0 ? points[points.length - 1].cumulative_required_g : 0;
      points.push({
        date: day,
        required_g: Number(value.toFixed(2)),
        cumulative_required_g: Number((prev + value).toFixed(2)),
      });
      datePointsByMaterial.set(materialName, points);

      if (day >= todayIso && day <= addDays(todayIso, 7)) {
        reqByMaterial7.set(materialName, (reqByMaterial7.get(materialName) ?? 0) + value);
      }
      if (day >= todayIso && day <= addDays(todayIso, 14)) {
        reqByMaterial14.set(materialName, (reqByMaterial14.get(materialName) ?? 0) + value);
      }
      if (day >= rangeStart && day <= rangeEnd) {
        reqByMaterialSelected.set(materialName, (reqByMaterialSelected.get(materialName) ?? 0) + value);
      }
    }
  }

  const materials = Array.from(
    new Set([...Array.from(typeByMaterial.keys()), ...Array.from(reqByMaterialSelected.keys())])
  );
  const rows: PurchasingTableRow[] = [];
  for (const materialName of materials) {
    const materialType = typeByMaterial.get(materialName) ?? "unknown";
    const mappedCodes = Array.from(codeByMaterial.get(materialName) ?? []);
    let primary: PurchasingVendorItemRow | null = null;
    for (const code of mappedCodes) {
      const hit = primaryByCode.get(code);
      if (hit) {
        primary = hit;
        break;
      }
    }
    if (!primary) {
      const hit = primaryByName.get(`${materialType}__${materialName}`);
      if (hit) primary = hit;
    }
    const policy = policyFromRaw(primary?.order_policy);
    const safetyStock = policy === "on_demand" ? 0 : Number(primary?.safety_stock_g) || 0;
    const stock = Number((stockByMaterial.get(materialName) ?? 0).toFixed(2));
    const reqSelected = Number((reqByMaterialSelected.get(materialName) ?? 0).toFixed(2));
    const shortage = Number(Math.max(0, reqSelected + (policy === "normal" ? safetyStock : 0) - stock).toFixed(2));

    let shortageStartDate: string | null = null;
    const datePoints = datePointsByMaterial.get(materialName) ?? [];
    for (const point of datePoints) {
      if (point.date < rangeStart || point.date > rangeEnd) continue;
      const threshold = point.cumulative_required_g + (policy === "normal" ? safetyStock : 0);
      if (stock < threshold) {
        shortageStartDate = point.date;
        break;
      }
    }

    const leadTime = Number(primary?.lead_time_days) || 0;
    const orderDueDate = shortageStartDate ? addDays(shortageStartDate, -leadTime) : null;
    const recommendedOrderG = shortage;
    const unitWeight = primary?.purchase_unit_weight_g != null ? Number(primary.purchase_unit_weight_g) || 0 : 0;
    const recommendedUnits = unitWeight > 0 ? Math.ceil(recommendedOrderG / unitWeight) : null;

    const baseRow: PurchasingTableRow = {
      material_name: materialName,
      material_type: materialType,
      vendor_name: (primary?.vendor_name ?? "").trim() || "기본 공급처 미설정",
      has_primary_vendor: !!primary,
      stock_g: stock,
      safety_stock_g: Number(safetyStock.toFixed(2)),
      order_policy: policy,
      required_7d_g: Number((reqByMaterial7.get(materialName) ?? 0).toFixed(2)),
      required_14d_g: Number((reqByMaterial14.get(materialName) ?? 0).toFixed(2)),
      required_selected_g: reqSelected,
      shortage_g: shortage,
      shortage_start_date: shortageStartDate,
      lead_time_days: leadTime,
      order_due_date: orderDueDate,
      recommended_order_g: recommendedOrderG,
      recommended_order_units: recommendedUnits,
      purchase_unit_weight_g: unitWeight > 0 ? unitWeight : null,
      order_spec_label: primary?.order_spec_label ?? null,
      order_unit_name: primary?.purchase_unit_name ?? null,
      status: "safe",
      date_points: datePoints.filter((p) => p.date >= rangeStart && p.date <= rangeEnd),
      product_drivers: productDriversByMaterial.get(materialName) ?? [],
    };
    baseRow.status = statusFromRow(baseRow, todayIso);
    rows.push(baseRow);
  }

  return rows.sort((a, b) => {
    const statusRank: Record<PurchasingStatus, number> = { urgent: 0, warning: 1, scheduled: 2, safe: 3 };
    const sr = statusRank[a.status] - statusRank[b.status];
    if (sr !== 0) return sr;
    const sh = b.shortage_g - a.shortage_g;
    if (sh !== 0) return sh;
    return a.material_name.localeCompare(b.material_name);
  });
}

