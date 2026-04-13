/** 출고/재고 화면과 동일: 이카운트 lot_no·시트 표기 → YYYY-MM-DD */
export function parseLotNoToIso(lotNo: string): string {
  const t = lotNo.trim();
  if (!t) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{4})[\.\-](\d{1,2})[\.\-](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return "";
}

/** 이카운트 화면과 비슷한 점 구분 표기 (2026.06.19) */
export function formatLotDottedFromIso(iso: string): string {
  const t = parseLotNoToIso(iso) || iso.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return iso.trim() || "—";
  const [y, m, d] = t.split("-");
  return `${y}.${m}.${d}`;
}
