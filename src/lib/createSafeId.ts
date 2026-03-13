/**
 * 환경에 관계없이 안전하게 고유 ID 문자열을 생성합니다.
 * crypto.randomUUID가 없는 환경(HTTP, 구형/일부 모바일 브라우저)에서도 페이지가 죽지 않도록
 * randomUUID를 호출하지 않고 getRandomValues 또는 fallback만 사용합니다.
 *
 * 우선순위:
 * 1. crypto.getRandomValues 기반 UUID v4 (가능하면 사용)
 * 2. Date.now + Math.random fallback
 */
export function createSafeId(): string {
  try {
    const c = typeof globalThis !== "undefined" ? globalThis.crypto : typeof crypto !== "undefined" ? crypto : undefined;
    if (c && typeof c.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      c.getRandomValues(bytes);
      bytes[6] = (bytes[6]! & 0x0f) | 0x40;
      bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch (_) {
    // ignore
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
