/** 하랑 완제품 소비기한: 생산일 기준 +364일 */
export const HARANG_FINISHED_PRODUCT_EXPIRY_OFFSET_DAYS = 364;

export function harangProductExpiryFromProductionDate(productionDateYmd: string): string {
  const s = productionDateYmd.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const d = new Date(`${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + HARANG_FINISHED_PRODUCT_EXPIRY_OFFSET_DAYS);
  return d.toISOString().slice(0, 10);
}

export function formatYmdDot(ymd: string): string {
  return ymd.slice(0, 10).replaceAll("-", ".");
}
