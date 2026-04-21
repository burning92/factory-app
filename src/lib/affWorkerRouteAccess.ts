/**
 * 조직 100(AFF) 등 일반 허브에서 `worker` 역할만 적용.
 * 하랑(200) 전용 계정·경로는 기존 AppShell 분기로 별도 처리.
 */
export function isAffRestrictedWorkerRole(role: string | null | undefined): boolean {
  return role === "worker";
}

/** 워커: 홈·생산(허브+생산계획)·원부자재(허브)·재고현황·출고현황·임원 대시보드·계정·로그인 */
export function isAffWorkerAllowedPath(pathname: string): boolean {
  if (pathname === "/" || pathname === "/production" || pathname === "/materials") return true;
  if (pathname === "/logout") return true;
  if (pathname.startsWith("/login")) return true;
  if (pathname.startsWith("/account")) return true;
  if (pathname.startsWith("/executive")) return true;
  if (pathname.startsWith("/production/plan")) return true;
  if (pathname.startsWith("/inventory/ecount")) return true;
  if (pathname.startsWith("/production/outbound-history")) return true;
  return false;
}
