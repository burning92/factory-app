import type { ComputedResult } from "./types";

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
