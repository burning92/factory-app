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

/** 생산입고·출고 화면 LOT/소비기한 직접입력 (YYYY-MM-DD, YYYY.MM.DD 등) */
export function parseHarangLotDateInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\./g, "-").replace(/\//g, "-");
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const ymd = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return ymd;
}
