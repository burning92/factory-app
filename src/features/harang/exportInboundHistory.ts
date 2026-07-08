import type { HarangInboundHeader } from "@/features/harang/types";
import { displayInboundItemUnit } from "@/features/harang/inboundDisplay";

function csvCell(value: string | number): string {
  const s = String(value ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLine(cells: (string | number)[]): string {
  return cells.map(csvCell).join(",");
}

function categoryLabel(category: string): string {
  if (category === "raw_material") return "원재료";
  if (category === "packaging_material") return "부자재";
  return category;
}

function authorLabel(header: HarangInboundHeader): string {
  const profile = Array.isArray(header.profiles) ? header.profiles[0] : header.profiles;
  return profile?.display_name || profile?.login_id || "";
}

export function buildInboundHistoryCsv(rows: HarangInboundHeader[]): string {
  const lines: string[] = [];
  lines.push(
    csvLine([
      "입고일자",
      "일자-No",
      "입고경로",
      "헤더비고",
      "등록자",
      "분류",
      "품목코드",
      "품목명",
      "소비기한",
      "수량",
      "단위",
      "품목비고",
    ]),
  );

  for (const header of rows) {
    const items = header.items ?? [];
    const base = [
      header.inbound_date,
      header.inbound_no,
      header.inbound_route,
      header.note ?? "",
      authorLabel(header),
    ];

    if (items.length === 0) {
      lines.push(csvLine([...base, "", "", "", "", "", "", ""]));
      continue;
    }

    for (const item of items) {
      lines.push(
        csvLine([
          ...base,
          categoryLabel(item.category),
          item.item_code,
          item.item_name,
          item.lot_date,
          Number(item.quantity),
          displayInboundItemUnit(item.category, item.item_name),
          item.note ?? "",
        ]),
      );
    }
  }

  return lines.join("\r\n");
}

function safeFilenamePart(raw: string): string {
  return raw.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").slice(0, 40);
}

export function downloadInboundHistoryExcel(rows: HarangInboundHeader[]): void {
  if (rows.length === 0) {
    alert("다운로드할 입고 내역이 없습니다.");
    return;
  }

  const csv = buildInboundHistoryCsv(rows);
  const today = new Date().toISOString().slice(0, 10);
  const filename = `하랑입고내역_${safeFilenamePart(today)}.csv`;

  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
