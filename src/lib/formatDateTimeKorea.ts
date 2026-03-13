/** Asia/Seoul, 24시간제. 형식: YYYY.MM.DD HH:mm */
export function formatDateTimeKorea(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const fmt = new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const y = parts.find((p) => p.type === "year")?.value ?? "";
    const m = parts.find((p) => p.type === "month")?.value.padStart(2, "0") ?? "";
    const day = parts.find((p) => p.type === "day")?.value.padStart(2, "0") ?? "";
    const hour = parts.find((p) => p.type === "hour")?.value.padStart(2, "0") ?? "";
    const minute = parts.find((p) => p.type === "minute")?.value.padStart(2, "0") ?? "";
    return `${y}.${m}.${day} ${hour}:${minute}`;
  } catch {
    return "—";
  }
}
