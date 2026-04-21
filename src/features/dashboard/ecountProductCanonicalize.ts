/**
 * 이카운트 품목명 → 계획/대시보드 기준 표준명.
 * planVsActual, ecountProductionImport 에서 공통 사용.
 */

export function canonicalizeEcountProductName(nameRaw: string): string {
  const name = nameRaw.normalize("NFKC").trim();
  const n = name.toLowerCase().replace(/\s+/g, " ");

  if (n.includes("포노부오노 시그니처 화덕브레드") || n.includes("포노부오노 시그니처 화덕 브레드")) {
    return "포노브레드";
  }
  if (
    n.includes("우주인 화덕파베이크 도우-토마토") ||
    n.includes("우주인 화덕 파베이크도우") ||
    n.includes("우주인 토마토 파베이크")
  ) {
    return "우주인 파베이크_토마토";
  }
  if (n.includes("선인 토마토 파베이크 도우")) return "선인 파베이크_토마토";
  if (n.includes("선인 베샤멜 파베이크 도우")) return "선인 파베이크_베샤멜";
  if (n.includes("우주인 화덕파베이크- 베샤멜") || n.includes("우주인 베샤멜 파베이크")) {
    return "우주인 파베이크_베샤멜";
  }
  if (n.includes("마르게리따-2")) return "마르게리따";
  if (n.includes("우주인피자 트리플치즈 라구")) return "트리플치즈 라구";
  // 트리플치즈 라구: 계획/실적 소스별 띄어쓰기 차이를 하나의 키로 통합
  if (n.includes("트리플치즈라구") || n.includes("트리플치즈 라구")) return "트리플치즈 라구";
  if (n.includes("조선호텔 고르곤졸라 피자")) return "조선호텔 고르곤졸라";
  if (n.includes("시금치 베이컨 리코타")) return "시금치베이컨리코타";
  if (n.includes("멜팅치즈피자")) return "멜팅치즈";
  if (n.includes("머쉬룸 베이컨")) return "머쉬룸 베이컨피자";
  if (n.includes("핫 페퍼로니피자")) return "핫페퍼로니";
  if (n.includes("미니피자 허니고르곤졸라")) return "미니 고르곤졸라(2입)";
  if (n.includes("미니피자 마르게리따")) return "미니 마르게리따(2입)";
  if (n.includes("미니피자 페퍼로니")) return "미니 페퍼로니(2입)";
  if (n.includes("우주인피자 통통 옥수수")) return "통통옥수수";

  return name;
}

/** 커피 등 생산량 집계 제외 */
export function isEcountNonProductionLine(rawName: string): boolean {
  const n = rawName.normalize("NFKC").toLowerCase();
  return n.includes("발리 블렌드");
}

/**
 * 이카운트 생산입고 수량 배수: 품목명에 `2입`이 **명시**된 경우에만 세트→낱개 ×2.
 * `미니피자 …` 라인은 ERP에서 이미 낱개로 적재되는 경우가 많아 곱하지 않음(예: 미니피자 마르게리따 770).
 */
export function ecountQuantityMultiplierFromRaw(rawName: string): number {
  const n = rawName.normalize("NFKC").toLowerCase();
  if (n.includes("2입")) return 2;
  return 1;
}

export function mapEcountImportLine(rawName: string): { canonicalName: string | null; multiplier: number } {
  const trimmed = rawName.normalize("NFKC").trim();
  if (!trimmed) return { canonicalName: null, multiplier: 1 };
  if (isEcountNonProductionLine(trimmed)) return { canonicalName: null, multiplier: 1 };
  return {
    canonicalName: canonicalizeEcountProductName(trimmed),
    multiplier: ecountQuantityMultiplierFromRaw(trimmed),
  };
}
