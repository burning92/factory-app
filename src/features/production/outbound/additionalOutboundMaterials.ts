/**
 * 추가 출고 원료 옵션 — 제품별 BOM 원료.
 * 포노부오노 시그니처 화덕 브레드는 그라나파다노 캔/팩 혼용을 위해
 * 같은 계열 BOM(브레드 / 브레드 팩) 원료만 합친다.
 *
 * BOM 제품명 예:
 * - 포노부오노 시그니처 화덕 브레드 - 브레드 → 브레드 그라나파다노캔
 * - 포노부오노 시그니처 화덕 브레드 팩 - 브레드 → 브레드 그라나파다노파우더
 *
 * 레거시명(그라나파다노파우더 캔/팩)은 1차 마감 LOT 별칭용이며,
 * 추가 출고 선택지에는 넣지 않는다.
 */

export type MaterialQuantityType = "g_only" | "ea_only" | "box_ea";

export type AdditionalOutboundProductOption = {
  productName: string;
  author: string;
  materialNames: string[];
};

export type AdditionalOutboundPlan =
  | { action: "append"; logId: string }
  | { action: "create" };

export function getMaterialQuantityType(material: {
  boxWeightG?: number;
  unitWeightG?: number;
} | undefined | null): MaterialQuantityType {
  if (!material) return "g_only";
  const box = material.boxWeightG ?? 0;
  const ea = material.unitWeightG ?? 0;
  if (box === 0 && ea === 0) return "g_only";
  if (box === 0 && ea > 0) return "ea_only";
  return "box_ea";
}

export function validateAdditionalOutboundQty(
  qType: MaterialQuantityType,
  box: number,
  bag: number,
  g: number
): string | null {
  if (qType === "g_only" && g <= 0) return "g 전용 원료는 수량(g)을 1 이상 입력해 주세요.";
  if (qType === "ea_only" && bag <= 0 && g <= 0) return "낱개 또는 g 수량을 입력해 주세요.";
  if (qType === "box_ea" && box <= 0 && bag <= 0 && g <= 0) {
    return "박스/낱개/g 중 하나 이상 입력해 주세요.";
  }
  return null;
}

/** 이미 출고된 원료면 라인만 추가, 없으면 새 출고 로그 생성 */
export function planAdditionalOutbound(
  logs: Array<{ id: string; 원료명: string }>,
  materialName: string
): AdditionalOutboundPlan {
  const name = materialName.trim();
  const existing = logs.find((l) => (l.원료명 ?? "").trim() === name);
  if (existing) return { action: "append", logId: existing.id };
  return { action: "create" };
}

/** production_logs에 출고가 잡힌 생산일자 목록 (최신순) */
export function listProductionOutboundDates(
  logs: Array<{ 생산일자: string }>
): string[] {
  const set = new Set<string>();
  for (const log of logs) {
    const day = (log.생산일자 ?? "").slice(0, 10);
    if (day) set.add(day);
  }
  return Array.from(set).sort((a, b) => b.localeCompare(a));
}

/** URL·오늘·최근 출고일 순으로 유효한 생산일자 선택 */
export function pickProductionOutboundDate(
  dates: string[],
  preferred?: string,
  todayIso?: string
): string {
  const day = (preferred ?? "").slice(0, 10);
  if (day && dates.includes(day)) return day;
  const today = (todayIso ?? "").slice(0, 10);
  if (today && dates.includes(today)) return today;
  return dates[0] ?? day ?? today ?? "";
}

export function listAdditionalOutboundProducts(
  logs: Array<{
    생산일자: string;
    제품명: string;
    원료명: string;
    출고자?: string;
    작성자2?: string;
  }>,
  date: string
): AdditionalOutboundProductOption[] {
  const day = date.slice(0, 10);
  const map = new Map<string, AdditionalOutboundProductOption>();
  for (const log of logs) {
    if ((log.생산일자 ?? "").slice(0, 10) !== day) continue;
    const productName = (log.제품명 ?? "").trim();
    if (!productName) continue;
    const material = (log.원료명 ?? "").trim();
    const existing = map.get(productName);
    if (existing) {
      if (material && existing.materialNames.indexOf(material) < 0) {
        existing.materialNames.push(material);
      }
      continue;
    }
    map.set(productName, {
      productName,
      author: (log.출고자 ?? log.작성자2 ?? "").trim(),
      materialNames: material ? [material] : [],
    });
  }
  return Array.from(map.values()).sort((a, b) => a.productName.localeCompare(b.productName, "ko-KR"));
}

const PONO_BREAD_BASE_NAME = "포노부오노 시그니처 화덕 브레드";

/** 캔(본품) + 팩 제품명 모두 포노브레드 계열로 취급 */
function isPonoBreadFamily(productName: string): boolean {
  const raw = (productName ?? "").trim();
  if (!raw) return false;
  return raw === PONO_BREAD_BASE_NAME || raw.startsWith(`${PONO_BREAD_BASE_NAME} `);
}

/**
 * 추가 출고 드롭다운용 원료명 목록.
 * 일반 제품: 해당 제품명 BOM만.
 * 포노 시그니처 화덕 브레드(팩 포함): 계열 BOM 원료 합집합만.
 */
export function getBomMaterialNamesForAdditionalOutbound(
  productName: string,
  bomMaterialNamesByProduct: Map<string, string[]>
): string[] {
  const direct = bomMaterialNamesByProduct.get(productName) ?? [];
  if (!isPonoBreadFamily(productName)) return direct;

  const set = new Set<string>();
  // ES5 target: Map은 for...of 대신 Array.from 사용
  for (const [bomProduct, materials] of Array.from(bomMaterialNamesByProduct.entries())) {
    if (!isPonoBreadFamily(bomProduct)) continue;
    for (const m of materials) {
      const name = (m ?? "").trim();
      if (name) set.add(name);
    }
  }

  return set.size > 0 ? Array.from(set) : direct;
}
