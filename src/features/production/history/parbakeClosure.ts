/**
 * 2차 마감: 파베이크 전용 출고 제품 분리 · 베이스별 생산량 · 레거시 마이그레이션
 */

import { classifyProductBaseName } from "@/features/production/planning/productClassification";
import type { ProductionLog } from "@/store/useMasterStore";
import { getDoughBaseRowsFromProductBom } from "./bomAdapter";
import { parseProductLabel } from "./productLabel";
import type {
  AstronautParbakeSizeLane,
  BomRowRef,
  ParbakeProductionByBaseInput,
  ProductOutputInput,
  SecondClosureInput,
} from "./types";

function parbakeNameFromBaseSauce(materialName: string): string | null {
  const name = (materialName ?? "").trim();
  if (/도우.*토마토|토마토.*도우/i.test(name)) return "토마토 파베이크";
  if (/도우.*베샤멜|베샤멜.*도우/i.test(name)) return "베샤멜 파베이크";
  if (/도우.*로제|로제.*도우/i.test(name)) return "로제 파베이크";
  if (/도우.*바질|바질.*도우/i.test(name)) return "바질 파베이크";
  if (/도우.*치즈|치즈.*도우/i.test(name)) return "베샤멜 파베이크";
  return null;
}

function inferParbakeNameFromBom(
  baseProductName: string,
  bomList: BomRowRef[],
  productStandardName?: string
): string | null {
  const standard = (productStandardName ?? "일반").trim() || "일반";
  const doughRows = getDoughBaseRowsFromProductBom(baseProductName, standard, bomList);
  const parbakeNames = new Set<string>();
  for (const row of doughRows) {
    if (!/도우.*소스|소스.*도우/i.test(row.materialName) || /토핑/i.test(row.materialName)) {
      continue;
    }
    const parbakeName = parbakeNameFromBaseSauce(row.materialName);
    if (parbakeName) parbakeNames.add(parbakeName);
  }
  return parbakeNames.size === 1 ? Array.from(parbakeNames)[0]! : null;
}

export type ParbakeProductRole = "storage" | "sale";

export function getParbakeProductRole(displayProductLabel: string): ParbakeProductRole | null {
  const { baseProductName } = parseProductLabel(displayProductLabel);
  const { major } = classifyProductBaseName(baseProductName);
  if (major === "parbake_storage") return "storage";
  if (major === "parbake_sale") return "sale";
  const n = (displayProductLabel ?? "").normalize("NFKC").trim().toLowerCase();
  if (n.includes("우주인") && n.includes("파베")) return "storage";
  if ((n.includes("선인") || n.includes("판매용")) && n.includes("파베")) return "sale";
  return null;
}

export function isParbakeOnlyFinishedProductLabel(displayProductLabel: string): boolean {
  return getParbakeProductRole(displayProductLabel) !== null;
}

/** 파베이크 전용 출고 제품명 → 토마토/베샤멜 파베이크 표시명 */
export function inferParbakeNameFromProductLabel(
  displayProductLabel: string,
  bomList: BomRowRef[] = []
): string | null {
  const { baseProductName, productStandardName } = parseProductLabel(displayProductLabel);
  if (baseProductName) {
    const fromBom = inferParbakeNameFromBom(baseProductName, bomList, productStandardName);
    if (fromBom) return fromBom;
  }
  const n = (baseProductName || displayProductLabel).normalize("NFKC").trim().toLowerCase();
  if (n.includes("토마토")) return "토마토 파베이크";
  if (n.includes("베샤멜")) return "베샤멜 파베이크";
  if (n.includes("로제")) return "로제 파베이크";
  if (n.includes("바질")) return "바질 파베이크";
  return null;
}

type OutboundLineLike = { 박스?: number; 낱개?: number; g?: number };

