import type { HarangCategory } from "@/features/harang/types";
import { supabase } from "@/lib/supabase";

export type StockAdjustmentType = "production_cycle" | "packaging";
export type StockAdjustmentStatus = "draft" | "confirmed";

export type StockAdjustmentSessionRow = {
  id: string;
  adjustment_type: StockAdjustmentType;
  adjustment_date: string;
  product_name: string | null;
  status: StockAdjustmentStatus;
  wizard_step: number;
  memo: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
};

export type ProductionPickRow = {
  id: string;
  production_date: string;
  production_no: string;
  product_name: string;
  finished_qty: number;
  locked: boolean;
};

/** 선택 생산입고 1건에서 해당 소비기한 LOT로 차감된 사용량 */
export type CycleLotProductionRow = {
  production_header_id: string;
  production_date: string;
  production_no: string;
  finished_qty: number;
  bom_qty: number;
  /** 원장(입출고 이력) usage 합 — 실사·조정 계산 기준 */
  system_usage: number;
  /** production_line_lots quantity_used — 참고(원장과 불일치할 수 있음) */
  line_lot_usage: number;
};

type LedgerUsageTx = {
  lot_id: string;
  tx_date: string;
  reference_no: string | null;
  quantity_delta: number;
  category: string;
  item_id: string;
};

type ProductionHeaderLedgerMeta = {
  production_date: string;
  production_no: string;
  request_no: string | null;
};

/** 생산입고 1건·LOT별 원장 usage 합 (line_lots 없이 원장만 있어도 집계) */
export function ledgerUsageForProductionHeader(
  header: ProductionHeaderLedgerMeta,
  category: HarangCategory,
  itemId: string,
  lotId: string,
  txs: LedgerUsageTx[],
): number {
  const prodDate = header.production_date.slice(0, 10);
  let sum = 0;
  for (const tx of txs) {
    if (String(tx.category) !== category || String(tx.item_id) !== itemId) continue;
    if (String(tx.lot_id) !== lotId) continue;
    if (String(tx.tx_date).slice(0, 10) !== prodDate) continue;
    const ref = String(tx.reference_no ?? "");
    const matches =
      ref === header.production_no ||
      (header.request_no != null && header.request_no !== "" && ref === header.request_no);
    if (!matches) continue;
    const delta = Number(tx.quantity_delta ?? 0);
    if (delta < 0) sum += -delta;
  }
  return Math.round(sum * 1000) / 1000;
}

export type CycleLotConstituent = {
  lot_id: string;
  /** 소비기한 — 시리얼 LOT 식별자 */
  lot_date: string;
  inbound_date: string;
  inbound_no: string | null;
  initial_quantity: number;
  /** line_lots quantity_used */
  line_lot_usage_in_selection: number;
  /** 레시피 BOM 배분 */
  bom_usage_in_selection: number;
  system_stock: number;
  current_stock: number;
};

/** 소비기한(lot_date) 단위 — 동일 소비기한 입고가 여러 건이면 constituents에 묶임 */
export type CycleLotRow = {
  serial_key: string;
  lot_date: string;
  /** 동일 소비기한의 입고 LOT 건수 */
  inbound_count: number;
  /** 입고 수량 합계 (실사용량 역산용) */
  initial_quantity: number;
  /** line_lots quantity_used 합 — LOT 차감·분배 가중치 */
  line_lot_usage_in_selection: number;
  /** 레시피 BOM(생산수량×중량) — 원료 합계를 LOT 차감 비율로 배분 */
  bom_usage_in_selection: number;
  /** 입고합 − 선택구간 BOM (레거시·표시용) */
  system_stock: number;
  /** 원장 현재고 합계 */
  current_stock: number;
  /** 구간 시작 재고 = 선택 생산 첫일 전날 원장 잔량 합계 */
  opening_stock: number;
  constituents: CycleLotConstituent[];
  /** 선택 생산입고별 LOT 사용 내역 */
  production_breakdown: CycleLotProductionRow[];
};

export type CycleMaterialRow = {
  materialKey: string;
  material_category: HarangCategory;
  material_id: string;
  material_name: string;
  unit: string;
  view_category: "parbake" | "raw_material";
  /** LOT 합계 — 조정일(실사일) 기준 시스템 재고 */
  system_stock: number;
  /** LOT별 line_lots quantity_used 합 — 분배 가중치용 */
  line_lot_usage_in_selection: number;
  /** 선택 생산입고 production_lines.bom_qty 합 — BOM(생산수량×레시피) */
  bom_usage_in_selection: number;
  /** @deprecated bom_usage_in_selection 과 동일 — 하위 호환 */
  bom_qty_in_selection: number;
  lots: CycleLotRow[];
};

export type CycleMaterialsResult = {
  /** 조정일(실사일) */
  asOfDate: string;
  /** 구간 시작 재고 기준일 = 선택 생산 첫일 전날 */
  openingAsOfDate: string;
  materials: CycleMaterialRow[];
};

export function isParbakeMaterialName(name: string): boolean {
  return name.replace(/\s/g, "").includes("파베이크도우");
}

export function materialRowKey(category: HarangCategory, itemId: string): string {
  return `${category}:${itemId}`;
}

export function formatLotDate(isoDate: string): string {
  if (!isoDate) return "";
  return isoDate.slice(0, 10).replaceAll("-", ".");
}

export function serialLotKey(materialKey: string, lotDate: string): string {
  return `${materialKey}|${lotDate}`;
}

/** 실사일(포함) 당시 이미 입고된 LOT만 조정 대상 */
export function isLotInboundOnOrBefore(asOfDate: string, inboundDate: string): boolean {
  const asOf = asOfDate.slice(0, 10);
  const inbound = inboundDate.slice(0, 10);
  if (!asOf || !inbound) return false;
  return inbound <= asOf;
}

/** 소비기한 기준 시스템 재고 = 원장 현재고 (선택 구간만 조정할 때도 타당) */
export function computeCycleSystemStock(currentStockSum: number): number {
  return Math.round(currentStockSum * 1000) / 1000;
}

