/**
 * Step 3: 사용량 계산 엔진 (날짜 그룹 1건 기준)
 * UI와 분리된 pure function. Step 4에서 computedResult 그대로 사용.
 */

import type {
  DateGroupInput,
  BomRowRef,
  ComputedResult,
  LotUsageRow,
  ProductSummary,
  ProductClassification,
  ResolvedExtraParbake,
  UnresolvedExtraParbake,
  BaseWasteResult,
  BaseUsageResult,
  BaseWasteRow,
  BaseUsageRow,
  FifoLotRow,
  ParbakeWasteByTypeInput,
} from "./types";
import { getDoughBaseRowsFromGeneralBom } from "./bomAdapter";

export type { ComputedResult };

/** Step 3.5: 제품 기준(productStandardName)별 분류 */
function getProductClassification(productStandardName: string): ProductClassification {
  const std = (productStandardName ?? "").trim();
  if (std === "파베이크사용") {
    return {
      usesTodayDough: false,
      usesStoredParbake: true,
      isBreadProduct: false,
      requiresBaseSauceBom: true,
      participatesInParbakeTypeInference: true,
    };
  }
  if (std === "브레드") {
    return {
      usesTodayDough: true,
      usesStoredParbake: false,
      isBreadProduct: true,
      requiresBaseSauceBom: false,
      participatesInParbakeTypeInference: false,
    };
  }
  // 그 외 (일반, 미니 등): 기존 로직 유지. TODO: 필요 시 기준별 세분화
  return {
    usesTodayDough: true,
    usesStoredParbake: false,
    isBreadProduct: false,
    requiresBaseSauceBom: true,
    participatesInParbakeTypeInference: true,
  };
}