function getLinesFromLog(log: ProductionLog): OutboundLineLike[] {
  if (Array.isArray(log.출고_라인) && log.출고_라인.length > 0) {
    return log.출고_라인;
  }
  return [
    {
      박스: log.출고_박스 ?? 0,
      낱개: log.출고_낱개 ?? 0,
      g: log.출고_g ?? 0,
    },
  ];
}

/** 해당 제품(출고 표시명)의 당일 출고 낱개 합계 */
export function sumOutboundEaForProductLabel(
  logs: ProductionLog[],
  displayProductLabel: string
): number {
  const target = (displayProductLabel ?? "").trim();
  if (!target) return 0;
  let sum = 0;
  for (const log of logs) {
    if ((log.제품명 ?? "").trim() !== target) continue;
    for (const line of getLinesFromLog(log)) {
      sum += Number(line.낱개) || 0;
    }
  }
  return sum;
}

export function collectParbakePrefillFromLogs(
  logs: ProductionLog[],
  bomList: BomRowRef[]
): Map<string, { astronautQty: number; saleQty: number }> {
  const byBase = new Map<string, { astronautQty: number; saleQty: number }>();
  const seen = new Set<string>();

  for (const log of logs) {
    const label = (log.제품명 ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const role = getParbakeProductRole(label);
    if (!role) continue;
    const parbakeName = inferParbakeNameFromProductLabel(label, bomList);
    if (!parbakeName) continue;
    const qty = sumOutboundEaForProductLabel(logs, label);
    if (qty <= 0) continue;
    const cur = byBase.get(parbakeName) ?? { astronautQty: 0, saleQty: 0 };
    if (role === "storage") cur.astronautQty += qty;
    else cur.saleQty += qty;
    byBase.set(parbakeName, cur);
  }
  return byBase;
}

export function inferParbakeTypesFromFinishedProducts(
  finishedProducts: { baseProductName?: string; productStandardName?: string }[],
  bomList: BomRowRef[]
): string[] {
  const set = new Set<string>();
  for (const p of finishedProducts) {
    const base = (p.baseProductName ?? "").trim();
    if (!base) continue;
    const std = (p.productStandardName ?? "일반").trim() || "일반";
    if (std === "브레드") continue;
    const meta = inferParbakeNameFromBom(base, bomList, std);
    if (meta) set.add(meta);
  }
  return Array.from(set).sort();
}

function emptyRow(parbakeName: string): ParbakeProductionByBaseInput {
  return { parbakeName, astronautQty: "", saleQty: "" };
}

function mergeParbakeTypeRows(
  rows: ParbakeProductionByBaseInput[],
  dateParbakeTypes: string[]
): ParbakeProductionByBaseInput[] {
  const byName = new Map(rows.map((r) => [r.parbakeName, r]));
  return dateParbakeTypes.map((name) => {
    const existing = byName.get(name);
    return existing
      ? {
          parbakeName: name,
          astronautQty: existing.astronautQty ?? "",
          saleQty: existing.saleQty ?? "",
        }
      : emptyRow(name);
  });
}

function toNum(x: number | "" | null | undefined): number {
  if (x === "" || x === null || x === undefined) return 0;
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/** productOutputs에서 파베 전용 제품 제거 + 수량을 베이스별 행으로 이전 */
export function stripParbakeProductsFromOutputs(
  productOutputs: ProductOutputInput[],
  bomList: BomRowRef[]
): {
  productOutputs: ProductOutputInput[];
  extractedByBase: Map<string, { astronautQty: number; saleQty: number }>;
} {
  const extractedByBase = new Map<string, { astronautQty: number; saleQty: number }>();
  const kept: ProductOutputInput[] = [];

  for (const o of productOutputs) {
    const label = o.displayProductLabel ?? o.productKey ?? o.productName ?? "";
    const role = getParbakeProductRole(label);
    if (!role) {
      kept.push(o);
      continue;
    }
    const parbakeName = inferParbakeNameFromProductLabel(label, bomList);
    if (!parbakeName) {
      kept.push(o);
      continue;
    }
    const qty = toNum(o.finishedQty);
    if (qty <= 0) continue;
    const cur = extractedByBase.get(parbakeName) ?? { astronautQty: 0, saleQty: 0 };
    if (role === "storage") cur.astronautQty += qty;
    else cur.saleQty += qty;
    extractedByBase.set(parbakeName, cur);
  }
  return { productOutputs: kept, extractedByBase };
}

export function buildParbakeProductionByBase(
  dateParbakeTypes: string[],
  prefillFromLogs: Map<string, { astronautQty: number; saleQty: number }>,
  extractedFromOutputs: Map<string, { astronautQty: number; saleQty: number }>,
  existingRows: ParbakeProductionByBaseInput[] | undefined,
  legacyAstronaut: number | "" | undefined,
  legacySale: number | "" | undefined
): ParbakeProductionByBaseInput[] {
  if (existingRows && existingRows.length > 0) {
    return mergeParbakeTypeRows(existingRows, dateParbakeTypes);
  }

  const rows = dateParbakeTypes.map((name) => {
    const fromLog = prefillFromLogs.get(name);
    const fromOut = extractedFromOutputs.get(name);
    const astronautQty =
      fromOut?.astronautQty || fromLog?.astronautQty
        ? (fromOut?.astronautQty ?? 0) + (fromLog?.astronautQty ?? 0)
        : "";
    const saleQty =
      fromOut?.saleQty || fromLog?.saleQty
        ? (fromOut?.saleQty ?? 0) + (fromLog?.saleQty ?? 0)
        : "";
    return {
      parbakeName: name,
      astronautQty: astronautQty === 0 ? "" : astronautQty,
      saleQty: saleQty === 0 ? "" : saleQty,
    } satisfies ParbakeProductionByBaseInput;
  });

  const legacyAstro = toNum(legacyAstronaut);
  const legacySaleTotal = toNum(legacySale);
  if ((legacyAstro > 0 || legacySaleTotal > 0) && rows.length > 0) {
    if (rows.length === 1) {
      if (legacyAstro > 0 && toNum(rows[0]!.astronautQty) === 0) {
        rows[0]!.astronautQty = legacyAstro;
      }
      if (legacySaleTotal > 0 && toNum(rows[0]!.saleQty) === 0) {
        rows[0]!.saleQty = legacySaleTotal;
      }
    } else {
      const primary = rows[0]!;
      if (legacyAstro > 0 && toNum(primary.astronautQty) === 0) {
        primary.astronautQty = legacyAstro;
      }
      if (legacySaleTotal > 0 && toNum(primary.saleQty) === 0) {
        primary.saleQty = legacySaleTotal;
      }
    }
  }

  return rows;
}

export function resolveParbakeProductionRows(
  secondClosure: SecondClosureInput,
  dateParbakeTypes: string[]
): ParbakeProductionByBaseInput[] {
  const rows = secondClosure.parbakeProductionByBase;
  if (rows && rows.length > 0) {
    return mergeParbakeTypeRows(rows, dateParbakeTypes);
  }
  if (dateParbakeTypes.length === 0) return [];
  if (dateParbakeTypes.length === 1) {
    const only = dateParbakeTypes[0]!;
    return [
      {
        parbakeName: only,
        astronautQty: secondClosure.astronautParbakeQty ?? "",
        saleQty: secondClosure.saleParbakeQty ?? "",
      },
    ];
  }
  const primary = dateParbakeTypes[0]!;
  return dateParbakeTypes.map((name) =>
    name === primary
      ? {
          parbakeName: name,
          astronautQty: secondClosure.astronautParbakeQty ?? "",
          saleQty: secondClosure.saleParbakeQty ?? "",
        }
      : emptyRow(name)
  );
}

export function sumParbakeClosureQty(secondClosure: SecondClosureInput): {
  astronautParbakeQty: number;
  saleParbakeQty: number;
} {
  const rows = resolveParbakeProductionRows(secondClosure, collectAllParbakeNames(secondClosure));
  if (rows.length > 0) {
    return {
      astronautParbakeQty: rows.reduce((s, r) => s + toNum(r.astronautQty), 0),
      saleParbakeQty: rows.reduce((s, r) => s + toNum(r.saleQty), 0),
    };
  }
  return {
    astronautParbakeQty: toNum(secondClosure.astronautParbakeQty),
    saleParbakeQty: toNum(secondClosure.saleParbakeQty),
  };
}

function collectAllParbakeNames(secondClosure: SecondClosureInput): string[] {
  const set = new Set<string>();
  for (const r of secondClosure.parbakeProductionByBase ?? []) {
    if (r.parbakeName) set.add(r.parbakeName);
  }
  return Array.from(set).sort();
}

export function syncLegacyParbakeFields(
  secondClosure: SecondClosureInput
): SecondClosureInput {
  const rows = secondClosure.parbakeProductionByBase;
  if (!rows || rows.length === 0) return secondClosure;
  const totals = {
    astronautParbakeQty: rows.reduce((s, r) => s + toNum(r.astronautQty), 0),
    saleParbakeQty: rows.reduce((s, r) => s + toNum(r.saleQty), 0),
  };
  return {
    ...secondClosure,
    astronautParbakeQty: totals.astronautParbakeQty || "",
    saleParbakeQty: totals.saleParbakeQty || "",
  };
}

export type FinishedProductGroupKey = "일반" | "미니" | "파베이크사용" | "브레드" | "기타";

export const FINISHED_PRODUCT_GROUPS: {
  key: FinishedProductGroupKey;
  label: string;
  order: number;
}[] = [
  { key: "일반", label: "일반 피자", order: 0 },
  { key: "미니", label: "미니 피자", order: 1 },
  { key: "파베이크사용", label: "파베이크사용", order: 2 },
  { key: "브레드", label: "브레드", order: 3 },
  { key: "기타", label: "기타", order: 4 },
];

export function finishedProductGroupKey(productStandardName: string): FinishedProductGroupKey {
  const std = (productStandardName ?? "").trim() || "일반";
  if (std === "일반") return "일반";
  if (std === "미니") return "미니";
  if (std === "파베이크사용") return "파베이크사용";
  if (std === "브레드") return "브레드";
  return "기타";
}

export function normalizeSecondClosureForDate(
  secondClosure: SecondClosureInput,
  logs: ProductionLog[],
  finishedProducts: { baseProductName?: string; productStandardName?: string }[],
  bomList: BomRowRef[]
): SecondClosureInput {
  const { productOutputs, extractedByBase } = stripParbakeProductsFromOutputs(
    secondClosure.productOutputs,
    bomList
  );
  const prefillFromLogs = collectParbakePrefillFromLogs(logs, bomList);
  const typesFromFinished = inferParbakeTypesFromFinishedProducts(finishedProducts, bomList);
  const typeSet = new Set(typesFromFinished);
  for (const name of Array.from(prefillFromLogs.keys())) typeSet.add(name);
  for (const name of Array.from(extractedByBase.keys())) typeSet.add(name);
  for (const r of secondClosure.parbakeProductionByBase ?? []) {
    if (r.parbakeName) typeSet.add(r.parbakeName);
  }
  const dateParbakeTypes = Array.from(typeSet).sort();

  const parbakeProductionByBase = buildParbakeProductionByBase(
    dateParbakeTypes,
    prefillFromLogs,
    extractedByBase,
    secondClosure.parbakeProductionByBase,
    secondClosure.astronautParbakeQty,
    secondClosure.saleParbakeQty
  );

  return syncLegacyParbakeFields({
    ...secondClosure,
    productOutputs,
    parbakeProductionByBase,
    astronautParbakeSizeLane: (secondClosure.astronautParbakeSizeLane ?? "") as
      | AstronautParbakeSizeLane
      | "",
    saleParbakeSizeLane: (secondClosure.saleParbakeSizeLane ?? "") as AstronautParbakeSizeLane | "",
  });
}
