/** 추가 파베이크 제조일 → 소비기한(+364일) — 완제품 소비기한과 동일 */
export const EXTRA_PARBAKE_SHELF_DAYS = 364;

export function addDaysYmd(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function parbakeExpiryFromManufacturedDate(manufacturedDate: string): string {
  const m = (manufacturedDate ?? "").trim();
  if (!m) return "";
  return addDaysYmd(m, EXTRA_PARBAKE_SHELF_DAYS);
}

/**
 * 저장 스냅샷 → 제조일자.
 * 레거시: expiryDate에 소비기한을 직접 저장했던 경우 −364일로 역산.
 */
export function extraParbakeManufacturedDateFromRow(row: {
  manufacturedDate?: string;
  expiryDate?: string;
}): string {
  const mfg = (row.manufacturedDate ?? "").trim();
  if (mfg) return mfg;
  const legacyExpiry = (row.expiryDate ?? "").trim();
  if (!legacyExpiry) return "";
  return addDaysYmd(legacyExpiry, -EXTRA_PARBAKE_SHELF_DAYS);
}
