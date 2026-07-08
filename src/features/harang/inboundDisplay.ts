import type { HarangCategory, HarangInboundHeader, HarangInboundItem } from "@/features/harang/types";

export function isParbakeDoughName(name: string): boolean {
  return name.replace(/\s/g, "").includes("파베이크도우");
}

/** 입고 목록·엑셀 공통 표시 단위 (DB unit 필드와 무관) */
export function displayInboundItemUnit(category: HarangCategory | string, itemName: string): "EA" | "g" {
  if (category === "packaging_material") return "EA";
  if (isParbakeDoughName(itemName)) return "EA";
  return "g";
}

export function formatInboundItemQuantity(item: Pick<HarangInboundItem, "category" | "item_name" | "quantity">): string {
  const unit = displayInboundItemUnit(item.category, item.item_name);
  return `${Number(item.quantity).toLocaleString("ko-KR")} ${unit}`;
}

export function sumInboundHeaderQuantity(header: HarangInboundHeader): string {
  const totals = new Map<string, number>();
  for (const item of header.items ?? []) {
    const unit = displayInboundItemUnit(item.category, item.item_name);
    totals.set(unit, (totals.get(unit) ?? 0) + Number(item.quantity ?? 0));
  }
  if (totals.size === 0) return "-";
  return Array.from(totals.entries())
    .map(([unit, qty]) => `${qty.toLocaleString("ko-KR")} ${unit}`)
    .join(" / ");
}
