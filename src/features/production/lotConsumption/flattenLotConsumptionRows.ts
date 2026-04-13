import type { Material } from "@/lib/mockData";
import { calculateLotUsages, type MaterialMeta } from "@/features/production/history/calculations";
import type { DateGroupInput } from "@/features/production/history/types";
import type { OutboundLine, ProductionLog, UsageCalculationRecord } from "@/store/useMasterStore";
import { formatLotDottedFromIso, parseLotNoToIso } from "@/lib/lotNoFormat";

export type LotConsumptionFlatRow = {
  key: string;
  logId: string;
  productionDate: string;
  productName: string;
  materialName: string;
  lotIso: string;
  lotLabel: string;
  box: number;
  bag: number;
  /** 출고 입력 g (라인 직접 입력) */
  g: number;
  /** 박스·낱개·g 환산 합 (원료 마스터 중량 기준, 없으면 g만) */
  outboundTotalG: number;
  /**
   * 소모(g): 실사용량_g 우선, 없으면 일차사용량_g를 LOT별 출고 환산 비율로 배분.
   * 둘 다 없으면 null.
   */
  consumeG: number | null;
  logStatus: string;
};

/** LOT 소모 보강: 사용량 계산(원료별 재고)·마감 스냅샷 — production_logs 실사용만으로는 비는 경우 */
export type LotConsumptionEnrichInput = {
  usageCalculations?: UsageCalculationRecord[];
  productionHistoryDateStates?: Record<string, { state_snapshot?: unknown }>;
  /** 제품·원료별 총 소모(출고_g) 조회용 — usage_calculations 배분 시 필요 */
  productionLogs?: ProductionLog[];
};

function rowLotIsoKey(r: LotConsumptionFlatRow): string {
  if (r.lotIso && /^\d{4}-\d{2}-\d{2}$/.test(r.lotIso)) return r.lotIso;
  return parseLotNoToIso(r.lotLabel) || "";
}

/**
 * useDailyProductionReport.getActualUsageByProductMaterial 과 동일:
 * 원료 전일재고 합 + 일지 출고_g − 원료 당일재고 합 (제품·일자·원료 1건 기준 총 사용량).
 * LOT별로 prior+라인출고−closing 을 따로 하면 리포트 합과 불일치할 수 있어, 총량 후 출고 라인 비율 배분만 사용.
 */
function aggregateUsageFromUsageCalc(
  log: ProductionLog | undefined,
  calc: UsageCalculationRecord | undefined,
  materialName: string
): number | null {
  if (!log || !calc?.materials_data?.[materialName]) return null;
  const md = calc.materials_data[materialName];
  const priorSum = (md.prior_stock ?? []).reduce((s, x) => s + (x.qty_g ?? 0), 0);
  const closingSum = (md.closing_stock ?? []).reduce((s, x) => s + (x.qty_g ?? 0), 0);
  const outbound = log.출고_g ?? 0;
  const raw = priorSum + outbound - closingSum;
  if (!Number.isFinite(raw)) return null;
  return Math.max(0, raw);
}

function extractMaterialsFromSnapshot(snapshot: unknown): DateGroupInput["materials"] | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const materialsRaw = (snapshot as Record<string, unknown>).materials;
  if (!Array.isArray(materialsRaw) || materialsRaw.length === 0) return null;
  const out: DateGroupInput["materials"] = [];
  for (const card of materialsRaw) {
    if (!card || typeof card !== "object") continue;
    const c = card as Record<string, unknown>;
    const materialName = String(c.materialName ?? "").trim();
    const lotsRaw = c.lots;
    if (!materialName || !Array.isArray(lotsRaw)) continue;
    const lots: DateGroupInput["materials"][0]["lots"] = [];
    for (const lot of lotsRaw) {
      if (!lot || typeof lot !== "object") continue;
      const lr = lot as Record<string, unknown>;
      lots.push({
        lotRowId: String(lr.lotRowId ?? ""),
        sourceType: lr.sourceType === "manual" ? "manual" : "from-log",
        expiryDate: String(lr.expiryDate ?? "").trim(),
        outboundQty: Number(lr.outboundQty) || 0,
        prevDayUnitCount: lr.prevDayUnitCount as number | "",
        prevDayRemainderG: lr.prevDayRemainderG as number | "",
        currentDayUnitCount: lr.currentDayUnitCount as number | "",
        currentDayRemainderG: lr.currentDayRemainderG as number | "",
      });
    }
    if (lots.length === 0) continue;
    out.push({
      materialCardId: String(c.materialCardId ?? materialName),
      materialName,
      lots,
    });
  }
  return out.length > 0 ? out : null;
}