/** 재고 미입력(빈 문자열/null/undefined)은 0으로 처리 → actualUsageQty = outboundQty + 0 - 0 = outboundQty */
function toNum(x: number | "" | null | undefined): number {
  if (x === "" || x === null || x === undefined) return 0;
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/** 기준정보 원료: 1개 중량(g) 및 g전용 판별용 */
export type MaterialMeta = {
  materialName: string;
  unitWeightG: number;
  boxWeightG: number;
};

/** 전날/당일 재고를 낱개+잔량(g)에서 총 g로 환산. g전용이면 잔량(g)만 사용 */
function stockToG(
  unitCount: number | "",
  remainderG: number | "",
  meta: MaterialMeta | undefined
): number {
  const u = toNum(unitCount);
  const r = toNum(remainderG);
  if (!meta) return r;
  const isGOnly = meta.boxWeightG === 0 && meta.unitWeightG === 0;
  if (isGOnly || meta.unitWeightG <= 0) return r;
  return u * meta.unitWeightG + r;
}

/** 원료 LOT별 실제 사용량 = 전날재고(g환산) + 출고량 - 당일재고(g환산) */
export function calculateLotUsages(
  materials: DateGroupInput["materials"],
  materialsMeta?: MaterialMeta[]
): { lotUsages: LotUsageRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const lotUsages: LotUsageRow[] = [];
  const metaByName = new Map<string, MaterialMeta>();
  if (Array.isArray(materialsMeta)) {
    for (const m of materialsMeta) {
      const name = (m.materialName ?? "").trim();
      if (name) metaByName.set(name, m);
    }
  }

  for (const card of materials) {
    const meta = metaByName.get((card.materialName ?? "").trim());
    for (const row of card.lots) {
      const prevG = stockToG(
        row.prevDayUnitCount ?? "",
        row.prevDayRemainderG ?? "",
        meta
      );
      const currG = stockToG(
        row.currentDayUnitCount ?? "",
        row.currentDayRemainderG ?? "",
        meta
      );
      const out = toNum(row.outboundQty);
      const actualUsageQty = prevG + out - currG;
      if (actualUsageQty < 0) {
        warnings.push(
          `원료 [${card.materialName}] LOT ${row.expiryDate || "(미입력)"}: 실제 사용량이 음수입니다 (${actualUsageQty}).`
        );
      }
      lotUsages.push({
        lotRowId: row.lotRowId,
        materialCardId: card.materialCardId,
        materialName: card.materialName,
        sourceType: row.sourceType,
        expiryDate: row.expiryDate,
        outboundQty: out,
        prevDayStockQty: prevG,
        currentDayStockQty: currG,
        actualUsageQty,
      });
    }
  }
  return { lotUsages, warnings };
}

/** 도우소스 materialName → 파베이크 표시 이름 */
function parbakeNameFromBaseSauce(materialName: string): string | null {
  const name = (materialName ?? "").trim();
  if (/도우.*토마토|토마토.*도우/i.test(name)) return "토마토 파베이크";
  if (/도우.*베샤멜|베샤멜.*도우/i.test(name)) return "베샤멜 파베이크";
  if (/도우.*로제|로제.*도우/i.test(name)) return "로제 파베이크";
  if (/도우.*바질|바질.*도우/i.test(name)) return "바질 파베이크";
  if (/도우.*치즈|치즈.*도우/i.test(name)) return "베샤멜 파베이크";
  return null;
}

/**
 * 제품 BOM "일반" + 하위원료 "도우" 기준: 파베이크 이름 + 도우소스 정보 판별.
 * 호출 측에서 requiresBaseSauceBom === true 일 때만 반환된 warnings를 사용할 것.
 * (브레드 등 requiresBaseSauceBom === false 인 제품에는 호출하지 않음)
 */
export function inferParbakeMetaFromBom(
  baseProductName: string,
  bomList: BomRowRef[]
): {
  inferredParbakeName: string | null;
  inferredBaseSauceMaterialName: string | null;
  inferredBaseSaucePerUnitQty: number | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  const doughRows = getDoughBaseRowsFromGeneralBom(baseProductName, bomList);
  if (doughRows.length === 0) {
    warnings.push(
      `제품 [${baseProductName}]에 대한 BOM(일반+도우)이 없습니다.`
    );
    return {
      inferredParbakeName: null,
      inferredBaseSauceMaterialName: null,
      inferredBaseSaucePerUnitQty: null,
      warnings,
    };
  }

  const sauceCandidates = doughRows.filter(
    (r) =>
      /도우.*소스|소스.*도우/i.test(r.materialName) &&
      !/토핑/i.test(r.materialName)
  );

  if (sauceCandidates.length === 0) {
    return {
      inferredParbakeName: null,
      inferredBaseSauceMaterialName: null,
      inferredBaseSaucePerUnitQty: null,
      warnings,
    };
  }

  const parbakeNames = new Set<string>();
  let baseSauceMaterialName: string | null = null;
  let baseSaucePerUnitQty: number | null = null;

  for (const row of sauceCandidates) {
    const parbakeName = parbakeNameFromBaseSauce(row.materialName);
    if (parbakeName) parbakeNames.add(parbakeName);
    if (!baseSauceMaterialName) {
      baseSauceMaterialName = row.materialName;
      baseSaucePerUnitQty = row.bomGPerEa ?? null;
    }
  }

  if (parbakeNames.size > 1) {
    warnings.push(
      `제품 [${baseProductName}]: 도우 소스가 여러 종류입니다. 파베이크 이름을 자동 확정하지 않습니다.`
    );
  }

  const inferredParbakeName =
    parbakeNames.size === 1 ? Array.from(parbakeNames)[0]! : null;
  return {
    inferredParbakeName,
    inferredBaseSauceMaterialName: baseSauceMaterialName,
    inferredBaseSaucePerUnitQty: baseSaucePerUnitQty ?? null,
    warnings,
  };
}

/** 완제품 합계 / 추가 파베이크 합계 등 */
function calculateTotals(state: DateGroupInput) {
  const totalFinishedQty = state.secondClosure.productOutputs.reduce(
    (s, o) => s + toNum(o.finishedQty),
    0
  );
  const totalExtraParbakeQty = state.secondClosure.extraParbakes.reduce(
    (s, e) => s + toNum(e.qty),
    0
  );
  const astronautParbakeQty = toNum(state.secondClosure.astronautParbakeQty);
  const saleParbakeQty = toNum(state.secondClosure.saleParbakeQty);
  return {
    totalFinishedQty,
    totalExtraParbakeQty,
    astronautParbakeQty,
    saleParbakeQty,
  };
}

/** 파베이크 폐기량 / 도우 사용량 / 당일 파베이크 생산량 (개수 기준) */
function calculateParbakeAndDough(
  state: DateGroupInput,
  totals: ReturnType<typeof calculateTotals>
): {
  parbakeWasteQty: number;
  doughUsageQty: number;
  sameDayParbakeProductionQty: number;
  doughMixQty: number;
  doughWasteQty: number;
  warnings: string[];
} {
  const warnings: string[] = [];
  const doughMixQty = toNum(state.doughMixQty);
  const doughWasteQty = toNum(state.doughWasteQty);
  const { totalFinishedQty, totalExtraParbakeQty, astronautParbakeQty, saleParbakeQty } = totals;

  const parbakeWasteQty =
    doughMixQty +
    totalExtraParbakeQty -
    totalFinishedQty -
    (astronautParbakeQty + saleParbakeQty) -
    doughWasteQty;

  if (parbakeWasteQty < 0) {
    warnings.push(
      `파베이크 폐기량이 음수입니다 (${parbakeWasteQty}). 입력값을 확인해 주세요.`
    );
  }

  const doughUsageQty = doughMixQty - (parbakeWasteQty + doughWasteQty);
  if (doughUsageQty < 0) {
    warnings.push(
      `도우 사용량이 음수입니다 (${doughUsageQty}). 입력값을 확인해 주세요.`
    );
  }

  const sameDayParbakeProductionQty = doughUsageQty;

  return {
    parbakeWasteQty,
    doughUsageQty,
    sameDayParbakeProductionQty,
    doughMixQty,
    doughWasteQty,
    warnings,
  };
}

/** 날짜 기준 파베이크 종류 집합. participatesInParbakeTypeInference === true 인 제품만 포함 (브레드 제외). 총괄/혼합 베이스 판별용으로 export */
export function getDateParbakeTypes(productSummaries: ProductSummary[]): string[] {
  const set = new Set<string>();
  for (const p of productSummaries) {
    if (p.participatesInParbakeTypeInference && p.inferredParbakeName) {
      set.add(p.inferredParbakeName);
    }
  }
  return Array.from(set);
}

/** 추가 파베이크 이름 해석: 1종이면 resolved, 2종 이상이면 unresolved */
function resolveExtraParbakes(
  state: DateGroupInput,
  dateParbakeTypes: string[],
  productSummaries: ProductSummary[]
): {
  resolved: ResolvedExtraParbake[];
  unresolved: UnresolvedExtraParbake[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const resolved: ResolvedExtraParbake[] = [];
  const unresolved: UnresolvedExtraParbake[] = [];

  if (dateParbakeTypes.length === 0) {
    for (const row of state.secondClosure.extraParbakes) {
      const qty = toNum(row.qty);
      if (qty === 0 && !row.expiryDate.trim()) continue;
      unresolved.push({
        extraParbakeId: row.extraParbakeId,
        qty,
        expiryDate: row.expiryDate,
        reason: "해당 날짜 완제품 BOM에서 파베이크 종류를 판별할 수 없습니다.",
      });
    }
    return { resolved, unresolved, warnings };
  }

  if (dateParbakeTypes.length > 1) {
    warnings.push(
      `당일 파베이크 종류가 2종 이상입니다 (${dateParbakeTypes.join(", ")}). 추가 파베이크 행에 종류를 자동 확정하지 않습니다.`
    );
    for (const row of state.secondClosure.extraParbakes) {
      const qty = toNum(row.qty);
      if (qty === 0 && !row.expiryDate.trim()) continue;
      unresolved.push({
        extraParbakeId: row.extraParbakeId,
        qty,
        expiryDate: row.expiryDate,
        reason: "파베이크 종류가 2종 이상이라 자동 확정하지 않습니다.",
      });
    }
    return { resolved, unresolved, warnings };
  }

  const parbakeName = dateParbakeTypes[0]!;
  const candidates = productSummaries.filter(
    (p) =>
      p.participatesInParbakeTypeInference && p.inferredParbakeName === parbakeName
  );
  const productCandidates = candidates.map((p) => ({
    productKey: p.productKey,
    productName: p.productName,
    standardName: p.productStandardName,
    displayProductLabel: p.displayProductLabel,
    baseProductName: p.baseProductName,
  }));

  for (const row of state.secondClosure.extraParbakes) {
    const qty = toNum(row.qty);
    const displayLabel =
      qty > 0
        ? `${parbakeName} ${qty}개 (${row.expiryDate || "—"})`
        : `${parbakeName} 0개 (${row.expiryDate || "—"})`;
    resolved.push({
      extraParbakeId: row.extraParbakeId,
      parbakeName,
      qty,
      expiryDate: row.expiryDate,
      displayLabel,
      productCandidates,
      targetProductResolved: productCandidates.length === 1,
    });
  }
  return { resolved, unresolved, warnings };
}

/** 우주인/판매용 파베이크 출력 라벨 (1종일 때만) */
function getAstronautSaleLabels(
  astronautParbakeQty: number,
  saleParbakeQty: number,
  dateParbakeTypes: string[]
): { astronaut: string | null; sale: string | null; warnings: string[] } {
  const warnings: string[] = [];
  if (dateParbakeTypes.length === 0) {
    return { astronaut: null, sale: null, warnings };
  }
  if (dateParbakeTypes.length > 1) {
    warnings.push("파베이크 종류가 2종 이상이라 우주인/판매용 라벨을 자동 생성하지 않습니다.");
    return { astronaut: null, sale: null, warnings };
  }
  const name = dateParbakeTypes[0]!;
  return {
    astronaut: `${name} ${astronautParbakeQty}개`,
    sale: `${name} ${saleParbakeQty}개`,
    warnings,
  };
}

/** 단일 파베이크 종류에 대한 가중 g/ea 및 베이스 소스명 */
function getWeightedBaseSauceForType(
  parbakeName: string,
  productSummaries: ProductSummary[]
): { baseSauceMaterialName: string; weightedBaseSaucePerUnitQty: number } | null {
  const candidates = productSummaries.filter(
    (p) =>
      p.requiresBaseSauceBom &&
      p.inferredParbakeName === parbakeName &&
      p.inferredBaseSaucePerUnitQty != null
  );
  if (candidates.length === 0) return null;
  let totalQty = 0;
  let weightedSum = 0;
  for (const p of candidates) {
    totalQty += p.finishedQty;
    weightedSum += p.finishedQty * (p.inferredBaseSaucePerUnitQty ?? 0);
  }
  const weightedBaseSaucePerUnitQty = totalQty > 0 ? weightedSum / totalQty : 0;
  const baseSauceMaterialName = candidates[0]!.inferredBaseSauceMaterialName ?? "";
  return { baseSauceMaterialName, weightedBaseSaucePerUnitQty };
}

/** 베이스(도우소스) 폐기량 g: parbakeWasteQty × 가중평균 g/ea. 1종일 때만 계산 (레거시 단일 결과용) */
function calculateBaseWaste(
  parbakeWasteQty: number,
  productSummaries: ProductSummary[],
  dateParbakeTypes: string[]
): BaseWasteResult & { warnings: string[] } {
  const warnings: string[] = [];
  if (dateParbakeTypes.length === 0) {
    return { resolved: false, warnings };
  }
  if (dateParbakeTypes.length > 1) {
    warnings.push(
      "파베이크 종류가 2종 이상이라 베이스 폐기량(g)을 자동 배분하지 않습니다."
    );
    return { resolved: false, warnings };
  }

  const parbakeName = dateParbakeTypes[0]!;
  const meta = getWeightedBaseSauceForType(parbakeName, productSummaries);
  if (!meta) {
    warnings.push(
      `파베이크 [${parbakeName}] 제품에 도우소스 BOM g/ea가 없어 베이스 폐기량을 계산할 수 없습니다.`
    );
    return { resolved: false, warnings };
  }

  const baseWasteQty = Math.round(parbakeWasteQty * meta.weightedBaseSaucePerUnitQty);
  return {
    resolved: true,
    parbakeName,
    baseSauceMaterialName: meta.baseSauceMaterialName,
    weightedBaseSaucePerUnitQty: meta.weightedBaseSaucePerUnitQty,
    baseWasteQty,
    warnings,
  };
}

/**
 * 혼합 베이스: 공란(미입력)과 숫자(0 포함)를 구분해 타입별 파베이크 폐기(개)를 확정한다.
 * - 명시된 숫자는 그대로 사용(0 포함). 공란은 총량 대비 나머지로 보정할 수 있음
 * - 공란이 1개면: 그 타입 = 총 파베이크 폐기량 − 다른 타입의 합
 * - 모두 공란이거나 공란이 2개 이상이면 실패
 * - 모두 숫자면 합계가 총량과 일치해야 함
 */
export function resolveMixedParbakeWasteByTypeCounts(
  parbakeWasteByType: ParbakeWasteByTypeInput[] | undefined,
  dateParbakeTypes: string[],
  totalParbakeWasteQty: number
): { resolved: Map<string, number> | null; warnings: string[] } {
  const warnings: string[] = [];
  const totalInt = Math.max(0, Math.floor(totalParbakeWasteQty));
  const rows = parbakeWasteByType ?? [];

  const explicitFor = (parbakeName: string): number | null => {
    const row = rows.find((t) => (t.parbakeName ?? "").trim() === parbakeName.trim());
    if (!row) return null;
    const w = row.wasteQty;
    if (w === "" || w === undefined || w === null) return null;
    if (typeof w === "number" && Number.isFinite(w)) {
      return Math.max(0, Math.floor(w));
    }
    return null;
  };

  const entries = dateParbakeTypes.map((name) => ({
    name,
    explicit: explicitFor(name),
  }));

  const emptyNames = entries.filter((e) => e.explicit === null).map((e) => e.name);
  const filledSum = entries.reduce((s, e) => s + (e.explicit ?? 0), 0);

  if (emptyNames.length === dateParbakeTypes.length) {
    warnings.push(
      "혼합 베이스: 파베이크 폐기량 상세에서 종류별 수량을 입력해 주세요. 한 종류만 숫자로 입력하면 나머지는 총 파베이크 폐기량에서 채워집니다."
    );
    return { resolved: null, warnings };
  }

  if (emptyNames.length >= 2) {
    warnings.push(
      "혼합 베이스: 공란인 종류가 2종류 이상입니다. 종류별로 숫자를 입력하거나, 한 종류만 입력해 주세요."
    );
    return { resolved: null, warnings };
  }

  const out = new Map<string, number>();

  if (emptyNames.length === 1) {
    const onlyEmpty = emptyNames[0]!;
    const sumOther = entries
      .filter((e) => e.explicit !== null)
      .reduce((s, e) => s + (e.explicit as number), 0);
    const rest = totalInt - sumOther;
    if (rest < 0) {
      warnings.push(
        `혼합 베이스: 입력한 폐기량 합계(${sumOther}개)가 총 파베이크 폐기량(${totalInt}개)을 초과합니다.`
      );
      return { resolved: null, warnings };
    }
    for (const e of entries) {
      if (e.explicit !== null) out.set(e.name, e.explicit);
    }
    out.set(onlyEmpty, rest);
    return { resolved: out, warnings };
  }

  /** 모두 숫자로 채워짐 */
  if (filledSum !== totalInt) {
    warnings.push(
      `혼합 베이스: 종류별 폐기량 합계(${filledSum}개)가 총 파베이크 폐기량(${totalInt}개)과 일치하지 않습니다.`
    );
    return { resolved: null, warnings };
  }
  for (const e of entries) {
    out.set(e.name, e.explicit ?? 0);
  }
  return { resolved: out, warnings };
}

/** 총괄(P1) 베이스 폐기량 행 배열. 단일 종류면 1행(자동). 혼합이면 타입별 1행(parbakeWasteByType 규칙 반영) */
function calculateBaseWasteRows(
  state: DateGroupInput,
  parbakeWasteQty: number,
  productSummaries: ProductSummary[],
  dateParbakeTypes: string[]
): { rows: BaseWasteRow[]; warnings: string[] } {
  const warnings: string[] = [];
  if (dateParbakeTypes.length === 0) {
    return { rows: [], warnings };
  }

  if (dateParbakeTypes.length === 1) {
    const single = calculateBaseWaste(parbakeWasteQty, productSummaries, dateParbakeTypes);
    warnings.push(...single.warnings);
    return {
      rows: [
        {
          resolved: single.resolved,
          parbakeName: single.parbakeName,
          baseSauceMaterialName: single.baseSauceMaterialName,
          weightedBaseSaucePerUnitQty: single.weightedBaseSaucePerUnitQty,
          baseWasteQty: single.baseWasteQty,
        },
      ],
      warnings,
    };
  }

  // 혼합 베이스: 공란/0 구분 및 보정 규칙은 resolveMixedParbakeWasteByTypeCounts 참고
  const mixed = resolveMixedParbakeWasteByTypeCounts(
    state.secondClosure.parbakeWasteByType,
    dateParbakeTypes,
    parbakeWasteQty
  );
  warnings.push(...mixed.warnings);
  if (!mixed.resolved) {
    const rows: BaseWasteRow[] = [];
    for (const parbakeName of dateParbakeTypes) {
      rows.push({ resolved: false });
    }
    return { rows, warnings };
  }

  const rows: BaseWasteRow[] = [];
  for (const parbakeName of dateParbakeTypes) {
    const meta = getWeightedBaseSauceForType(parbakeName, productSummaries);
    if (!meta) {
      warnings.push(
        `파베이크 [${parbakeName}] 제품에 도우소스 BOM이 없어 베이스 폐기량을 계산할 수 없습니다.`
      );
      rows.push({ resolved: false });
      continue;
    }
    const wasteQty = mixed.resolved.get(parbakeName) ?? 0;
    const baseWasteQty = Math.round(wasteQty * meta.weightedBaseSaucePerUnitQty);
    rows.push({
      resolved: true,
      parbakeName,
      baseSauceMaterialName: meta.baseSauceMaterialName,
      weightedBaseSaucePerUnitQty: meta.weightedBaseSaucePerUnitQty,
      baseWasteQty,
    });
  }
  return { rows, warnings };
}

/** 베이스(도우소스) LOT에 FIFO로 폐기 차감 적용 */
function applyBaseWasteFifo(
  lotUsages: LotUsageRow[],
  baseWasteQty: number,
  baseSauceMaterialName: string
): {
  fifoLots: FifoLotRow[];
  totalBaseActualUsageBeforeWasteQty: number;
  totalBaseUsageAfterWasteQty: number;
  displayLabel: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  const baseLots = lotUsages
    .filter((l) => l.materialName === baseSauceMaterialName)
    .map((l) => ({ ...l }))
    .sort((a, b) => (a.expiryDate || "").localeCompare(b.expiryDate || ""));

  const totalBaseActualUsageBeforeWasteQty = baseLots.reduce(
    (s, l) => s + l.actualUsageQty,
    0
  );

  if (baseWasteQty <= 0) {
    const fifoLots: FifoLotRow[] = baseLots.map((l) => ({
      lotRowId: l.lotRowId,
      expiryDate: l.expiryDate,
      actualUsageQty: l.actualUsageQty,
      fifoDeductedWasteQty: 0,
      effectiveUsageAfterWasteQty: l.actualUsageQty,
    }));
    return {
      fifoLots,
      totalBaseActualUsageBeforeWasteQty,
      totalBaseUsageAfterWasteQty: totalBaseActualUsageBeforeWasteQty,
      displayLabel: `${baseSauceMaterialName} ${totalBaseActualUsageBeforeWasteQty.toLocaleString()}g`,
      warnings,
    };
  }

  if (baseWasteQty > totalBaseActualUsageBeforeWasteQty) {
    warnings.push(
      `베이스 폐기량(${baseWasteQty}g)이 도우소스 실제 사용량 합계(${totalBaseActualUsageBeforeWasteQty}g)보다 큽니다.`
    );
  }

  let remainingWaste = baseWasteQty;
  const fifoLots: FifoLotRow[] = baseLots.map((l) => {
    const deduct = Math.min(remainingWaste, l.actualUsageQty);
    remainingWaste -= deduct;
    const effective = Math.max(0, l.actualUsageQty - deduct);
    return {
      lotRowId: l.lotRowId,
      expiryDate: l.expiryDate,
      actualUsageQty: l.actualUsageQty,
      fifoDeductedWasteQty: deduct,
      effectiveUsageAfterWasteQty: effective,
    };
  });

  const totalBaseUsageAfterWasteQty = fifoLots.reduce(
    (s, l) => s + l.effectiveUsageAfterWasteQty,
    0
  );

  const displayLabel = `${baseSauceMaterialName} ${totalBaseUsageAfterWasteQty.toLocaleString()}g (폐기차감 후)`;
  return {
    fifoLots,
    totalBaseActualUsageBeforeWasteQty,
    totalBaseUsageAfterWasteQty,
    displayLabel,
    warnings,
  };
}

/** 날짜 그룹 1건 기준 전체 계산 → Step 4에서 그대로 쓸 수 있는 computedResult */
export function calculateUsageSummary(
  dateGroup: DateGroupInput,
  bomList: BomRowRef[],
  materialsMeta?: MaterialMeta[]
): ComputedResult {
  const allWarnings: string[] = [];

  const { lotUsages, warnings: lotWarnings } = calculateLotUsages(
    dateGroup.materials,
    materialsMeta
  );
  allWarnings.push(...lotWarnings);

  const productSummaries: ProductSummary[] = dateGroup.secondClosure.productOutputs.map(
    (o) => {
      const baseProductName = o.baseProductName ?? o.productName;
      const displayProductLabel = o.displayProductLabel ?? o.productKey ?? o.productName;
      const productStandardName = (o.productStandardName ?? o.standardName ?? "").trim() || "일반";
      const classification = getProductClassification(productStandardName);

      let inferredParbakeName: string | null = null;
      let inferredBaseSauceMaterialName: string | null = null;
      let inferredBaseSaucePerUnitQty: number | null = null;
      if (classification.requiresBaseSauceBom) {
        const meta = inferParbakeMetaFromBom(baseProductName, bomList);
        inferredParbakeName = meta.inferredParbakeName;
        inferredBaseSauceMaterialName = meta.inferredBaseSauceMaterialName;
        inferredBaseSaucePerUnitQty = meta.inferredBaseSaucePerUnitQty;
        allWarnings.push(...meta.warnings);
      }
      return {
        productKey: o.productKey,
        productName: o.productName,
        standardName: productStandardName,
        displayProductLabel,
        baseProductName,
        productStandardName,
        finishedQty: toNum(o.finishedQty),
        inferredParbakeName,
        inferredBaseSauceMaterialName,
        inferredBaseSaucePerUnitQty,
        usesTodayDough: classification.usesTodayDough,
        usesStoredParbake: classification.usesStoredParbake,
        isBreadProduct: classification.isBreadProduct,
        requiresBaseSauceBom: classification.requiresBaseSauceBom,
        participatesInParbakeTypeInference: classification.participatesInParbakeTypeInference,
      };
    }
  );

  const totals = calculateTotals(dateGroup);
  const parbakeDough = calculateParbakeAndDough(dateGroup, totals);
  allWarnings.push(...parbakeDough.warnings);

  const directDoughFinishedQty = productSummaries
    .filter((p) => p.usesTodayDough)
    .reduce((s, p) => s + p.finishedQty, 0);
  const storedParbakeFinishedQty = productSummaries
    .filter((p) => p.usesStoredParbake)
    .reduce((s, p) => s + p.finishedQty, 0);
  const expectedDirectDoughFlowQty =
    directDoughFinishedQty +
    totals.astronautParbakeQty +
    totals.saleParbakeQty +
    parbakeDough.parbakeWasteQty;
  const directDoughBalanceQty =
    parbakeDough.doughUsageQty - expectedDirectDoughFlowQty;
  if (directDoughBalanceQty !== 0) {
    allWarnings.push(
      `도우 흐름 검증: 사용량과 기대 흐름 차이 = ${directDoughBalanceQty} (doughUsageQty - expectedDirectDoughFlowQty).`
    );
  }

  const hasBread = productSummaries.some((p) => p.isBreadProduct);
  const hasStoredParbake = productSummaries.some((p) => p.usesStoredParbake);
  if (hasBread && hasStoredParbake) {
    allWarnings.push(
      "혼합 생산일: 브레드 제품과 파베이크사용 제품이 같은 날짜에 있습니다. 참고하세요."
    );
  }

  const dateParbakeTypes = getDateParbakeTypes(productSummaries);

  const { resolved: resolvedExtra, unresolved: unresolvedExtra, warnings: extraWarnings } =
    resolveExtraParbakes(dateGroup, dateParbakeTypes, productSummaries);
  allWarnings.push(...extraWarnings);
  for (const r of resolvedExtra) {
    if (!r.targetProductResolved && r.productCandidates.length > 1) {
      allWarnings.push(
        `추가 파베이크 [${r.parbakeName} ${r.qty}개]: 파베이크 종류는 확정되었으나 제품 귀속이 여러 개 후보라 확정되지 않았습니다.`
      );
    }
  }

  const { astronaut: astronautLabel, sale: saleLabel, warnings: labelWarnings } =
    getAstronautSaleLabels(
      totals.astronautParbakeQty,
      totals.saleParbakeQty,
      dateParbakeTypes
    );
  allWarnings.push(...labelWarnings);

  const { rows: baseWasteRows, warnings: baseWasteWarnings } = calculateBaseWasteRows(
    dateGroup,
    parbakeDough.parbakeWasteQty,
    productSummaries,
    dateParbakeTypes
  );
  allWarnings.push(...baseWasteWarnings);

  // 베이스 종류별 사용량 행: 폐기 행 기준으로 FIFO 적용 또는 사용량만 합산
  const baseUsageRows: BaseUsageRow[] = [];
  for (const wasteRow of baseWasteRows) {
    if (!wasteRow.resolved || !wasteRow.baseSauceMaterialName) {
      baseUsageRows.push({ resolved: false });
      continue;
    }
    const totalBaseActualFromLots = lotUsages
      .filter((l) => l.materialName === wasteRow.baseSauceMaterialName)
      .reduce((s, l) => s + l.actualUsageQty, 0);
    const effectiveWasteQty =
      totalBaseActualFromLots === 0 ? 0 : (wasteRow.baseWasteQty ?? 0);

    if (effectiveWasteQty > 0) {
      const fifoResult = applyBaseWasteFifo(
        lotUsages,
        effectiveWasteQty,
        wasteRow.baseSauceMaterialName
      );
      allWarnings.push(...fifoResult.warnings);
      baseUsageRows.push({
        resolved: true,
        baseSauceMaterialName: wasteRow.baseSauceMaterialName,
        totalBaseActualUsageBeforeWasteQty: fifoResult.totalBaseActualUsageBeforeWasteQty,
        totalBaseUsageAfterWasteQty: fifoResult.totalBaseUsageAfterWasteQty,
        fifoLots: fifoResult.fifoLots,
        displayLabel: fifoResult.displayLabel,
      });
    } else {
      const baseLots = lotUsages.filter(
        (l) => l.materialName === wasteRow.baseSauceMaterialName
      );
      const totalBase = baseLots.reduce((s, l) => s + l.actualUsageQty, 0);
      baseUsageRows.push({
        resolved: true,
        baseSauceMaterialName: wasteRow.baseSauceMaterialName,
        totalBaseActualUsageBeforeWasteQty: totalBase,
        totalBaseUsageAfterWasteQty: totalBase,
        fifoLots: baseLots.map((l) => ({
          lotRowId: l.lotRowId,
          expiryDate: l.expiryDate,
          actualUsageQty: l.actualUsageQty,
          fifoDeductedWasteQty: 0,
          effectiveUsageAfterWasteQty: l.actualUsageQty,
        })),
        displayLabel: `${wasteRow.baseSauceMaterialName} ${totalBase.toLocaleString()}g`,
      });
    }
  }

  const firstWaste = baseWasteRows[0];
  const firstUsage = baseUsageRows[0];
  const totalBaseActualFirst =
    firstWaste?.resolved && firstWaste.baseSauceMaterialName != null
      ? lotUsages
          .filter((l) => l.materialName === firstWaste.baseSauceMaterialName)
          .reduce((s, l) => s + l.actualUsageQty, 0)
      : 0;
  const effectiveFirstWasteQty =
    totalBaseActualFirst === 0 ? 0 : (firstWaste?.baseWasteQty ?? 0);

  return {
    totalFinishedQty: totals.totalFinishedQty,
    totalExtraParbakeQty: totals.totalExtraParbakeQty,
    doughMixQty: parbakeDough.doughMixQty,
    doughWasteQty: parbakeDough.doughWasteQty,
    doughUsageQty: parbakeDough.doughUsageQty,
    sameDayParbakeProductionQty: parbakeDough.sameDayParbakeProductionQty,
    parbakeWasteQty: parbakeDough.parbakeWasteQty,

    astronautParbakeQty: totals.astronautParbakeQty,
    saleParbakeQty: totals.saleParbakeQty,
    astronautParbakeOutputLabel: astronautLabel,
    saleParbakeOutputLabel: saleLabel,

    directDoughFinishedQty,
    storedParbakeFinishedQty,
    expectedDirectDoughFlowQty,
    directDoughBalanceQty,

    productSummaries,

    lotUsages,

    resolvedExtraParbakes: resolvedExtra,
    unresolvedExtraParbakes: unresolvedExtra,

    baseWasteRows,
    baseUsageRows,

    baseWaste: {
      resolved: firstWaste?.resolved ?? false,
      parbakeName: firstWaste?.parbakeName,
      baseSauceMaterialName: firstWaste?.baseSauceMaterialName,
      weightedBaseSaucePerUnitQty: firstWaste?.weightedBaseSaucePerUnitQty,
      baseWasteQty: effectiveFirstWasteQty,
    },
    baseUsage: firstUsage ?? { resolved: false },

    warnings: allWarnings,
  };
}
