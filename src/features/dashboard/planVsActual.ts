import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateUsageSummary, getDateParbakeTypes } from "@/features/production/history/calculations";
import type { BomRowRef, ComputedResult, DateGroupInput } from "@/features/production/history/types";
import type { MaterialMeta } from "@/features/production/history/calculations";
import {
  canonicalizeEcountProductName,
  mapEcountImportLine,
} from "@/features/dashboard/ecountProductCanonicalize";
import { classifyEcountItemForDashboard } from "@/features/dashboard/ecountProductionImport";

export type PlanActualMonthSummary = {
  year: number;
  month: number;
  planTotal: number;
  actualTotal: number;
  achievementPct: number | null;
  /** true면 계획 합계가 production_plan_processed_rows 기준 */
  planFromProcessedSheet: boolean;
};

function ymdBounds(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(year, month, 0);
  const end = `${year}-${String(month).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
  return { start, end };
}

/** 생산계획 시트 동기화 행 합계 (수량 null은 0) */
export async function sumPlanQtyInRange(
  supabase: SupabaseClient,
  start: string,
  end: string
): Promise<number> {
  const { data, error } = await supabase
    .from("production_plan_rows")
    .select("qty")
    .gte("plan_date", start)
    .lte("plan_date", end);
  if (error || !data) return 0;
  return data.reduce((s, row) => s + (Number((row as { qty: unknown }).qty) || 0), 0);
}

/** 생산계획가공 시트 동기화 행 합계 */
export async function sumProcessedPlanQtyInRange(
  supabase: SupabaseClient,
  start: string,
  end: string
): Promise<{ sum: number; rowCount: number }> {
  const { data, error } = await supabase
    .from("production_plan_processed_rows")
    .select("qty")
    .gte("plan_date", start)
    .lte("plan_date", end);
  if (error || !data) return { sum: 0, rowCount: 0 };
  const sum = data.reduce((s, row) => s + (Number((row as { qty: unknown }).qty) || 0), 0);
  return { sum, rowCount: data.length };
}

/** 2차 마감 일별 완제품 합계(스냅샷 기반) — 이미 집계된 일 목록에서 해당 월만 합산 */
export function sumActualFinishedForMonth(
  dayTotals: { date: string; totalFinishedQty: number }[],
  year: number,
  month: number
): number {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return dayTotals
    .filter((d) => d.date.startsWith(prefix))
    .reduce((s, d) => s + d.totalFinishedQty, 0);
}

export async function loadPlanActualMonthSummary(
  supabase: SupabaseClient,
  year: number,
  month: number,
  dayTotals: { date: string; totalFinishedQty: number }[]
): Promise<PlanActualMonthSummary> {
  const { start, end } = ymdBounds(year, month);
  const [legacyPlan, processed] = await Promise.all([
    sumPlanQtyInRange(supabase, start, end),
    sumProcessedPlanQtyInRange(supabase, start, end),
  ]);
  const planFromProcessedSheet = processed.rowCount > 0;
  const planTotal = planFromProcessedSheet ? processed.sum : legacyPlan;
  const actualTotal = sumActualFinishedForMonth(dayTotals, year, month);
  return {
    year,
    month,
    planTotal,
    actualTotal,
    achievementPct: planTotal > 0 ? (actualTotal / planTotal) * 100 : null,
    planFromProcessedSheet,
  };
}

export type PlanActualProductRow = {
  productName: string;
  planQty: number;
  actualQty: number;
  diff: number;
  actualDailyBreakdown: { date: string; qty: number }[];
};

export type PlanActualByProductResult = {
  rows: PlanActualProductRow[];
  planFromProcessedSheet: boolean;
};

function normName(s: string): string {
  const raw = s.normalize("NFKC").trim().toLowerCase();
  return raw
    .replace(/\s*-\s*(일반|라지|미니|mini|large)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 시트/복사 붙여넣기에서 들어오는 보이지 않는 문자 제거 */
function stripInvisibleChars(s: string): string {
  return s.replace(/[\u200B-\u200D\uFEFF]/g, "");
}

/**
 * 생산계획(가공) 시트의 미니 2입 등: 수량이 '2입 세트' 기준인 경우가 많고 실적은 낱개.
 * 괄호·전각·공백 변형 및 '(2입)' 생략 표기까지 흡수해 계획만 ×2 환산.
 * (시트가 이미 낱개면 과대계상이 되므로 품목명 규칙과 시트 관례를 맞출 것)
 */
/** 디버깅·스크립트용: 품목명 → 계획 수량 낱개 환산 배수(1 또는 2) */
export function getPlanSheetQtySinglesMultiplier(productName: string): number {
  return planQtyMultiplierByName(productName);
}

function planQtyMultiplierByName(productName: string): number {
  if (!productName) return 1;
  const n = stripInvisibleChars(productName)
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\uFF08/g, "(")
    .replace(/\uFF09/g, ")")
    .replace(/\uFF12/g, "2");
  /** 괄호 안 `2 입` 등 공백 허용 */
  if (/\([^)]*2\s*입[^)]*\)/.test(n)) return 2;
  /** "미니 피자" 등 공백 분리 표기 */
  if (n.replace(/\s/g, "").includes("미니피자")) return 2;
  /** '12입' 제외: 앞이 비숫자인 단독 `2입` */
  if (/(^|[^0-9])2\s*입($|[^0-9])/.test(n)) return 2;
  /**
   * 시트/동기화에서 (2입) 접미가 빠져도, 해당 미니 SKU는 항상 2입 세트 수량으로 온다는 전제.
   * (단품 미니 피자가 별도 행으로 들어오면 배수 조정 필요)
   */
  if (/미니\s+고르곤/.test(n)) return 2;
  if (/미니\s+마르게리/.test(n)) return 2;
  if (/미니\s+페퍼로니/.test(n)) return 2;
  return 1;
}

/** 원문 품목명·캐논 품목명 중 하나라도 2입이면 ×2 (시트 표기 vs canonicalize 결과 불일치 대비) */
function planQtyMultiplierForPlanRow(rawProductName: string, canonicalProductName: string): number {
  return Math.max(
    planQtyMultiplierByName(rawProductName),
    planQtyMultiplierByName(canonicalProductName)
  );
}

/** 집계 키가 같을 때 표시용 이름 — 2입 표기가 있는 쪽을 우선(최종 행에서 배수 재적용 시 필요) */
function preferTwoPackPlanDisplay(a: string, b: string): string {
  const ma = planQtyMultiplierByName(a);
  const mb = planQtyMultiplierByName(b);
  if (mb === 2 && ma !== 2) return b;
  if (ma === 2 && mb !== 2) return a;
  return a;
}

/** "베샤멜 파베이크 1237개" → "베샤멜 파베이크" */
function parseParbakeFlavorFromOutputLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  const trimmed = label.normalize("NFKC").trim();
  const m = trimmed.match(/^(.+)\s+[\d,]+개\s*$/);
  return m ? m[1]!.trim() : null;
}

/** 당일 파베이크 베이스(토마토/베샤멜 등) — 계획 품목 키와 맞추기 위함 */
function inferParbakeFlavorForPlanMerge(computed: ComputedResult): string | null {
  const types = getDateParbakeTypes(computed.productSummaries);
  if (types.length === 1) return types[0]!;
  const fromAstro = parseParbakeFlavorFromOutputLabel(computed.astronautParbakeOutputLabel);
  if (fromAstro) return fromAstro;
  const fromSale = parseParbakeFlavorFromOutputLabel(computed.saleParbakeOutputLabel);
  if (fromSale) return fromSale;
  for (const p of computed.productSummaries) {
    if (p.inferredParbakeName) return p.inferredParbakeName;
  }
  return null;
}

/**
 * canonicalizeEcountProductName 과 계획 시트 품목명이 맞도록 하는 가상 이카운트 라인.
 * flavor는 BOM에서 나온 "토마토 파베이크" / "베샤멜 파베이크" 등.
 */
function syntheticEcountRawForParbakeClosure(
  role: "astronaut" | "sale",
  flavorName: string | null
): string | null {
  if (!flavorName) return null;
  const n = flavorName.normalize("NFKC").toLowerCase();
  const hasTomato = n.includes("토마토");
  const hasBechamel = n.includes("베샤멜");
  if (role === "astronaut") {
    if (hasBechamel && !hasTomato) return "우주인 화덕파베이크- 베샤멜 [235g]";
    if (hasTomato) return "우주인 화덕파베이크 도우-토마토 [235g]";
    return hasBechamel ? "우주인 화덕파베이크- 베샤멜 [235g]" : "우주인 화덕파베이크 도우-토마토 [235g]";
  }
  if (hasBechamel && !hasTomato) return "선인 베샤멜 파베이크 도우 [235g]";
  if (hasTomato) return "선인 토마토 파베이크 도우 [235g]";
  return hasBechamel ? "선인 베샤멜 파베이크 도우 [235g]" : "선인 토마토 파베이크 도우 [235g]";
}

/** 월간 품목별 계획 vs 실적 (실적은 2차 마감 스냅샷 기준) */
export async function loadPlanActualByProductForMonth(
  supabase: SupabaseClient,
  year: number,
  month: number
): Promise<PlanActualByProductResult> {
  const { start, end } = ymdBounds(year, month);

  const [processedPlanRes, legacyPlanRes, closedSnapshotRes, bomRes, materialRes, ecountRes] = await Promise.all([
    supabase
      .from("production_plan_processed_rows")
      .select("product_name, qty")
      .gte("plan_date", start)
      .lte("plan_date", end),
    supabase
      .from("production_plan_rows")
      .select("product_name, qty")
      .gte("plan_date", start)
      .lte("plan_date", end),
    supabase
      .from("production_history_date_state")
      .select("production_date, second_closed_at, state_snapshot")
      .gte("production_date", start)
      .lte("production_date", end)
      .not("second_closed_at", "is", null),
    supabase
      .from("bom")
      .select("product_name, material_name, bom_g_per_ea, basis"),
    supabase
      .from("materials")
      .select("material_name, box_weight_g, unit_weight_g"),
    supabase
      .from("ecount_production_import_lines")
      .select("movement_date, item_name, quantity, movement_type")
      .gte("movement_date", start)
      .lte("movement_date", end),
  ]);
  const planFromProcessedSheet = (processedPlanRes.data?.length ?? 0) > 0;
  const planRows = planFromProcessedSheet ? processedPlanRes.data ?? [] : legacyPlanRes.data ?? [];
  const secondClosedDates = new Set(
    (closedSnapshotRes.data ?? [])
      .map((r) => String((r as { production_date?: string }).production_date ?? "").slice(0, 10))
      .filter(Boolean)
  );
  const firstSecondClosedDate = Array.from(secondClosedDates).sort()[0] ?? null;

  /** 시트 수량은 2입=세트 수 그대로 합산(qtyRaw). ×2는 키별로 기여한 모든 행의 배수 최댓값으로 적용 */
  const planByNorm = new Map<
    string,
    { display: string; qtyRaw: number; sampleRaw: string; sampleCanon: string; planMultMax: number }
  >();
  for (const row of planRows) {
    const r = row as { product_name: string | null; qty: unknown };
    const rawName = stripInvisibleChars((r.product_name ?? "").trim());
    const name = canonicalizeEcountProductName(rawName);
    if (!name) continue;
    const qtyRaw = Number(r.qty) || 0;
    if (qtyRaw <= 0) continue;
    const key = normName(name);
    const rowMult = planQtyMultiplierForPlanRow(rawName, name);
    const prev = planByNorm.get(key);
    if (prev) {
      const display = preferTwoPackPlanDisplay(prev.display, name);
      const useNewSample = rowMult > planQtyMultiplierForPlanRow(prev.sampleRaw, prev.sampleCanon);
      planByNorm.set(key, {
        display,
        qtyRaw: prev.qtyRaw + qtyRaw,
        sampleRaw: useNewSample ? rawName : prev.sampleRaw,
        sampleCanon: useNewSample ? name : prev.sampleCanon,
        planMultMax: Math.max(prev.planMultMax, rowMult),
      });
    } else {
      planByNorm.set(key, {
        display: name,
        qtyRaw: qtyRaw,
        sampleRaw: rawName,
        sampleCanon: name,
        planMultMax: rowMult,
      });
    }
  }

  const actualByNorm = new Map<string, { display: string; qty: number; byDate: Map<string, number> }>();
  const bomRefs: BomRowRef[] = (bomRes.data ?? []).map((r) => {
    const row = r as {
      product_name: string | null;
      material_name: string | null;
      bom_g_per_ea: unknown;
      basis: "완제품" | "도우" | null;
    };
    return {
      productName: String(row.product_name ?? "").trim(),
      materialName: String(row.material_name ?? "").trim(),
      bomGPerEa: Number(row.bom_g_per_ea) || 0,
      basis: row.basis === "도우" ? "도우" : "완제품",
    };
  });
  const materialsMeta: MaterialMeta[] = (materialRes.data ?? []).map((r) => {
    const row = r as {
      material_name: string | null;
      box_weight_g: unknown;
      unit_weight_g: unknown;
    };
    return {
      materialName: String(row.material_name ?? "").trim(),
      boxWeightG: Number(row.box_weight_g) || 0,
      unitWeightG: Number(row.unit_weight_g) || 0,
    };
  });
  for (const row of closedSnapshotRes.data ?? []) {
    const stateSnapshot = (row as { state_snapshot?: unknown }).state_snapshot;
    if (!stateSnapshot || typeof stateSnapshot !== "object") continue;
    let computed;
    try {
      computed = calculateUsageSummary(stateSnapshot as DateGroupInput, bomRefs, materialsMeta);
    } catch {
      continue;
    }
    const closureDate = String((row as { production_date?: string }).production_date ?? "").slice(0, 10);
    /** 동일 스냅샷에 같은 완제품 행이 중복되면 normName 합산 시 실적이 2배로 잡힘 → 완전 동일 행은 1회만 */
    const seenOutputSig = new Set<string>();
    for (const p of computed.productSummaries) {
      const name = canonicalizeEcountProductName(
        String(p.baseProductName ?? p.productName ?? p.displayProductLabel ?? "").trim()
      );
      const qty = Number(p.finishedQty) || 0;
      if (!name || qty <= 0) continue;
      const dedupeSig = [
        String(p.productKey ?? ""),
        String(p.baseProductName ?? ""),
        String(p.productStandardName ?? ""),
        name,
        String(qty),
      ].join("\u001e");
      if (seenOutputSig.has(dedupeSig)) continue;
      seenOutputSig.add(dedupeSig);
      const key = normName(name);
      const prev = actualByNorm.get(key);
      if (prev) {
        prev.byDate.set(closureDate, (prev.byDate.get(closureDate) ?? 0) + qty);
        actualByNorm.set(key, { display: prev.display, qty: prev.qty + qty, byDate: prev.byDate });
      } else {
        const byDate = new Map<string, number>();
        byDate.set(closureDate, qty);
        actualByNorm.set(key, { display: name, qty, byDate });
      }
    }

    /** 완제품(productOutputs) 외에 secondClosure의 우주인·판매 파베만 별도 저장 → 실적 누락 방지 */
    const mergeParbakeClosureActual = (qty: number, rawNameForCanonical: string) => {
      if (qty <= 0 || !closureDate) return;
      const name = canonicalizeEcountProductName(rawNameForCanonical.trim());
      if (!name) return;
      const key = normName(name);
      const prev = actualByNorm.get(key);
      if (prev) {
        prev.byDate.set(closureDate, (prev.byDate.get(closureDate) ?? 0) + qty);
        actualByNorm.set(key, { display: prev.display, qty: prev.qty + qty, byDate: prev.byDate });
      } else {
        const byDate = new Map<string, number>();
        byDate.set(closureDate, qty);
        actualByNorm.set(key, { display: name, qty, byDate });
      }
    };
    const astroQty = Number(computed.astronautParbakeQty) || 0;
    const saleQty = Number(computed.saleParbakeQty) || 0;
    if (astroQty > 0 || saleQty > 0) {
      const parbakeTypes = getDateParbakeTypes(computed.productSummaries);
      if (parbakeTypes.length > 1) {
        // 당일 파베이크 베이스가 2종 이상이면 키 배정이 불명확해 생략 (상세 페이지와 동일 한계)
      } else {
        const flavor = inferParbakeFlavorForPlanMerge(computed);
        const rawAstro = syntheticEcountRawForParbakeClosure("astronaut", flavor);
        const rawSale = syntheticEcountRawForParbakeClosure("sale", flavor);
        if (rawAstro) mergeParbakeClosureActual(astroQty, rawAstro);
        if (rawSale) mergeParbakeClosureActual(saleQty, rawSale);
      }
    }
  }
  // 2차마감 없는 날짜는 이카운트 생산입고를 실적으로 보정
  for (const row of ecountRes.data ?? []) {
    const r = row as {
      movement_date?: string | null;
      item_name?: string | null;
      quantity?: unknown;
      movement_type?: string | null;
    };
    if (String(r.movement_type ?? "").trim() !== "생산입고") continue;
    const d = String(r.movement_date ?? "").slice(0, 10);
    if (!d || secondClosedDates.has(d)) continue;
    // 올해는 최초 2차마감 이전 구간(예: 1~3/11)만 이카운트로 보정
    if (firstSecondClosedDate && d >= firstSecondClosedDate) continue;
    const rawName = String(r.item_name ?? "").trim();
    const qtyRaw = Number(r.quantity) || 0;
    if (!rawName || qtyRaw <= 0) continue;
    const mapped = mapEcountImportLine(rawName);
    if (!mapped.canonicalName) continue;
    const name = mapped.canonicalName;
    const qty = qtyRaw * mapped.multiplier;
    const key = normName(name);
    const prev = actualByNorm.get(key);
    if (prev) {
      prev.byDate.set(d, (prev.byDate.get(d) ?? 0) + qty);
      actualByNorm.set(key, { display: prev.display, qty: prev.qty + qty, byDate: prev.byDate });
    } else {
      const byDate = new Map<string, number>();
      byDate.set(d, qty);
      actualByNorm.set(key, { display: name, qty, byDate });
    }
  }

  const keys = new Set([
    ...Array.from(planByNorm.keys()),
    ...Array.from(actualByNorm.keys()),
  ]);
  const rows: PlanActualProductRow[] = [];
  for (const key of Array.from(keys)) {
    const planEntry = planByNorm.get(key);
    const actualEntry = actualByNorm.get(key);
    const display =
      planEntry?.display && actualEntry?.display
        ? preferTwoPackPlanDisplay(planEntry.display, actualEntry.display)
        : (planEntry?.display ?? actualEntry?.display ?? key);
    const qtyRaw = planEntry?.qtyRaw ?? 0;
    const mult = Math.max(
      1,
      planEntry ? planEntry.planMultMax : 1,
      planQtyMultiplierByName(display),
      actualEntry ? planQtyMultiplierByName(actualEntry.display) : 1,
      planQtyMultiplierByName(key)
    );
    const p = qtyRaw * mult;
    const a = actualEntry?.qty ?? 0;
    if (p === 0 && a === 0) continue;
    rows.push({
      productName: display,
      planQty: p,
      actualQty: a,
      diff: a - p,
      actualDailyBreakdown: Array.from(actualByNorm.get(key)?.byDate.entries() ?? [])
        .sort((x, y) => x[0].localeCompare(y[0]))
        .map(([date, qty]) => ({ date, qty })),
    });
  }
  /**
   * 품목명 유니코드/동기화 표기 차이로 위에서 mult=1이 된 경우 보정.
   * 미니 2입 계획(세트 수)·실적(낱개) 불일치일 때 흔한 달성률 구간(~180~320%)이면 계획만 ×2.
   */
  for (const row of rows) {
    if (!shouldApplyMiniTwoPackPlanSinglesCorrection(row)) continue;
    row.planQty *= 2;
    row.diff = row.actualQty - row.planQty;
  }

  rows.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff) || x.productName.localeCompare(y.productName, "ko"));
  return { rows, planFromProcessedSheet };
}

function shouldApplyMiniTwoPackPlanSinglesCorrection(row: PlanActualProductRow): boolean {
  if (planQtyMultiplierByName(row.productName) >= 2) return false;
  const pn = stripInvisibleChars(row.productName)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\uFF08/g, "(")
    .replace(/\uFF09/g, ")");
  if (!pn.includes("미니")) return false;
  const looksMiniTwoPack =
    /\(2\s*입\)/.test(pn) ||
    /미니\s+고르곤/.test(pn) ||
    /미니\s+마르게리/.test(pn) ||
    /미니\s+페퍼로니/.test(pn) ||
    pn.replace(/\s/g, "").includes("미니피자");
  if (!looksMiniTwoPack) return false;
  if (row.planQty <= 0 || row.actualQty <= 0) return false;
  const ratio = row.actualQty / row.planQty;
  if (!Number.isFinite(ratio)) return false;
  return ratio >= 1.75 && ratio <= 3.2;
}

/** 계획·실적 품목명 → 임원 대시보드 대분류(피자·브레드·파베이크) */
export function majorCategoryForPlanActualProduct(displayProductName: string): "pizza" | "bread" | "parbake" {
  const trimmed = displayProductName.normalize("NFKC").trim();
  const mapped = mapEcountImportLine(trimmed);
  const name = mapped.canonicalName ?? trimmed;
  if (!name) return "pizza";
  const key = classifyEcountItemForDashboard(name);
  if (key === "astronautParbake" || key === "saleParbake") return "parbake";
  if (key === "bread") return "bread";
  return "pizza";
}

export type PlanActualMajorBucket = {
  plan: number;
  actual: number;
  achievementPct: number | null;
};

export type PlanActualDashboardMetrics = {
  year: number;
  month: number;
  planTotal: number;
  actualTotal: number;
  achievementPct: number | null;
  planFromProcessedSheet: boolean;
  buckets: {
    pizza: PlanActualMajorBucket;
    bread: PlanActualMajorBucket;
    parbake: PlanActualMajorBucket;
  };
};

export function buildPlanActualDashboardMetrics(
  year: number,
  month: number,
  rows: PlanActualProductRow[],
  planFromProcessedSheet: boolean
): PlanActualDashboardMetrics {
  let pizzaPlan = 0;
  let pizzaActual = 0;
  let breadPlan = 0;
  let breadActual = 0;
  let parbakePlan = 0;
  let parbakeActual = 0;
  for (const row of rows) {
    const cat = majorCategoryForPlanActualProduct(row.productName);
    if (cat === "pizza") {
      pizzaPlan += row.planQty;
      pizzaActual += row.actualQty;
    } else if (cat === "bread") {
      breadPlan += row.planQty;
      breadActual += row.actualQty;
    } else {
      parbakePlan += row.planQty;
      parbakeActual += row.actualQty;
    }
  }
  const planTotal = pizzaPlan + breadPlan + parbakePlan;
  const actualTotal = pizzaActual + breadActual + parbakeActual;
  const bucket = (plan: number, actual: number): PlanActualMajorBucket => ({
    plan,
    actual,
    achievementPct: plan > 0 ? (actual / plan) * 100 : null,
  });
  return {
    year,
    month,
    planTotal,
    actualTotal,
    achievementPct: planTotal > 0 ? (actualTotal / planTotal) * 100 : null,
    planFromProcessedSheet,
    buckets: {
      pizza: bucket(pizzaPlan, pizzaActual),
      bread: bucket(breadPlan, breadActual),
      parbake: bucket(parbakePlan, parbakeActual),
    },
  };
}

/** 품목별 계획·실적과 동일 소스로 월 합계·대분류 달성률(피자·브레드·파베이크) */
export async function loadPlanActualDashboardMetrics(
  supabase: SupabaseClient,
  year: number,
  month: number
): Promise<PlanActualDashboardMetrics> {
  const { rows, planFromProcessedSheet } = await loadPlanActualByProductForMonth(supabase, year, month);
  return buildPlanActualDashboardMetrics(year, month, rows, planFromProcessedSheet);
}

/**
 * 임원 대시보드 «올해 월별 달성 추이» 막대 4개 구간.
 * 4월 이하: 1~4월, 5월 이후: 직전 4개월(이번 달 포함).
 */
export function planActualSparklineWindowMonths(currentMonth: number): [number, number, number, number] {
  if (currentMonth <= 4) return [1, 2, 3, 4];
  return [currentMonth - 3, currentMonth - 2, currentMonth - 1, currentMonth];
}
