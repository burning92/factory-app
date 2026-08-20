import { classifyPlanningProductSnapshot, type ClassificationOverrides } from "@/features/production/planning/productClassification";
import { PRODUCT_LINES } from "./seedRoster";
import type { ProductLine } from "./types";

export type PlannedRotationProduct = {
  name: string;
  qty: number;
  line: ProductLine | null;
};

function compactName(name: string): string {
  return name.normalize("NFC").replace(/\s+/g, "");
}

/** 포노부오노만 세부 제품군으로 나눈다. */
export function phonoLineFromName(productName: string): ProductLine {
  const n = compactName(productName);
  if (n.includes("리코타")) return "phono_ricotta";
  if (n.includes("바질")) return "phono_basil";
  if (n.includes("초당") || n.includes("옥수수")) return "phono_corn";
  return "phono_signature";
}

/**
 * 생산계획 제품 → 로테이션 제품.
 * 피자·파베이크(보관/판매)는 전부 파베이크 자리.
 * 포노부오노 브레드만 시그니처·바질·초당·리코타로 분류.
 */
export function rotationLineFromPlanningSnapshot(
  productNameSnapshot: string,
  overrides?: ClassificationOverrides | null
): ProductLine | null {
  const classified = classifyPlanningProductSnapshot(productNameSnapshot, overrides);
  if (classified.major === "pizza" || classified.major === "parbake_storage" || classified.major === "parbake_sale") {
    return "parbake";
  }
  if (classified.major === "bread") {
    const n = compactName(productNameSnapshot);
    if (n.includes("포노")) return phonoLineFromName(productNameSnapshot);
    return null;
  }
  return null;
}

export function summarizePlannedRotationProducts(
  entries: { name: string; qty: number }[],
  overrides?: ClassificationOverrides | null
): { products: PlannedRotationProduct[]; plannedLine: ProductLine | null; mixed: boolean } {
  const products: PlannedRotationProduct[] = entries
    .filter((e) => e.name.trim() && e.qty > 0)
    .map((e) => ({
      name: e.name.trim(),
      qty: e.qty,
      line: rotationLineFromPlanningSnapshot(e.name, overrides),
    }));
  const qtyByLine = new Map<ProductLine, number>();
  for (const p of products) {
    if (!p.line) continue;
    qtyByLine.set(p.line, (qtyByLine.get(p.line) ?? 0) + p.qty);
  }
  let plannedLine: ProductLine | null = null;
  let best = -1;
  for (const [line, qty] of Array.from(qtyByLine.entries())) {
    if (qty > best) {
      best = qty;
      plannedLine = line;
    }
  }
  return { products, plannedLine, mixed: qtyByLine.size > 1 };
}

export function rotationLineLabel(line: ProductLine): string {
  return PRODUCT_LINES.find((p) => p.id === line)?.label ?? line;
}