function buildLotUsageMapFromSnapshots(
  states: Record<string, { state_snapshot?: unknown }>,
  dates: Set<string>,
  materialsMeta: MaterialMeta[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const date of Array.from(dates)) {
    const materials = extractMaterialsFromSnapshot(states[date]?.state_snapshot);
    if (!materials) continue;
    const { lotUsages } = calculateLotUsages(materials, materialsMeta);
    for (const u of lotUsages) {
      const lotKey = parseLotNoToIso(u.expiryDate) || u.expiryDate.slice(0, 10);
      const key = `${date}\t${u.materialName.trim()}\t${lotKey}`;
      map.set(key, u.actualUsageQty);
    }
  }
  return map;
}

function enrichWithUsageCalculations(
  rows: LotConsumptionFlatRow[],
  calcs: UsageCalculationRecord[],
  logs: ProductionLog[]
): LotConsumptionFlatRow[] {
  if (calcs.length === 0 || logs.length === 0) return rows;
  const logById = new Map(logs.map((l) => [l.id, l]));
  const result = rows.map((r) => ({ ...r }));

  const byLogId = new Map<string, number[]>();
  rows.forEach((r, i) => {
    if (r.consumeG != null) return;
    const arr = byLogId.get(r.logId) ?? [];
    arr.push(i);
    byLogId.set(r.logId, arr);
  });

  for (const [logId, indices] of Array.from(byLogId.entries())) {
    const firstIdx = indices[0]!;
    const first = rows[firstIdx]!;
    const log = logById.get(logId);
    const calc = calcs.find(
      (c) => c.production_date === first.productionDate && c.product_name === first.productName
    );
    const target = aggregateUsageFromUsageCalc(log, calc, first.materialName);
    if (target == null) continue;

    const sumOut = indices.reduce((s, i) => s + Math.max(0, rows[i].outboundTotalG), 0);
    if (indices.length === 1) {
      result[firstIdx]!.consumeG = Math.round(target);
      continue;
    }
    if (sumOut <= 0) {
      result[firstIdx]!.consumeG = Math.round(target);
      continue;
    }
    let allocated = 0;
    for (let j = 0; j < indices.length; j++) {
      const i = indices[j]!;
      const isLast = j === indices.length - 1;
      if (isLast) {
        result[i].consumeG = Math.max(0, Math.round(target - allocated));
      } else {
        const ratio = rows[i].outboundTotalG / sumOut;
        const rounded = Math.round(target * ratio);
        allocated += rounded;
        result[i].consumeG = Math.max(0, rounded);
      }
    }
  }
  return result;
}

/** 마감 스냅샷 LOT별 총 소모를 출고 비율로 제품·라인에 배분 (이미 채워진 소모는 남은량만 분배) */
function allocateSnapshotUsage(
  rows: LotConsumptionFlatRow[],
  usageMap: Map<string, number>
): LotConsumptionFlatRow[] {
  const result = rows.map((r) => ({ ...r }));
  const groupKey = (r: LotConsumptionFlatRow) =>
    `${r.productionDate}\t${r.materialName.trim()}\t${rowLotIsoKey(r)}`;
  const byGroup = new Map<string, number[]>();
  result.forEach((r, i) => {
    const k = groupKey(r);
    const arr = byGroup.get(k) ?? [];
    arr.push(i);
    byGroup.set(k, arr);
  });
  for (const indices of Array.from(byGroup.values())) {
    const gkey = groupKey(result[indices[0]!]!);
    const totalU = usageMap.get(gkey);
    if (totalU == null || !Number.isFinite(totalU)) continue;
    let sumFilled = 0;
    for (const i of indices) {
      if (result[i].consumeG != null) sumFilled += result[i].consumeG!;
    }
    const uRem = Math.max(0, totalU - sumFilled);
    const nullIdx = indices.filter((i: number) => result[i].consumeG == null);
    if (nullIdx.length === 0 || uRem <= 0) continue;
    let sumOutNull = 0;
    for (const i of nullIdx) sumOutNull += Math.max(0, result[i].outboundTotalG);
    if (sumOutNull <= 0) continue;
    let allocated = 0;
    for (let j = 0; j < nullIdx.length; j++) {
      const i = nullIdx[j]!;
      const isLast = j === nullIdx.length - 1;
      if (isLast) {
        result[i].consumeG = Math.max(0, Math.round(uRem - allocated));
      } else {
        const share = (result[i].outboundTotalG / sumOutNull) * uRem;
        const rounded = Math.round(share);
        allocated += rounded;
        result[i].consumeG = Math.max(0, rounded);
      }
    }
  }
  return result;
}

