/**
 * 공정관리 점검일지(빵류) — 제품별 토핑 원료중량체크 평균(g).
 * DB: topping_weight_checks (jsonb) + 기존 topping_weight_check_g (단일, 하위 호환)
 */

export type ToppingWeightCheckEntry = { product: string; g: number | null };

export function parseOptionalNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** DB jsonb 배열 → 유효 항목만 */
export function parseToppingWeightChecksJson(value: unknown): ToppingWeightCheckEntry[] {
  if (!value || !Array.isArray(value)) return [];
  const out: ToppingWeightCheckEntry[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const product = String((row as { product?: unknown }).product ?? "").trim();
    if (!product) continue;
    const rawG = (row as { g?: unknown }).g;
    const g = rawG == null || rawG === "" ? null : Number(rawG);
    out.push({ product, g: Number.isFinite(g) ? g : null });
  }
  return out;
}

/** 폼 state Record (문자열 입력) */
export function entriesToWeightRecord(entries: ToppingWeightCheckEntry[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const e of entries) {
    m[e.product] = e.g != null ? String(e.g) : "";
  }
  return m;
}

/** 저장용 jsonb (제품 순서 고정) */
export function buildToppingWeightChecksJson(
  products: string[],
  weights: Record<string, string>
): ToppingWeightCheckEntry[] {
  return products.map((product) => ({
    product,
    g: parseOptionalNum(weights[product] ?? ""),
  }));
}

/** 상세/목록 표시용: json 우선, 없으면 단일 컬럼 fallback */
export function displayToppingWeightRows(header: {
  topping_weight_checks?: unknown;
  topping_weight_check_g?: number | null;
  product_name?: string | null;
}): { product: string; gLabel: string }[] {
  const fromJson = parseToppingWeightChecksJson(header.topping_weight_checks);
  if (fromJson.length > 0) {
    return fromJson.map((e) => ({
      product: e.product,
      gLabel: e.g != null ? `${e.g} g` : "—",
    }));
  }
  const legacy = header.topping_weight_check_g;
  if (legacy != null && Number.isFinite(Number(legacy))) {
    const rawName = (header.product_name ?? "").trim();
    const parts = rawName.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 1) {
      return [{ product: rawName, gLabel: `${legacy} g` }];
    }
    return [{ product: parts[0] ?? "—", gLabel: `${legacy} g` }];
  }
  return [];
}
