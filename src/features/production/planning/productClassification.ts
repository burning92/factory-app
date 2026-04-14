/**
 * 제품 분류 (1차: 설정 파일). 추후 DB 마스터로 이전 시 이 모듈만 교체하면 된다.
 * UI에서는 문자열 includes 분기 대신 이 모듈의 함수만 사용한다.
 */

import { baseProductName } from "./calculations";

export type MajorCategory = "pizza" | "bread" | "parbake_storage" | "parbake_sale" | "unclassified";

export type PizzaSubtype = "light" | "heavy" | "mini";

export type ProductClassification = {
  major: MajorCategory;
  /** 피자가 아니면 null */
  pizzaSubtype: PizzaSubtype | null;
};

/**
 * 베이스 제품명(조건 제외) → 분류.
 * 키는 BOM/계획에 쓰이는 표기와 동일하게 유지한다.
 */
const BASE_NAME_TO_CLASS: Record<string, ProductClassification> = {
  포노브레드: { major: "bread", pizzaSubtype: null },
  "미니 마르게리따(2입)": { major: "pizza", pizzaSubtype: "mini" },
  "미니 고르곤졸라(2입)": { major: "pizza", pizzaSubtype: "mini" },
  "미니 페퍼로니(2입)": { major: "pizza", pizzaSubtype: "mini" },
  허니고르곤졸라: { major: "pizza", pizzaSubtype: "light" },
  마르게리따: { major: "pizza", pizzaSubtype: "light" },
  허니갈릭페퍼로니: { major: "pizza", pizzaSubtype: "heavy" },
  청양페퍼로니: { major: "pizza", pizzaSubtype: "heavy" },
  "트리플치즈 라구": { major: "pizza", pizzaSubtype: "heavy" },
  트리플치즈라구: { major: "pizza", pizzaSubtype: "heavy" },
  "머쉬룸 베이컨피자": { major: "pizza", pizzaSubtype: "heavy" },
  파이브치즈: { major: "pizza", pizzaSubtype: "heavy" },
  통통옥수수: { major: "pizza", pizzaSubtype: "heavy" },
  시금치베이컨리코타: { major: "pizza", pizzaSubtype: "heavy" },
  핫페퍼로니: { major: "pizza", pizzaSubtype: "heavy" },
  "바질페스토 마스카포네": { major: "pizza", pizzaSubtype: "heavy" },
  로제쉬림프: { major: "pizza", pizzaSubtype: "heavy" },
  "조선호텔 고르곤졸라": { major: "pizza", pizzaSubtype: "heavy" },
  "머쉬룸 고트피자": { major: "pizza", pizzaSubtype: "heavy" },
  "선인 파베이크_토마토": { major: "parbake_sale", pizzaSubtype: null },
  "선인 파베이크_베샤멜": { major: "parbake_sale", pizzaSubtype: null },
  "우주인 파베이크_토마토": { major: "parbake_storage", pizzaSubtype: null },
  "우주인 파베이크_베샤멜": { major: "parbake_storage", pizzaSubtype: null },
  멜팅치즈: { major: "pizza", pizzaSubtype: "heavy" },
  구운가지리코타: { major: "pizza", pizzaSubtype: "heavy" },
  /** 현장/ BOM 에서 쓰이는 변형 표기 (스크린샷·생산계획 동기화 기준) */
  "포노부오노 시그니처 화덕 브레드": { major: "bread", pizzaSubtype: null },
  우주인토마토파베이크: { major: "parbake_storage", pizzaSubtype: null },
  "우주인 토마토 파베이크": { major: "parbake_storage", pizzaSubtype: null },
  우주인베샤멜파베이크: { major: "parbake_storage", pizzaSubtype: null },
  "우주인 베샤멜 파베이크": { major: "parbake_storage", pizzaSubtype: null },
  선인토마토파베이크: { major: "parbake_sale", pizzaSubtype: null },
  "선인 토마토 파베이크": { major: "parbake_sale", pizzaSubtype: null },
  선인베샤멜파베이크: { major: "parbake_sale", pizzaSubtype: null },
  "선인 베샤멜 파베이크": { major: "parbake_sale", pizzaSubtype: null },
  "판매용 파베이크 베샤멜": { major: "parbake_sale", pizzaSubtype: null },
  "판매용 파베이크베샤멜": { major: "parbake_sale", pizzaSubtype: null },
  판매용파베이크베샤멜: { major: "parbake_sale", pizzaSubtype: null },
  "판매용 파베이크 토마토": { major: "parbake_sale", pizzaSubtype: null },
  "판매용 파베이크토마토": { major: "parbake_sale", pizzaSubtype: null },
  판매용파베이크토마토: { major: "parbake_sale", pizzaSubtype: null },
};

