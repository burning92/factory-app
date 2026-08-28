import { parseProductLabel } from "./productLabel";
import { isUjuinParbakeFinishedProductLabel } from "@/features/dashboard/productCategoryRules";
import {
  inferParbakeNameFromProductLabel,
  isParbakeOnlyFinishedProductLabel,
} from "./parbakeClosure";
import type { ComputedResult, ProductSummary } from "./types";

/** 제품 표시명: 출고 규격 접미어(-일반, -파베이크사용, -브레드 등) 제거 */
export function productDisplayName(label: string): string {
  const parsed = parseProductLabel(label);
  return (parsed.baseProductName || parsed.displayProductLabel || "").trim();
}

export type CompactProductLine = { name: string; qty: number };

function toQty(value: unknown): number {
  if (value === "" || value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function uniqueLines(lines: CompactProductLine[]): CompactProductLine[] {
  const byName = new Map<string, number>();
  for (const line of lines) {
    const name = line.name.trim();
    if (!name) continue;
    byName.set(name, (byName.get(name) ?? 0) + line.qty);
  }
  return Array.from(byName.entries())
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, "ko"));
}

function linesFromProductSummaries(summaries: ProductSummary[] | undefined): CompactProductLine[] {
  const out: CompactProductLine[] = [];
  for (const p of summaries ?? []) {
    if (isUjuinParbakeFinishedProductLabel(p.displayProductLabel ?? "")) continue;
    const name = productDisplayName(p.baseProductName ?? p.displayProductLabel ?? p.productName ?? "");
    if (!name) continue;
    out.push({ name, qty: toQty(p.finishedQty) });
  }
  return uniqueLines(out);
}