function applyEnrich(
  rows: LotConsumptionFlatRow[],
  materials: Material[],
  enrich: LotConsumptionEnrichInput
): LotConsumptionFlatRow[] {
  const calcs = enrich.usageCalculations ?? [];
  const logs = enrich.productionLogs ?? [];
  const states = enrich.productionHistoryDateStates;
  let next = enrichWithUsageCalculations(rows, calcs, logs);
  if (!states || Object.keys(states).length === 0) return next;
  const materialsMeta: MaterialMeta[] = materials.map((m) => ({
    materialName: m.materialName,
    unitWeightG: Number(m.unitWeightG) || 0,
    boxWeightG: Number(m.boxWeightG) || 0,
  }));
  const dates = new Set(rows.map((r) => r.productionDate));
  const usageMap = buildLotUsageMapFromSnapshots(states, dates, materialsMeta);
  return allocateSnapshotUsage(next, usageMap);
}

function resolveMaterialWeights(materialName: string, materials: Material[]): { boxW: number; unitW: number } {
  const name = materialName.trim();
  if (!name || materials.length === 0) return { boxW: 0, unitW: 0 };
  const exact = materials.find((m) => m.materialName === name);
  if (exact) return { boxW: Number(exact.boxWeightG) || 0, unitW: Number(exact.unitWeightG) || 0 };
  const head = name.split("(")[0]?.trim() ?? "";
  const partial = materials.find(
    (m) =>
      name.includes(m.materialName) ||
      m.materialName.includes(name) ||
      (head && (name.includes(m.materialName) || m.materialName.includes(head)))
  );
  if (partial) return { boxW: Number(partial.boxWeightG) || 0, unitW: Number(partial.unitWeightG) || 0 };
  return { boxW: 0, unitW: 0 };
}

function outboundLineTotalG(line: OutboundLine, boxW: number, unitW: number): number {
  const box = Number(line.박스) || 0;
  const bag = Number(line.낱개) || 0;
  const g = Number(line.g) || 0;
  return g + box * boxW + bag * unitW;
}

function outboundLinesForLog(log: ProductionLog): OutboundLine[] {
  if (log.출고_라인 && log.출고_라인.length > 0) {
    return log.출고_라인;
  }
  const g = log.출고_g ?? 0;
  const box = log.출고_박스 ?? 0;
  const bag = log.출고_낱개 ?? 0;
  if (g > 0 || box > 0 || bag > 0) {
    const fallbackLot = log.소비기한 ?? "";
    return [{ 소비기한: fallbackLot, 박스: box, 낱개: bag, g }];
  }
  return [];
}

function lotIsoAndLabel(소비기한: string): { lotIso: string; lotLabel: string } {
  const raw = String(소비기한 ?? "").trim();
  if (!raw) {
    return { lotIso: "", lotLabel: "미지정" };
  }
  const iso = parseLotNoToIso(raw) || (/^\d{4}-\d{2}-\d{2}$/.test(raw.slice(0, 10)) ? raw.slice(0, 10) : "");
  if (iso) {
    return { lotIso: iso, lotLabel: formatLotDottedFromIso(iso) };
  }
  return { lotIso: "", lotLabel: raw };
}

type LineDraft = {
  line: OutboundLine;
  lotIso: string;
  lotLabel: string;
  box: number;
  bag: number;
  g: number;
  outboundTotalG: number;
};

