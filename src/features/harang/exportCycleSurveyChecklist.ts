import { displayHarangProductName } from "@/features/harang/displayProductName";
import { fetchLotStockAsOfMap } from "@/features/harang/inventoryAsOf";
import {
  canonicalHarangMaterialName,
  resolveEquivalentRawMaterialIds,
} from "@/features/harang/materialAliases";
import { supabase } from "@/lib/supabase";
import {
  type CycleMaterialRow,
  type ProductionPickRow,
  formatLotDate,
  isLotInboundOnOrBefore,
  isParbakeMaterialName,
} from "@/features/harang/stockAdjustment";

export type CycleSurveyChecklistRow = {
  material_name: string;
  view_category: "parbake" | "raw_material";
  unit: string;
  lot_date: string;
  opening_stock: number;
  system_stock: number;
  /** 선택 생산 구간 조정 시 실사 입력이 필요한 LOT */
  adjustment_required: boolean;
};

function csvCell(value: string | number): string {
  const s = String(value ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLine(cells: Array<string | number>): string {
  return cells.map(csvCell).join(",");
}

function categoryLabel(view: "parbake" | "raw_material"): string {
  return view === "parbake" ? "파베이크" : "원부자재";
}

function displayUnit(itemName: string): string {
  return isParbakeMaterialName(itemName) ? "EA" : "g";
}

function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * 선택 생산(품목 BOM)에 필요한 원료·LOT만 포함.
 * - 조정 필수: 선택 생산에서 원장 usage 있는 소비기한 LOT (단, 실사일 이전 입고된 LOT만)
 * - 추가 포함: 동일 원료(별칭 item_id) 중 실사일 기준 입고 완료 + 잔량 > 0
 * - 시스템재고: 실사일 원장 역산 (재고현황 기준일과 동일)
 */
export async function fetchCycleSurveyChecklistRows(
  adjustmentDate: string,
  openingAsOfDate: string | null,
  materials: CycleMaterialRow[],
): Promise<CycleSurveyChecklistRow[]> {
  const surveyDate = adjustmentDate.slice(0, 10);
  const openingDate = openingAsOfDate?.slice(0, 10) ?? surveyDate;
  if (!surveyDate || materials.length === 0) return [];

  const neededItemIds = new Set<string>();
  for (const material of materials) {
    neededItemIds.add(material.material_id);
  }

  const [surveyAsOf, openingAsOf, rawMaterialsRes] = await Promise.all([
    fetchLotStockAsOfMap(surveyDate),
    fetchLotStockAsOfMap(openingDate),
    supabase.from("harang_raw_materials").select("id, item_name"),
  ]);
  if (rawMaterialsRes.error) throw rawMaterialsRes.error;

  const rawMaterials = rawMaterialsRes.data ?? [];
  for (const material of materials) {
    for (const id of Array.from(
      resolveEquivalentRawMaterialIds(
        material.material_name,
        material.material_id,
        rawMaterials,
      ),
    )) {
      neededItemIds.add(id);
    }
  }

  const lotsRes = await supabase
    .from("harang_inventory_lots")
    .select("id, item_id, item_name, lot_date, inbound_date")
    .eq("category", "raw_material")
    .in("item_id", Array.from(neededItemIds));
  if (lotsRes.error) throw lotsRes.error;

  const rows: CycleSurveyChecklistRow[] = [];

  for (const material of materials) {
    const displayName = canonicalHarangMaterialName(material.material_name);
    const equivIds = resolveEquivalentRawMaterialIds(
      material.material_name,
      material.material_id,
      rawMaterials,
    );

    const cycleByDate = new Map<
      string,
      { opening_stock: number; adjustment_required: boolean }
    >();
    for (const lot of material.lots) {
      if (lot.production_breakdown.length === 0) continue;
      cycleByDate.set(lot.lot_date, {
        opening_stock: lot.opening_stock,
        adjustment_required: true,
      });
    }

    /** 소비기한별 가장 이른 입고일 — 실사일 당시 창고에 있었는지 판단 */
    const earliestInboundByLotDate = new Map<string, string>();
    const stockByDate = new Map<string, { survey: number; opening: number }>();

    for (const lot of lotsRes.data ?? []) {
      if (!equivIds.has(String(lot.item_id))) continue;
      const lotDate = String(lot.lot_date ?? "");
      const inboundDate = String(lot.inbound_date ?? "");
      if (!lotDate.trim()) continue;

      const prevInbound = earliestInboundByLotDate.get(lotDate);
      if (!prevInbound || (inboundDate && inboundDate < prevInbound)) {
        earliestInboundByLotDate.set(lotDate, inboundDate);
      }

      if (!inboundDate || !isLotInboundOnOrBefore(surveyDate, inboundDate)) continue;

      const lotId = String(lot.id);
      const surveyQty = surveyAsOf?.get(lotId) ?? 0;
      const openingQty = openingAsOf?.get(lotId) ?? 0;
      const prev = stockByDate.get(lotDate) ?? { survey: 0, opening: 0 };
      stockByDate.set(lotDate, {
        survey: roundQty(prev.survey + surveyQty),
        opening: roundQty(prev.opening + openingQty),
      });
    }

    const isSurveyableLotDate = (lotDate: string): boolean => {
      const inbound = earliestInboundByLotDate.get(lotDate);
      return Boolean(inbound && isLotInboundOnOrBefore(surveyDate, inbound));
    };

    const lotDates = new Set<string>();
    for (const lotDate of Array.from(cycleByDate.keys())) {
      if (isSurveyableLotDate(lotDate)) lotDates.add(lotDate);
    }
    for (const [lotDate, stock] of Array.from(stockByDate.entries())) {
      if (stock.survey > 0 && isSurveyableLotDate(lotDate)) lotDates.add(lotDate);
    }

    for (const lotDate of Array.from(lotDates).sort()) {
      const cycle = cycleByDate.get(lotDate);
      const stock = stockByDate.get(lotDate) ?? { survey: 0, opening: 0 };
      const adjustmentRequired = Boolean(cycle?.adjustment_required && isSurveyableLotDate(lotDate));
      if (!adjustmentRequired && stock.survey <= 0) continue;

      rows.push({
        material_name: displayName,
        view_category: material.view_category,
        unit: material.unit || displayUnit(displayName),
        lot_date: formatLotDate(lotDate),
        opening_stock: cycle ? cycle.opening_stock : stock.opening,
        system_stock: stock.survey,
        adjustment_required: adjustmentRequired,
      });
    }
  }

  return rows.sort((a, b) => {
    const order = (v: "parbake" | "raw_material") => (v === "parbake" ? 0 : 1);
    const d = order(a.view_category) - order(b.view_category);
    if (d !== 0) return d;
    const nameCmp = a.material_name.localeCompare(b.material_name, "ko");
    if (nameCmp !== 0) return nameCmp;
    return a.lot_date.localeCompare(b.lot_date);
  });
}

export type CycleSurveyChecklistMeta = {
  productName: string;
  adjustmentDate: string;
  openingAsOfDate: string | null;
  selectedProduction: ProductionPickRow[];
  memo?: string;
};

export function buildCycleSurveyChecklistCsv(
  meta: CycleSurveyChecklistMeta,
  checklistRows: CycleSurveyChecklistRow[],
): string {
  const lines: string[] = [];
  const productLabel = displayHarangProductName(meta.productName);
  const requiredCount = checklistRows.filter((r) => r.adjustment_required).length;
  const materialCount = new Set(checklistRows.map((r) => r.material_name)).size;

  lines.push(csvLine(["실사 재고조사 체크리스트"]));
  lines.push(csvLine(["품목", productLabel]));
  lines.push(csvLine(["실사일(조정일)", meta.adjustmentDate]));
  if (meta.openingAsOfDate) {
    lines.push(csvLine(["구간시작재고 기준일", meta.openingAsOfDate]));
  }
  lines.push(csvLine(["선택 생산입고", `${meta.selectedProduction.length}건`]));
  lines.push(csvLine(["포함 원료", `${materialCount}종 (해당 품목 생산 BOM 기준)`]));
  lines.push(csvLine(["시스템재고 기준", `${meta.adjustmentDate} 포함 시점 원장 역산`]));
  if (meta.memo?.trim()) {
    lines.push(csvLine(["메모", meta.memo.trim()]));
  }

  if (meta.selectedProduction.length > 0) {
    lines.push("");
    lines.push(csvLine(["생산일", "생산입고 No.", "수량"]));
    for (const row of [...meta.selectedProduction].sort((a, b) =>
      a.production_date.localeCompare(b.production_date) || a.production_no.localeCompare(b.production_no),
    )) {
      lines.push(csvLine([row.production_date, row.production_no, row.finished_qty]));
    }
  }

  lines.push("");
  lines.push(
    csvLine([
      "No",
      "구분",
      "원료명",
      "단위",
      "소비기한(LOT)",
      "구간시작재고",
      "시스템재고",
      "실사수량",
      "조정필수",
    ]),
  );

  checklistRows.forEach((row, index) => {
    lines.push(
      csvLine([
        index + 1,
        categoryLabel(row.view_category),
        row.material_name,
        row.unit,
        row.lot_date,
        row.opening_stock,
        row.system_stock,
        "",
        row.adjustment_required ? "Y" : "",
      ]),
    );
  });

  lines.push("");
  lines.push(
    csvLine([
      `※ 실사일(${meta.adjustmentDate}) 이전 입고된 LOT만 포함합니다. 아직 입고 전인 소비기한은 제외됩니다.`,
    ]),
  );
  lines.push(
    csvLine([
      `※ 조정필수 Y = 선택 생산 구간 재고조정 입력 필수 (${requiredCount}건).`,
    ]),
  );

  return lines.join("\r\n");
}

function safeFilenamePart(raw: string): string {
  return raw.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").slice(0, 40);
}

export function downloadCycleSurveyChecklistCsv(
  meta: CycleSurveyChecklistMeta,
  checklistRows: CycleSurveyChecklistRow[],
): void {
  const csv = buildCycleSurveyChecklistCsv(meta, checklistRows);
  const datePart = meta.adjustmentDate.slice(0, 10);
  const productPart = safeFilenamePart(displayHarangProductName(meta.productName) || meta.productName);
  const filename = `실사재고조사_${productPart}_${datePart}.csv`;

  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