/** ISO 날짜(YYYY-MM-DD) 하루 전 */
export function dayBeforeIsoDate(date: string): string {
  const cut = date.slice(0, 10);
  if (!cut) return "";
  const d = new Date(`${cut}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** 선택 생산입고 중 가장 이른 생산일 */
export function earliestProductionDate(dates: string[]): string {
  let min = "";
  for (const raw of dates) {
    const d = raw.slice(0, 10);
    if (!d) continue;
    if (!min || d < min) min = d;
  }
  return min;
}

/** 소비기한 LOT별 BOM = 이 LOT를 쓴 생산입고 bom_qty 합 (생산×레시피) */
export function sumBreakdownBomQty(breakdown: CycleLotProductionRow[]): number {
  return Math.round(breakdown.reduce((s, p) => s + p.bom_qty, 0) * 1000) / 1000;
}

/** 소비기한 LOT별 line_lots 차감 합 */
export function sumBreakdownLineUsage(breakdown: CycleLotProductionRow[]): number {
  return Math.round(
    breakdown.reduce((s, p) => s + (p.line_lot_usage ?? p.system_usage), 0) * 1000,
  ) / 1000;
}

/** 실사 기준 구간 사용량 = 구간 시작 재고 − 실사 잔량 (+ 실사일 이후 사용) */
export function computeCycleActualUsageFromPhysical(
  openingStockSum: number,
  physical: number | null,
  usageAfterAdjustmentDate = 0,
): number | null {
  if (physical === null) return null;
  return Math.round((openingStockSum - physical + usageAfterAdjustmentDate) * 1000) / 1000;
}

/** 실재고 기준 총 사용량 = 입고 합계 − 실사일 잔량 + 실사일 이후 사용량 */
export function computeActualUsageFromPhysical(
  inboundQuantitySum: number,
  physical: number | null,
  usageAfterAdjustmentDate = 0,
): number | null {
  if (physical === null) return null;
  return Math.round((inboundQuantitySum - physical + usageAfterAdjustmentDate) * 1000) / 1000;
}

/** 선택 생산입고 중 실사일 이후 해당 LOT 사용 합계 (미리보기·배분용) */
export function sumLotUsageAfterAdjustmentDate(
  breakdown: Array<{ production_date: string; system_usage: number }>,
  adjustmentDate: string,
): number {
  const cut = adjustmentDate.slice(0, 10);
  let sum = 0;
  for (const row of breakdown) {
    if (String(row.production_date).slice(0, 10) > cut) {
      sum += Number(row.system_usage ?? 0);
    }
  }
  return Math.round(sum * 1000) / 1000;
}

/** 실사 수량을 입고 LOT별로 분배 (확정·임시저장용) */
export function splitPhysicalAcrossConstituents(
  physical: number,
  constituents: Array<{ lot_id: string; system_stock: number; current_stock: number; initial_quantity: number }>,
): Array<{ lot_id: string; physical_qty: number }> {
  if (constituents.length === 0) return [];
  if (constituents.length === 1) {
    return [{ lot_id: constituents[0]!.lot_id, physical_qty: physical }];
  }

  const weighted = constituents.map((c) => ({
    ...c,
    weight: c.system_stock > 0 ? c.system_stock : c.initial_quantity > 0 ? c.initial_quantity : c.current_stock,
  }));
  const totalWeight = weighted.reduce((s, c) => s + c.weight, 0);
  const sorted = [...weighted].sort((a, b) => a.lot_id.localeCompare(b.lot_id));

  if (totalWeight <= 0) {
    let assigned = 0;
    return sorted.map((c, i) => {
      if (i === sorted.length - 1) {
        return {
          lot_id: c.lot_id,
          physical_qty: Math.round((physical - assigned) * 1000) / 1000,
        };
      }
      const part = Math.round((physical / sorted.length) * 1000) / 1000;
      assigned += part;
      return { lot_id: c.lot_id, physical_qty: part };
    });
  }

  let assigned = 0;
  return sorted.map((c, i) => {
    if (i === sorted.length - 1) {
      return {
        lot_id: c.lot_id,
        physical_qty: Math.round((physical - assigned) * 1000) / 1000,
      };
    }
    const part = Math.round(((physical * c.weight) / totalWeight) * 1000) / 1000;
    assigned += part;
    return { lot_id: c.lot_id, physical_qty: part };
  });
}

/** DB에 저장된 LOT별 실사 → 소비기한 단위 합산 */
export function aggregatePhysicalBySerialLot(
  lotPhysical: Array<{ lot_id: string; physical_qty: number }>,
  materials: CycleMaterialRow[],
): Record<string, string> {
  const byLotId = new Map(lotPhysical.map((r) => [r.lot_id, r.physical_qty]));
  const out: Record<string, string> = {};
  for (const m of materials) {
    for (const lot of m.lots) {
      const sum = lot.constituents.reduce((s, c) => s + (byLotId.get(c.lot_id) ?? 0), 0);
      if (lot.constituents.some((c) => byLotId.has(c.lot_id))) {
        out[lot.serial_key] = String(Math.round(sum * 1000) / 1000);
      }
    }
  }
  return out;
}

/** 실사일(포함) 기준 LOT별 시스템 재고 = 원장 quantity_delta 합산 */
export async function fetchLedgerLotStockAsOf(asOfDate: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();

  const rpc = await supabase.rpc("harang_inventory_stock_as_of_lot", { p_as_of_date: asOfDate });
  if (!rpc.error && rpc.data) {
    for (const row of rpc.data as Array<{ lot_id: string; stock_qty: number }>) {
      out.set(String(row.lot_id), Number(row.stock_qty ?? 0));
    }
    return out;
  }

  const [lotsRes, prodUsageRes, txRes] = await Promise.all([
    supabase.from("harang_inventory_lots").select("id, current_quantity"),
    supabase
      .from("harang_production_line_lots")
      .select(
        `
        lot_id,
        quantity_used,
        lines:line_id(
          headers:header_id(production_date)
        )
      `,
      ),
    supabase
      .from("harang_inventory_transactions")
      .select("lot_id, quantity_delta, tx_type")
      .gt("tx_date", asOfDate)
      .not("lot_id", "is", null),
  ]);
  if (lotsRes.error) throw lotsRes.error;
  if (prodUsageRes.error) throw prodUsageRes.error;
  if (txRes.error) throw txRes.error;

  const currentByLot = new Map<string, number>();
  for (const lot of lotsRes.data ?? []) {
    currentByLot.set(String(lot.id), Number(lot.current_quantity ?? 0));
  }

  const prodUsageAfterByLot = new Map<string, number>();
  for (const row of prodUsageRes.data ?? []) {
    const lines = row.lines as
      | { headers?: { production_date?: string } | { production_date?: string }[] }
      | { headers?: { production_date?: string } | { production_date?: string }[] }[]
      | null;
    const line = Array.isArray(lines) ? lines[0] : lines;
    const headers = line?.headers;
    const header = Array.isArray(headers) ? headers[0] : headers;
    const prodDate = String(header?.production_date ?? "");
    if (!prodDate || prodDate <= asOfDate) continue;
    const lotId = String(row.lot_id);
    prodUsageAfterByLot.set(lotId, (prodUsageAfterByLot.get(lotId) ?? 0) + Number(row.quantity_used ?? 0));
  }

  const txAfterByLot = new Map<string, number>();
  const usageTxAfterByLot = new Map<string, number>();
  for (const tx of txRes.data ?? []) {
    if (!tx.lot_id) continue;
    const lotId = String(tx.lot_id);
    const delta = Number(tx.quantity_delta ?? 0);
    txAfterByLot.set(lotId, (txAfterByLot.get(lotId) ?? 0) + delta);
    if (tx.tx_type === "usage" && delta < 0) {
      usageTxAfterByLot.set(lotId, (usageTxAfterByLot.get(lotId) ?? 0) - delta);
    }
  }

  const keys = new Set([
    ...Array.from(currentByLot.keys()),
    ...Array.from(prodUsageAfterByLot.keys()),
    ...Array.from(txAfterByLot.keys()),
  ]);
  for (const lotId of Array.from(keys)) {
    const missingProdUsage = Math.max(
      0,
      (prodUsageAfterByLot.get(lotId) ?? 0) - (usageTxAfterByLot.get(lotId) ?? 0),
    );
    out.set(
      lotId,
      (currentByLot.get(lotId) ?? 0) - (txAfterByLot.get(lotId) ?? 0) + missingProdUsage,
    );
  }
  return out;
}

/** 실사일(포함) 기준 시스템 재고 — LOT 잔량 + 생산입고 LOT 차감 역산 (입출고 이력 누락 보정) */
export async function fetchLedgerStockAsOf(asOfDate: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();

  const rpc = await supabase.rpc("harang_inventory_stock_as_of", { p_as_of_date: asOfDate });
  if (!rpc.error && rpc.data) {
    for (const row of rpc.data as Array<{ category: string; item_id: string; stock_qty: number }>) {
      const key = materialRowKey(row.category as HarangCategory, String(row.item_id));
      out.set(key, Number(row.stock_qty ?? 0));
    }
    return out;
  }

  const [lotsRes, prodUsageRes, txRes] = await Promise.all([
    supabase.from("harang_inventory_lots").select("category, item_id, current_quantity"),
    supabase
      .from("harang_production_line_lots")
      .select(
        `
        quantity_used,
        lines:line_id(
          material_category,
          material_id,
          headers:header_id(production_date)
        )
      `,
      ),
    supabase
      .from("harang_inventory_transactions")
      .select("category, item_id, quantity_delta, tx_type")
      .gt("tx_date", asOfDate),
  ]);
  if (lotsRes.error) throw lotsRes.error;
  if (prodUsageRes.error) throw prodUsageRes.error;
  if (txRes.error) throw txRes.error;

  const currentByKey = new Map<string, number>();
  for (const lot of lotsRes.data ?? []) {
    const key = materialRowKey(lot.category as HarangCategory, String(lot.item_id));
    currentByKey.set(key, (currentByKey.get(key) ?? 0) + Number(lot.current_quantity ?? 0));
  }

  const prodUsageAfterByKey = new Map<string, number>();
  for (const row of prodUsageRes.data ?? []) {
    const lines = row.lines as
      | {
          material_category?: string;
          material_id?: string;
          headers?: { production_date?: string } | { production_date?: string }[];
        }
      | {
          material_category?: string;
          material_id?: string;
          headers?: { production_date?: string } | { production_date?: string }[];
        }[]
      | null;
    const line = Array.isArray(lines) ? lines[0] : lines;
    if (!line?.material_category || !line.material_id) continue;
    const headers = line.headers;
    const header = Array.isArray(headers) ? headers[0] : headers;
    const prodDate = String(header?.production_date ?? "");
    if (!prodDate || prodDate <= asOfDate) continue;
    const key = materialRowKey(line.material_category as HarangCategory, String(line.material_id));
    prodUsageAfterByKey.set(key, (prodUsageAfterByKey.get(key) ?? 0) + Number(row.quantity_used ?? 0));
  }

  const txAfterByKey = new Map<string, number>();
  const usageTxAfterByKey = new Map<string, number>();
  for (const tx of txRes.data ?? []) {
    const key = materialRowKey(tx.category as HarangCategory, String(tx.item_id));
    const delta = Number(tx.quantity_delta ?? 0);
    txAfterByKey.set(key, (txAfterByKey.get(key) ?? 0) + delta);
    if (tx.tx_type === "usage" && delta < 0) {
      usageTxAfterByKey.set(key, (usageTxAfterByKey.get(key) ?? 0) - delta);
    }
  }

  const keys = new Set([
    ...Array.from(currentByKey.keys()),
    ...Array.from(prodUsageAfterByKey.keys()),
    ...Array.from(txAfterByKey.keys()),
  ]);
  for (const key of Array.from(keys)) {
    const missingProdUsage = Math.max(
      0,
      (prodUsageAfterByKey.get(key) ?? 0) - (usageTxAfterByKey.get(key) ?? 0),
    );
    const stock =
      (currentByKey.get(key) ?? 0) - (txAfterByKey.get(key) ?? 0) + missingProdUsage;
    out.set(key, stock);
  }
  return out;
}

export async function fetchProductNamesFromProduction(): Promise<string[]> {
  const { data, error } = await supabase.from("harang_production_headers").select("product_name");
  if (error) throw error;
  const names = new Set<string>();
  for (const row of data ?? []) {
    const name = String(row.product_name ?? "").trim();
    if (name) names.add(name);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b, "ko"));
}

export async function fetchLockedProductionHeaderIds(): Promise<Set<string>> {
  const { data: sessions, error: sErr } = await supabase
    .from("harang_stock_adjustment_sessions")
    .select("id")
    .eq("status", "confirmed")
    .eq("adjustment_type", "production_cycle");
  if (sErr) throw sErr;
  const sessionIds = (sessions ?? []).map((s) => String(s.id));
  if (sessionIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from("harang_stock_adjustment_production_targets")
    .select("production_header_id")
    .in("session_id", sessionIds);
  if (error) throw error;
  return new Set((data ?? []).map((r) => String(r.production_header_id)));
}

export async function fetchLastConfirmedAdjustmentDate(productName: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("harang_stock_adjustment_sessions")
    .select("adjustment_date")
    .eq("adjustment_type", "production_cycle")
    .eq("status", "confirmed")
    .eq("product_name", productName)
    .order("adjustment_date", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.adjustment_date ? String(data[0].adjustment_date) : null;
}

export async function fetchProductionHeadersForProduct(productName: string): Promise<ProductionPickRow[]> {
  const [headersRes, locked] = await Promise.all([
    supabase
      .from("harang_production_headers")
      .select("id, production_date, production_no, product_name, finished_qty")
      .eq("product_name", productName)
      .order("production_date", { ascending: false })
      .order("created_at", { ascending: false }),
    fetchLockedProductionHeaderIds(),
  ]);
  if (headersRes.error) throw headersRes.error;
  return (headersRes.data ?? []).map((row) => ({
    id: String(row.id),
    production_date: String(row.production_date),
    production_no: String(row.production_no),
    product_name: String(row.product_name),
    finished_qty: Number(row.finished_qty ?? 0),
    locked: locked.has(String(row.id)),
  }));
}

export function defaultSelectedHeaderIds(
  rows: ProductionPickRow[],
  lastConfirmedDate: string | null,
): Set<string> {
  const eligible = rows.filter((r) => !r.locked);
  if (eligible.length === 0) return new Set();
  if (!lastConfirmedDate) {
    return new Set(eligible.map((r) => r.id));
  }
  return new Set(
    eligible.filter((r) => r.production_date >= lastConfirmedDate).map((r) => r.id),
  );
}

export async function fetchCycleMaterialsForHeaders(
  headerIds: string[],
  asOfDate: string,
): Promise<CycleMaterialsResult> {
  if (headerIds.length === 0) return { asOfDate, openingAsOfDate: asOfDate, materials: [] };
  if (!asOfDate.trim()) {
    throw new Error("조정일(실사일)이 필요합니다.");
  }

  const [linesRes, lotsRes, headersRes] = await Promise.all([
    supabase
      .from("harang_production_lines")
      .select("id, material_category, material_id, material_name, unit, usage_qty, bom_qty, header_id")
      .in("header_id", headerIds),
    supabase
      .from("harang_inventory_lots")
      .select(
        `
        id, category, item_id, lot_date, current_quantity, inbound_date, initial_quantity,
        headers:source_header_id(inbound_no)
      `,
      ),
    supabase
      .from("harang_production_headers")
      .select("id, production_date, production_no, request_id")
      .in("id", headerIds),
  ]);
  if (linesRes.error) throw linesRes.error;
  if (lotsRes.error) throw lotsRes.error;
  if (headersRes.error) throw headersRes.error;

  const requestIds = Array.from(
    new Set(
      (headersRes.data ?? [])
        .map((row) => (row.request_id ? String(row.request_id) : ""))
        .filter(Boolean),
    ),
  );
  const requestsRes =
    requestIds.length > 0
      ? await supabase.from("harang_production_requests").select("id, request_no").in("id", requestIds)
      : { data: [] as Array<{ id: string; request_no: string }>, error: null };
  if (requestsRes.error) throw requestsRes.error;

  const requestNoById = new Map(
    (requestsRes.data ?? []).map((row) => [String(row.id), String(row.request_no ?? "")]),
  );
  const headerMetaById = new Map<string, ProductionHeaderLedgerMeta>();
  const ledgerRefNos = new Set<string>();
  for (const row of headersRes.data ?? []) {
    const id = String(row.id);
    const productionNo = String(row.production_no ?? "");
    const requestNo = row.request_id ? requestNoById.get(String(row.request_id)) ?? null : null;
    headerMetaById.set(id, {
      production_date: String(row.production_date ?? ""),
      production_no: productionNo,
      request_no: requestNo,
    });
    if (productionNo) ledgerRefNos.add(productionNo);
    if (requestNo) ledgerRefNos.add(requestNo);
  }

  const ledgerTxsRes =
    ledgerRefNos.size > 0
      ? await supabase
          .from("harang_inventory_transactions")
          .select("lot_id, tx_date, reference_no, quantity_delta, tx_type, category, item_id")
          .eq("tx_type", "usage")
          .in("reference_no", Array.from(ledgerRefNos))
      : {
          data: [] as Array<{
            lot_id: string;
            tx_date: string;
            reference_no: string | null;
            quantity_delta: number;
            tx_type: string;
            category: string;
            item_id: string;
          }>,
          error: null,
        };
  if (ledgerTxsRes.error) throw ledgerTxsRes.error;
  const ledgerTxs = (ledgerTxsRes.data ?? []) as LedgerUsageTx[];

  const firstProductionDate = earliestProductionDate(
    (headersRes.data ?? []).map((row) => String(row.production_date ?? "")),
  );
  const openingAsOfDate = firstProductionDate
    ? dayBeforeIsoDate(firstProductionDate)
    : asOfDate.slice(0, 10);
  const [openingStockByLot, surveyStockByLot] = await Promise.all([
    fetchLedgerLotStockAsOf(openingAsOfDate),
    fetchLedgerLotStockAsOf(asOfDate.slice(0, 10)),
  ]);

  const lineIds = (linesRes.data ?? []).map((row) => String(row.id));
  const lineLotsRes =
    lineIds.length > 0
      ? await supabase
          .from("harang_production_line_lots")
          .select(
            `
            line_id, lot_id, quantity_used,
            lines:line_id(
              bom_qty, material_category, material_id,
              headers:header_id(id, production_date, production_no, finished_qty)
            )
          `,
          )
          .in("line_id", lineIds)
      : { data: [], error: null };
  if (lineLotsRes.error) throw lineLotsRes.error;

  const lineById = new Map(
    (linesRes.data ?? []).map((row) => [
      String(row.id),
      {
        material_category: row.material_category as HarangCategory,
        material_id: String(row.material_id),
        material_name: String(row.material_name),
        unit: String(row.unit),
        bom_qty: Number(row.bom_qty ?? 0),
        header_id: String(row.header_id),
      },
    ]),
  );

  type BreakdownAgg = CycleLotProductionRow;
  const productionBySerial = new Map<string, Map<string, BreakdownAgg>>();

  const lotMetaById = new Map<
    string,
    {
      category: HarangCategory;
      item_id: string;
      lot_date: string;
      current_quantity: number;
      initial_quantity: number;
      inbound_date: string;
      inbound_no: string | null;
    }
  >();
  for (const lot of lotsRes.data ?? []) {
    const headers = lot.headers as { inbound_no?: string } | { inbound_no?: string }[] | null;
    const header = Array.isArray(headers) ? headers[0] : headers;
    lotMetaById.set(String(lot.id), {
      category: lot.category as HarangCategory,
      item_id: String(lot.item_id),
      lot_date: String(lot.lot_date),
      current_quantity: Number(lot.current_quantity ?? 0),
      initial_quantity: Number(lot.initial_quantity ?? 0),
      inbound_date: String(lot.inbound_date ?? ""),
      inbound_no: header?.inbound_no ? String(header.inbound_no) : null,
    });
  }

  const usageByKey = new Map<
    string,
    {
      material_category: HarangCategory;
      material_id: string;
      material_name: string;
      unit: string;
      usage: number;
    }
  >();

  const lotUsageByMaterialKey = new Map<string, Map<string, number>>();
  const bomQtyByMaterialKey = new Map<string, number>();

  for (const line of linesRes.data ?? []) {
    if (line.material_category === "packaging_material") continue;
    const category = line.material_category as HarangCategory;
    const materialId = String(line.material_id);
    const key = materialRowKey(category, materialId);
    bomQtyByMaterialKey.set(key, (bomQtyByMaterialKey.get(key) ?? 0) + Number(line.bom_qty ?? 0));
  }

  for (const line of linesRes.data ?? []) {
    if (line.material_category === "packaging_material") continue;
    const category = line.material_category as HarangCategory;
    const materialId = String(line.material_id);
    const key = materialRowKey(category, materialId);
    const prev = usageByKey.get(key) ?? {
      material_category: category,
      material_id: materialId,
      material_name: String(line.material_name),
      unit: String(line.unit),
      usage: 0,
    };
    prev.usage += Number(line.usage_qty ?? 0);
    usageByKey.set(key, prev);
  }

  for (const row of lineLotsRes.data ?? []) {
    const line = lineById.get(String(row.line_id));
    if (!line) continue;
    const lotMeta = lotMetaById.get(String(row.lot_id));
    if (!lotMeta?.lot_date?.trim()) continue;
    const key = materialRowKey(line.material_category, line.material_id);
    const serialKey = serialLotKey(key, lotMeta.lot_date);
    const lineLotQty = Number(row.quantity_used ?? 0);
    if (lineLotQty <= 0) continue;

    const lotId = String(row.lot_id);

    const nestedLines = row.lines as
      | {
          bom_qty?: number;
          material_category?: string;
          material_id?: string;
          headers?: {
            id?: string;
            production_date?: string;
            production_no?: string;
            finished_qty?: number;
          } | {
            id?: string;
            production_date?: string;
            production_no?: string;
            finished_qty?: number;
          }[];
        }
      | {
          bom_qty?: number;
          material_category?: string;
          material_id?: string;
          headers?: {
            id?: string;
            production_date?: string;
            production_no?: string;
            finished_qty?: number;
          } | {
            id?: string;
            production_date?: string;
            production_no?: string;
            finished_qty?: number;
          }[];
        }[]
      | null;
    const nestedLine = Array.isArray(nestedLines) ? nestedLines[0] : nestedLines;
    const headers = nestedLine?.headers;
    const header = Array.isArray(headers) ? headers[0] : headers;
    const headerId = header?.id ? String(header.id) : line.header_id;
    if (!headerId) continue;

    const headerMeta = headerMetaById.get(headerId);
    if (!headerMeta) continue;

    const ledgerQty = ledgerUsageForProductionHeader(
      headerMeta,
      line.material_category,
      line.material_id,
      lotId,
      ledgerTxs,
    );
    // 원장에 없는 line_lots(유령 LOT·재고조정 오염)는 실사 대상에서 제외
    if (ledgerQty <= 0) continue;

    const byLot = lotUsageByMaterialKey.get(key) ?? new Map<string, number>();
    byLot.set(lotId, (byLot.get(lotId) ?? 0) + lineLotQty);
    lotUsageByMaterialKey.set(key, byLot);

    const byHeader = productionBySerial.get(serialKey) ?? new Map<string, BreakdownAgg>();
    const prev = byHeader.get(headerId);
    const bomQty = Number(nestedLine?.bom_qty ?? line.bom_qty ?? 0);
    if (prev) {
      prev.system_usage = Math.round((prev.system_usage + ledgerQty) * 1000) / 1000;
      prev.line_lot_usage = Math.round((prev.line_lot_usage + lineLotQty) * 1000) / 1000;
    } else {
      byHeader.set(headerId, {
        production_header_id: headerId,
        production_date: String(header?.production_date ?? ""),
        production_no: String(header?.production_no ?? ""),
        finished_qty: Number(header?.finished_qty ?? 0),
        bom_qty: bomQty,
        system_usage: ledgerQty,
        line_lot_usage: lineLotQty,
      });
    }
    productionBySerial.set(serialKey, byHeader);
  }

  const materials = Array.from(usageByKey.entries())
    .map(([materialKey, row]) => {
      const usageByLot = lotUsageByMaterialKey.get(materialKey);
      const lotIds = new Set<string>();

      // 선택 생산입고에서 실제 차감된 LOT만 실사 대상
      if (usageByLot) {
        for (const lotId of Array.from(usageByLot.keys())) {
          lotIds.add(lotId);
        }
      }

      const rawLots: CycleLotConstituent[] = Array.from(lotIds)
        .map((lotId) => {
          const meta = lotMetaById.get(lotId);
          if (!meta) return null;
          const bomUsage = usageByLot?.get(lotId) ?? 0;
          const usedInSelection = bomUsage > 0;
          if (!usedInSelection && !isLotInboundOnOrBefore(asOfDate, meta.inbound_date)) return null;
          if (!meta.lot_date?.trim()) return null;
          if (meta.initial_quantity <= 0 && bomUsage <= 0) return null;
          const currentStock = surveyStockByLot.get(lotId) ?? 0;
          const systemStock = computeCycleSystemStock(currentStock);
          return {
            lot_id: lotId,
            lot_date: meta.lot_date,
            inbound_date: meta.inbound_date,
            inbound_no: meta.inbound_no,
            initial_quantity: meta.initial_quantity,
            line_lot_usage_in_selection: bomUsage,
            bom_usage_in_selection: 0,
            system_stock: systemStock,
            current_stock: currentStock,
          };
        })
        .filter((lot): lot is CycleLotConstituent => lot !== null);

      const byLotDate = new Map<string, CycleLotConstituent[]>();
      for (const c of rawLots) {
        const list = byLotDate.get(c.lot_date) ?? [];
        list.push(c);
        byLotDate.set(c.lot_date, list);
      }

      // 선택 구간에서 사용됐으나 위 필터에서 빠진 소비기한 — production_line_lots 기준으로 보강
      const materialSerialPrefix = `${materialKey}|`;
      for (const [sk] of Array.from(productionBySerial.entries())) {
        if (!sk.startsWith(materialSerialPrefix)) continue;
        const lotDate = sk.slice(materialSerialPrefix.length);
        if (byLotDate.has(lotDate)) continue;

        const constituents: CycleLotConstituent[] = [];
        for (const lotId of Array.from(lotIds)) {
          const meta = lotMetaById.get(lotId);
          if (!meta || meta.lot_date !== lotDate) continue;
          const bomUsage = usageByLot?.get(lotId) ?? 0;
          if (bomUsage <= 0) continue;
          constituents.push({
            lot_id: lotId,
            lot_date: meta.lot_date,
            inbound_date: meta.inbound_date,
            inbound_no: meta.inbound_no,
            initial_quantity: meta.initial_quantity,
            line_lot_usage_in_selection: bomUsage,
            bom_usage_in_selection: 0,
            system_stock: computeCycleSystemStock(surveyStockByLot.get(lotId) ?? 0),
            current_stock: surveyStockByLot.get(lotId) ?? 0,
          });
        }
        if (constituents.length > 0) {
          byLotDate.set(lotDate, constituents);
        }
      }

      const lots: CycleLotRow[] = Array.from(byLotDate.entries())
        .map(([lotDate, constituents]) => {
          const sorted = [...constituents].sort(
            (a, b) =>
              a.inbound_date.localeCompare(b.inbound_date) || a.lot_id.localeCompare(b.lot_id),
          );
          const sk = serialLotKey(materialKey, lotDate);
          const breakdown = Array.from(productionBySerial.get(sk)?.values() ?? []).sort((a, b) => {
            const d = a.production_date.localeCompare(b.production_date);
            if (d !== 0) return d;
            return a.production_no.localeCompare(b.production_no);
          });
          if (breakdown.length === 0) return null;
          const inScope = sorted.filter((c) => isLotInboundOnOrBefore(asOfDate, c.inbound_date));
          if (inScope.length === 0) return null;
          const bomFromBreakdown = sumBreakdownBomQty(breakdown);
          const lineLotFromBreakdown = sumBreakdownLineUsage(breakdown);
          const inboundSum = inScope.reduce((s, c) => s + c.initial_quantity, 0);
          const currentSum = inScope.reduce((s, c) => s + c.current_stock, 0);
          const openingSum = inScope.reduce(
            (s, c) => s + (openingStockByLot.get(c.lot_id) ?? 0),
            0,
          );
          return {
            serial_key: sk,
            lot_date: lotDate,
            inbound_count: inScope.length,
            initial_quantity: inboundSum,
            line_lot_usage_in_selection: lineLotFromBreakdown,
            bom_usage_in_selection: bomFromBreakdown,
            system_stock: computeCycleSystemStock(currentSum),
            current_stock: currentSum,
            opening_stock: computeCycleSystemStock(openingSum),
            constituents: inScope,
            production_breakdown: breakdown,
          };
        })
        .filter((lot): lot is CycleLotRow => lot !== null)
        .sort((a, b) => a.lot_date.localeCompare(b.lot_date) || a.serial_key.localeCompare(b.serial_key));

      const systemStock = lots.reduce((s, lot) => s + lot.system_stock, 0);
      const lineLotInScope = lots.reduce((s, lot) => s + lot.line_lot_usage_in_selection, 0);
      const materialBom = bomQtyByMaterialKey.get(materialKey) ?? 0;

      return {
        materialKey,
        material_category: row.material_category,
        material_id: row.material_id,
        material_name: row.material_name,
        unit: row.unit,
        view_category: (isParbakeMaterialName(row.material_name) ? "parbake" : "raw_material") as
          | "parbake"
          | "raw_material",
        system_stock: systemStock,
        line_lot_usage_in_selection: lineLotInScope,
        bom_usage_in_selection: materialBom,
        bom_qty_in_selection: materialBom,
        lots,
      };
    })
    .filter((m) => m.lots.length > 0)
    .sort((a, b) => {
      const order = (v: CycleMaterialRow["view_category"]) => (v === "parbake" ? 0 : 1);
      const d = order(a.view_category) - order(b.view_category);
      if (d !== 0) return d;
      return a.material_name.localeCompare(b.material_name, "ko");
    });

  return { asOfDate, openingAsOfDate, materials };
}

export type SaveCycleDraftInput = {
  sessionId?: string;
  adjustment_date: string;
  product_name: string;
  memo: string;
  wizard_step: number;
  production_header_ids: string[];
  lot_physical?: Array<{ lot_id: string; physical_qty: number }>;
};

export async function saveCycleDraft(input: SaveCycleDraftInput): Promise<string> {
  const payload = {
    adjustment_type: "production_cycle" as const,
    adjustment_date: input.adjustment_date,
    product_name: input.product_name,
    status: "draft" as const,
    wizard_step: input.wizard_step,
    memo: input.memo.trim() || null,
  };

  let sessionId = input.sessionId;
  if (sessionId) {
    const { error } = await supabase
      .from("harang_stock_adjustment_sessions")
      .update(payload)
      .eq("id", sessionId)
      .eq("status", "draft");
    if (error) throw error;
    const { error: delErr } = await supabase
      .from("harang_stock_adjustment_production_targets")
      .delete()
      .eq("session_id", sessionId);
    if (delErr) throw delErr;
  } else {
    const { data, error } = await supabase
      .from("harang_stock_adjustment_sessions")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw error;
    sessionId = String(data.id);
  }

  if (input.production_header_ids.length > 0) {
    const { error: insErr } = await supabase.from("harang_stock_adjustment_production_targets").insert(
      input.production_header_ids.map((production_header_id) => ({
        session_id: sessionId,
        production_header_id,
      })),
    );
    if (insErr) throw insErr;
  }

  const { error: delLotErr } = await supabase
    .from("harang_stock_adjustment_lot_physical")
    .delete()
    .eq("session_id", sessionId);
  if (delLotErr) throw delLotErr;

  if (input.lot_physical && input.lot_physical.length > 0) {
    const { error: lotInsErr } = await supabase.from("harang_stock_adjustment_lot_physical").insert(
      input.lot_physical.map((row) => ({
        session_id: sessionId,
        lot_id: row.lot_id,
        physical_qty: row.physical_qty,
      })),
    );
    if (lotInsErr) throw lotInsErr;
  }

  return sessionId;
}

/** 작성중(draft) 세션만 삭제. 연결된 생산입고 타겟은 CASCADE로 함께 제거됩니다. */
export async function deleteStockAdjustmentDraft(sessionId: string): Promise<void> {
  const { data, error: fetchErr } = await supabase
    .from("harang_stock_adjustment_sessions")
    .select("status")
    .eq("id", sessionId)
    .single();
  if (fetchErr) throw fetchErr;
  if ((data as { status: string }).status !== "draft") {
    throw new Error("완료된 조정은 삭제할 수 없습니다.");
  }

  const { error } = await supabase
    .from("harang_stock_adjustment_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("status", "draft");
  if (error) throw error;
}

export async function deleteStockAdjustmentDrafts(sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return;
  const { error } = await supabase
    .from("harang_stock_adjustment_sessions")
    .delete()
    .in("id", sessionIds)
    .eq("status", "draft");
  if (error) throw error;
}

export async function loadCycleDraft(sessionId: string): Promise<{
  session: StockAdjustmentSessionRow;
  production_header_ids: string[];
  lot_physical: Array<{ lot_id: string; physical_qty: number }>;
}> {
  const [sessionRes, targetsRes, lotRes] = await Promise.all([
    supabase.from("harang_stock_adjustment_sessions").select("*").eq("id", sessionId).single(),
    supabase
      .from("harang_stock_adjustment_production_targets")
      .select("production_header_id")
      .eq("session_id", sessionId),
    supabase
      .from("harang_stock_adjustment_lot_physical")
      .select("lot_id, physical_qty")
      .eq("session_id", sessionId),
  ]);
  if (sessionRes.error) throw sessionRes.error;
  if (targetsRes.error) throw targetsRes.error;
  if (lotRes.error) throw lotRes.error;
  return {
    session: sessionRes.data as StockAdjustmentSessionRow,
    production_header_ids: (targetsRes.data ?? []).map((r) => String(r.production_header_id)),
    lot_physical: (lotRes.data ?? []).map((r) => ({
      lot_id: String(r.lot_id),
      physical_qty: Number(r.physical_qty ?? 0),
    })),
  };
}

/** BOM 대비 실사용량 소모비율(%) — BOM 0이면 null */
export function consumptionRatioFromUsage(actual: number, bom: number): number | null {
  if (bom <= 0) return null;
  return Math.round((actual / bom) * 10000) / 100;
}

export function formatConsumptionRatioPct(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  return `${pct.toLocaleString("ko-KR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
}

export type MaterialConsumptionSummary = {
  materialKey: string;
  material_name: string;
  unit: string;
  view_category: "parbake" | "raw_material";
  bom_usage_qty: number;
  actual_usage_qty: number;
  consumption_ratio_pct: number | null;
};

/** 소비기한 LOT별 실사를 원료 단위로 합산해 소모비율 계산 */
export function aggregateMaterialConsumption(
  rows: Array<{
    materialKey: string;
    material_name: string;
    unit: string;
    view_category?: "parbake" | "raw_material";
    bom: number;
    actual: number;
  }>,
): MaterialConsumptionSummary[] {
  const map = new Map<
    string,
    {
      materialKey: string;
      material_name: string;
      unit: string;
      view_category: "parbake" | "raw_material";
      bom: number;
      actual: number;
    }
  >();

  for (const row of rows) {
    const prev = map.get(row.materialKey) ?? {
      materialKey: row.materialKey,
      material_name: row.material_name,
      unit: row.unit,
      view_category: row.view_category ?? (isParbakeMaterialName(row.material_name) ? "parbake" : "raw_material"),
      bom: 0,
      actual: 0,
    };
    prev.bom += row.bom;
    prev.actual += row.actual;
    map.set(row.materialKey, prev);
  }

  const order = (v: "parbake" | "raw_material") => (v === "parbake" ? 0 : 1);
  return Array.from(map.values())
    .map((r) => {
      const bom = Math.round(r.bom * 1000) / 1000;
      const actual = Math.round(r.actual * 1000) / 1000;
      return {
        materialKey: r.materialKey,
        material_name: r.material_name,
        unit: r.unit,
        view_category: r.view_category,
        bom_usage_qty: bom,
        actual_usage_qty: actual,
        consumption_ratio_pct: consumptionRatioFromUsage(actual, bom),
      };
    })
    .sort((a, b) => {
      const d = order(a.view_category) - order(b.view_category);
      if (d !== 0) return d;
      return a.material_name.localeCompare(b.material_name, "ko");
    });
}

export type ConfirmedSerialResultRow = {
  id: string;
  material_category: HarangCategory;
  material_id: string;
  material_name: string;
  unit: string;
  lot_date: string;
  inbound_qty: number;
  physical_qty: number;
  system_stock_qty: number;
  bom_usage_qty: number;
  actual_usage_qty: number;
  usage_delta_qty: number;
  consumption_ratio_pct: number | null;
};

export type ConfirmedProductionDeltaRow = {
  id: string;
  serial_result_id: string;
  production_header_id: string;
  usage_delta_qty: number;
  production_date: string;
  production_no: string;
  finished_qty: number;
};

export async function confirmCycleAdjustment(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc("confirm_harang_stock_cycle_adjustment", {
    p_session_id: sessionId,
  });
  if (error) {
    throw new Error(error.message || "조정 확정 실패");
  }
}

export async function revertCycleAdjustment(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc("revert_harang_stock_cycle_adjustment", {
    p_session_id: sessionId,
  });
  if (error) {
    throw new Error(error.message || "조정 되돌리기 실패");
  }
}

export async function loadConfirmedCycleDetail(sessionId: string): Promise<{
  session: StockAdjustmentSessionRow;
  production_header_ids: string[];
  serial_results: ConfirmedSerialResultRow[];
  production_deltas: ConfirmedProductionDeltaRow[];
  material_bom_qty: Map<string, number>;
}> {
  const [sessionRes, targetsRes, serialRes, deltaRes] = await Promise.all([
    supabase.from("harang_stock_adjustment_sessions").select("*").eq("id", sessionId).single(),
    supabase
      .from("harang_stock_adjustment_production_targets")
      .select("production_header_id")
      .eq("session_id", sessionId),
    supabase
      .from("harang_stock_adjustment_serial_results")
      .select("*")
      .eq("session_id", sessionId)
      .order("material_name")
      .order("lot_date"),
    supabase
      .from("harang_stock_adjustment_production_deltas")
      .select("id, serial_result_id, production_header_id, usage_delta_qty")
      .eq("session_id", sessionId),
  ]);
  if (sessionRes.error) throw sessionRes.error;
  if (targetsRes.error) throw targetsRes.error;
  if (serialRes.error) throw serialRes.error;
  if (deltaRes.error) throw deltaRes.error;

  const session = sessionRes.data as StockAdjustmentSessionRow;
  if (session.status !== "confirmed") {
    throw new Error("확정된 조정만 조회할 수 있습니다.");
  }

  const headerIds = (targetsRes.data ?? []).map((r) => String(r.production_header_id));
  const materialBomQty = new Map<string, number>();

  if (headerIds.length > 0) {
    const { data: lines, error: linesErr } = await supabase
      .from("harang_production_lines")
      .select("material_category, material_id, bom_qty")
      .in("header_id", headerIds)
      .neq("material_category", "packaging_material");
    if (linesErr) throw linesErr;
    for (const line of lines ?? []) {
      const key = materialRowKey(line.material_category as HarangCategory, String(line.material_id));
      materialBomQty.set(key, (materialBomQty.get(key) ?? 0) + Number(line.bom_qty ?? 0));
    }
  }

  const deltaHeaderIds = Array.from(
    new Set((deltaRes.data ?? []).map((r) => String(r.production_header_id))),
  );
  const headerMeta = new Map<
    string,
    { production_date: string; production_no: string; finished_qty: number }
  >();
  if (headerIds.length > 0) {
    const { data: headers, error: hErr } = await supabase
      .from("harang_production_headers")
      .select("id, production_date, production_no, finished_qty")
      .in("id", deltaHeaderIds.length > 0 ? deltaHeaderIds : headerIds);
    if (hErr) throw hErr;
    for (const h of headers ?? []) {
      headerMeta.set(String(h.id), {
        production_date: String(h.production_date),
        production_no: String(h.production_no),
        finished_qty: Number(h.finished_qty ?? 0),
      });
    }
  }

  return {
    session,
    production_header_ids: headerIds,
    serial_results: (serialRes.data ?? []).map((row) => ({
      id: String(row.id),
      material_category: row.material_category as HarangCategory,
      material_id: String(row.material_id),
      material_name: String(row.material_name),
      unit: String(row.unit),
      lot_date: String(row.lot_date),
      inbound_qty: Number(row.inbound_qty ?? 0),
      physical_qty: Number(row.physical_qty ?? 0),
      system_stock_qty: Number(row.system_stock_qty ?? 0),
      bom_usage_qty: Number(row.bom_usage_qty ?? 0),
      actual_usage_qty: Number(row.actual_usage_qty ?? 0),
      usage_delta_qty: Number(row.usage_delta_qty ?? 0),
      consumption_ratio_pct:
        row.consumption_ratio_pct === null || row.consumption_ratio_pct === undefined
          ? null
          : Number(row.consumption_ratio_pct),
    })),
    production_deltas: (deltaRes.data ?? []).map((row) => {
      const meta = headerMeta.get(String(row.production_header_id));
      return {
        id: String(row.id),
        serial_result_id: String(row.serial_result_id),
        production_header_id: String(row.production_header_id),
        usage_delta_qty: Number(row.usage_delta_qty ?? 0),
        production_date: meta?.production_date ?? "",
        production_no: meta?.production_no ?? "",
        finished_qty: meta?.finished_qty ?? 0,
      };
    }),
    material_bom_qty: materialBomQty,
  };
}

/** 소비기한 LOT 조정분 — 해당 LOT를 실제 차감한 생산입고에만 분배 */
export function distributeDeltaForSerialLot(
  delta: number,
  breakdown: CycleLotProductionRow[],
): Map<string, number> {
  if (breakdown.length === 0) return new Map();
  const lotUsageSum = breakdown.reduce((s, b) => s + b.system_usage, 0);
  if (lotUsageSum > 0) {
    return distributeDeltaByFinishedQty(
      delta,
      breakdown.map((b) => ({ id: b.production_header_id, finished_qty: b.system_usage })),
    );
  }
  return distributeDeltaByFinishedQty(
    delta,
    breakdown.map((b) => ({ id: b.production_header_id, finished_qty: b.finished_qty })),
  );
}

export function distributeDeltaByFinishedQty(
  delta: number,
  headers: Array<{ id: string; finished_qty: number }>,
): Map<string, number> {
  const total = headers.reduce((s, h) => s + h.finished_qty, 0);
  const out = new Map<string, number>();
  if (total <= 0 || delta === 0) return out;
  const target = Math.round(delta);
  let assigned = 0;
  const sorted = [...headers].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = 0; i < sorted.length; i++) {
    const h = sorted[i]!;
    if (i === sorted.length - 1) {
      out.set(h.id, target - assigned);
    } else {
      const part = Math.round((target * h.finished_qty) / total);
      out.set(h.id, part);
      assigned += part;
    }
  }
  return out;
}