/**
 * 명시 목록에 없을 때만 적용하는 보조 규칙 (한 파일에 모음).
 * 신제품은 BASE_NAME_TO_CLASS에 추가하는 것을 우선한다.
 */
function classifyByFallbackRules(normalizedBase: string): ProductClassification | null {
  const b = normalizedBase;
  if (!b) return null;
  // 브레드: 포노 계열 확장 시 이름만 맞으면 Bread로 묶임 (파베이크와 충돌 방지)
  if (b.includes("포노") && !b.includes("파베이크")) {
    return { major: "bread", pizzaSubtype: null };
  }
  if (b.includes("선인") && b.includes("파베이크")) {
    return { major: "parbake_sale", pizzaSubtype: null };
  }
  if (b.includes("판매용") && b.includes("파베이크")) {
    return { major: "parbake_sale", pizzaSubtype: null };
  }
  if (b.includes("우주인") && b.includes("파베이크")) {
    return { major: "parbake_storage", pizzaSubtype: null };
  }
  // 미니(2입) 계열: BOM 에 공백 없이 들어오는 경우
  if (b.includes("미니") && b.includes("2입")) {
    return { major: "pizza", pizzaSubtype: "mini" };
  }
  return null;
}

function normalizeBaseKey(name: string): string {
  return name.normalize("NFC").trim();
}

export function classifyProductBaseName(productBaseName: string): ProductClassification {
  const key = normalizeBaseKey(productBaseName);
  const direct = BASE_NAME_TO_CLASS[key];
  if (direct) return direct;
  const fallback = classifyByFallbackRules(key);
  if (fallback) return fallback;
  return { major: "unclassified", pizzaSubtype: null };
}

/** full snapshot(`베이스 - 조건`) → 분류 */
export function classifyPlanningProductSnapshot(productNameSnapshot: string): ProductClassification {
  return classifyProductBaseName(baseProductName(productNameSnapshot));
}

/** 달력/카드 색상용 (tailwind 클래스만 반환) */
export function getPlanningEntryToneClass(productNameSnapshot: string): string {
  const { major, pizzaSubtype } = classifyPlanningProductSnapshot(productNameSnapshot);
  if (major === "bread") return "bg-amber-500/20 text-amber-100 border border-amber-500/40";
  if (major === "parbake_storage") return "bg-sky-500/20 text-sky-100 border border-sky-500/40";
  if (major === "parbake_sale") return "bg-emerald-500/20 text-emerald-100 border border-emerald-500/40";
  if (major === "pizza") {
    if (pizzaSubtype === "mini") return "bg-teal-500/20 text-teal-100 border border-teal-500/40";
    if (pizzaSubtype === "light") return "bg-cyan-500/20 text-cyan-100 border border-cyan-500/40";
    return "bg-violet-500/20 text-violet-100 border border-violet-500/40";
  }
  return "bg-slate-600/40 text-slate-200 border border-slate-500/40";
}

/** 제품별 월 합계 표의 구분 칩 스타일 */
export function categoryBadgeClassName(c: ProductClassification): string {
  if (c.major === "bread") return "border-amber-500/40 bg-amber-500/15 text-amber-100";
  if (c.major === "parbake_storage") return "border-sky-500/40 bg-sky-500/15 text-sky-100";
  if (c.major === "parbake_sale") return "border-emerald-500/40 bg-emerald-500/15 text-emerald-100";
  if (c.major === "pizza") {
    if (c.pizzaSubtype === "mini") return "border-teal-500/40 bg-teal-500/15 text-teal-100";
    if (c.pizzaSubtype === "light") return "border-cyan-500/40 bg-cyan-500/15 text-cyan-100";
    if (c.pizzaSubtype === "heavy") return "border-violet-500/40 bg-violet-500/15 text-violet-100";
    return "border-slate-500/40 bg-slate-600/30 text-slate-200";
  }
  if (c.major === "unclassified") return "border-rose-500/35 bg-rose-500/10 text-rose-100";
  return "border-slate-600 bg-slate-700/50 text-slate-300";
}

export function categoryBadgeLabel(c: ProductClassification): string {
  if (c.major === "bread") return "Bread";
  if (c.major === "parbake_storage") return "파베이크(보관)";
  if (c.major === "parbake_sale") return "파베이크(판매)";
  if (c.major === "pizza") {
    if (c.pizzaSubtype === "light") return "피자·라이트";
    if (c.pizzaSubtype === "heavy") return "피자·헤비";
    if (c.pizzaSubtype === "mini") return "피자·미니";
    return "피자";
  }
  return "미분류";
}