function uniqueOutboundNames(logProductNames: string[] | undefined): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of logProductNames ?? []) {
    const name = String(raw ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function parbakePurposeQty(computed: ComputedResult): number {
  const fromLines = (computed.parbakePurposeProductionLines ?? []).reduce(
    (sum, line) => sum + toQty(line.qty),
    0
  );
  if (fromLines > 0) return fromLines;
  return toQty(computed.astronautParbakeQty) + toQty(computed.saleParbakeQty);
}

/** 출고 현황에 남은 우주인/판매용 파베이크 제품명. 2차 마감 완제품 칸에서는 빠져 있음. */
function linesFromOutboundParbake(
  logProductNames: string[] | undefined,
  computed: ComputedResult
): CompactProductLine[] {
  const names = uniqueOutboundNames(logProductNames).filter(isParbakeOnlyFinishedProductLabel);
  if (names.length === 0) return [];
  const totalQty = parbakePurposeQty(computed);
  if (names.length === 1) {
    return [{ name: productDisplayName(names[0]!), qty: totalQty }];
  }
  return names.map((name) => {
    const inferred = inferParbakeNameFromProductLabel(name);
    const matched = (computed.parbakePurposeProductionLines ?? []).filter((line) => {
      if (!inferred) return false;
      return (
        line.parbakeName === inferred ||
        line.parbakeName.includes(inferred.replace(" 파베이크", ""))
      );
    });
    const qty = matched.reduce((sum, line) => sum + toQty(line.qty), 0);
    return { name: productDisplayName(name), qty };
  });
}

/**
 * 완제품 칸이 비어 있는 날(파베이크만 생산)에도 출고 현황과 같은 제품명이 보이게 한다.
 * 우선순위: 피자·브레드 완제품 → 출고 파베이크 제품명 → 파베이크 목적별 생산 → 추가 파베이크 → 스냅샷 → 기타 출고명
 */
export function collectCompactProductLines(input: {
  computed: ComputedResult;
  snapshotProducts?: Array<{
    displayProductLabel?: string;
    productName?: string;
    baseProductName?: string;
  }>;
  logProductNames?: string[];
}): CompactProductLine[] {
  const fromSummaries = linesFromProductSummaries(input.computed.productSummaries);
  const fromOutboundParbake = linesFromOutboundParbake(input.logProductNames, input.computed);
  const primary = uniqueLines([...fromSummaries, ...fromOutboundParbake]);
  if (primary.length > 0) return primary;

  const fromParbake: CompactProductLine[] = [];
  for (const line of input.computed.parbakePurposeProductionLines ?? []) {
    if (toQty(line.qty) <= 0) continue;
    const role = line.role === "astronaut" ? "우주인 파베이크(보관용)" : "판매용 파베이크(납품용)";
    const name = `${role} ${line.parbakeName}`.trim();
    fromParbake.push({ name, qty: toQty(line.qty) });
  }
  if (fromParbake.length > 0) return uniqueLines(fromParbake);

  const fromExtra: CompactProductLine[] = [];
  for (const row of input.computed.resolvedExtraParbakes ?? []) {
    if (toQty(row.qty) <= 0) continue;
    const name = productDisplayName(row.displayLabel || row.parbakeName || "추가 파베이크");
    if (!name) continue;
    fromExtra.push({ name, qty: toQty(row.qty) });
  }
  if (fromExtra.length > 0) return uniqueLines(fromExtra);

  const fromSnapshot: CompactProductLine[] = [];
  for (const p of input.snapshotProducts ?? []) {
    const name = (p.displayProductLabel ?? p.baseProductName ?? p.productName ?? "").trim();
    if (!name) continue;
    fromSnapshot.push({
      name: productDisplayName(name),
      qty: 0,
    });
  }
  if (fromSnapshot.length > 0) return uniqueLines(fromSnapshot);

  return uniqueLines(
    uniqueOutboundNames(input.logProductNames).map((name) => ({
      name: productDisplayName(name),
      qty: 0,
    }))
  );
}

export function formatCompactProductNames(lines: CompactProductLine[]): string {
  return lines
    .map((p) => (p.qty > 0 ? `${p.name} ${p.qty.toLocaleString()}개` : p.name))
    .join(", ");
}

export const COMPACT_JOURNAL_QTY_HEADERS = [
  "생산일자",
  "작성자",
  "제품명",
  "도우반죽량",
  "도우사용량",
  "보관용파베이크사용수량",
  "도우폐기량",
  "완제품폐기량",
] as const;

export type CompactJournalQtyRow = {
  date: string;
  authorName: string;
  productNames: string;
  doughMixQty: number;
  doughUsageQty: number;
  storedParbakeUsedQty: number;
  doughWasteQty: number;
  finishedWasteQty: number;
};

export function compactJournalQtyRowFromComputed(
  date: string,
  authorName: string,
  productNames: string,
  comp: ComputedResult
): CompactJournalQtyRow {
  return {
    date,
    authorName,
    productNames,
    doughMixQty: comp.doughMixQty ?? 0,
    doughUsageQty: comp.doughUsageQty ?? 0,
    storedParbakeUsedQty: comp.storedParbakeFinishedQty ?? 0,
    doughWasteQty: comp.doughWasteQty ?? 0,
    finishedWasteQty: (comp.parbakeWasteQty ?? 0) + (comp.breadWasteQty ?? 0),
  };
}

function csvCell(value: string | number): string {
  const escaped = String(value).replaceAll('"', '""');
  return `"${escaped}"`;
}

export function buildCompactJournalQtyCsv(rows: CompactJournalQtyRow[]): string {
  const lines = [
    COMPACT_JOURNAL_QTY_HEADERS.map(csvCell).join(","),
    ...rows.map((r) =>
      [
        r.date,
        r.authorName,
        r.productNames,
        r.doughMixQty,
        r.doughUsageQty,
        r.storedParbakeUsedQty,
        r.doughWasteQty,
        r.finishedWasteQty,
      ]
        .map(csvCell)
        .join(",")
    ),
  ];
  return lines.join("\n");
}

export function downloadCompactJournalQtyCsv(rows: CompactJournalQtyRow[], filename: string): void {
  const csv = buildCompactJournalQtyCsv(rows);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
