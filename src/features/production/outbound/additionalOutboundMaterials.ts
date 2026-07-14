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