function buildLineDraftsForLog(log: ProductionLog, materials: Material[]): LineDraft[] {
  const { boxW, unitW } = resolveMaterialWeights(log.원료명, materials);
  const lines = outboundLinesForLog(log);
  const drafts: LineDraft[] = [];
  for (const line of lines) {
    const { lotIso, lotLabel } = lotIsoAndLabel(line.소비기한 ?? "");
    const box = Number(line.박스) || 0;
    const bag = Number(line.낱개) || 0;
    const g = Number(line.g) || 0;
    const outboundTotalG = outboundLineTotalG(line, boxW, unitW);
    if (box === 0 && bag === 0 && g === 0) continue;
    drafts.push({ line, lotIso, lotLabel, box, bag, g, outboundTotalG });
  }
  return drafts;
}

/** 로그 단위 소모: 실사용량 우선(마감이면 0도 채택), 없으면 1차 사용량 */
function consumeTargetG(log: ProductionLog): number | null {
  const 실 = log.실사용량_g;
  const 일차 = log.일차사용량_g;
  const has실 = 실 != null && Number.isFinite(실);
  const has일차 = 일차 != null && Number.isFinite(일차) && 일차 > 0;

  if (has실 && (실 > 0 || log.상태 === "마감완료")) {
    return Math.round(실);
  }
  if (has일차) {
    return Math.round(일차);
  }
  if (has실) {
    return Math.round(실);
  }
  return null;
}

function allocateConsumeG(log: ProductionLog, drafts: LineDraft[]): Map<number, number | null> {
  const out = new Map<number, number | null>();
  const target = consumeTargetG(log);

  if (target == null || target < 0) {
    for (let i = 0; i < drafts.length; i += 1) {
      const line = drafts[i].line;
      const lineActual = line.actual_usage_g;
      if (lineActual != null && Number.isFinite(lineActual) && lineActual >= 0) {
        out.set(i, Math.round(lineActual));
      } else {
        out.set(i, null);
      }
    }
    return out;
  }

  const sumOutbound = drafts.reduce((s, d) => s + d.outboundTotalG, 0);

  if (drafts.length === 1) {
    out.set(0, target);
    return out;
  }

  if (sumOutbound <= 0) {
    for (let i = 0; i < drafts.length; i += 1) {
      out.set(i, i === 0 ? target : null);
    }
    return out;
  }

  let allocated = 0;
  for (let i = 0; i < drafts.length; i += 1) {
    const isLast = i === drafts.length - 1;
    if (isLast) {
      out.set(i, Math.max(0, target - allocated));
    } else {
      const ratio = drafts[i].outboundTotalG / sumOutbound;
      const rounded = Math.round(target * ratio);
      allocated += rounded;
      out.set(i, rounded);
    }
  }
  return out;
}

export function flattenProductionLogsToLotRows(
  logs: ProductionLog[],
  materials: Material[],
  enrich?: LotConsumptionEnrichInput
): LotConsumptionFlatRow[] {
  const result: LotConsumptionFlatRow[] = [];

  for (const log of logs) {
    const drafts = buildLineDraftsForLog(log, materials);
    if (drafts.length === 0) continue;
    const consumeByIdx = allocateConsumeG(log, drafts);

    drafts.forEach((d, lineIdx) => {
      result.push({
        key: `${log.id}-${lineIdx}`,
        logId: log.id,
        productionDate: log.생산일자,
        productName: log.제품명,
        materialName: log.원료명,
        lotIso: d.lotIso,
        lotLabel: d.lotLabel,
        box: d.box,
        bag: d.bag,
        g: d.g,
        outboundTotalG: Math.round(d.outboundTotalG),
        consumeG: consumeByIdx.get(lineIdx) ?? null,
        logStatus: log.상태,
      });
    });
  }

  result.sort((a, b) => {
    const d = b.productionDate.localeCompare(a.productionDate);
    if (d !== 0) return d;
    const m = a.materialName.localeCompare(b.materialName, "ko");
    if (m !== 0) return m;
    const l = (a.lotIso || a.lotLabel).localeCompare(b.lotIso || b.lotLabel, "ko");
    if (l !== 0) return l;
    return a.productName.localeCompare(b.productName, "ko");
  });
  if (!enrich) return result;
  return applyEnrich(result, materials, enrich);
}
