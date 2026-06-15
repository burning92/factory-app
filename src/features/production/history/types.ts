/**
 * Step 3/4: 사용량 계산 결과 타입 (Step 4 출력에서 그대로 사용)
 * 계산 엔진 입력용 타입 (page state와 호환)
 */

export type LotRowInput = {
  lotRowId: string;
  sourceType: "from-log" | "manual";
  expiryDate: string;
  outboundQty: number;
  /** 전날재고 낱개 수량 */
  prevDayUnitCount: number | "";
  /** 전날재고 잔량(g) */
  prevDayRemainderG: number | "";
  /** 당일재고 낱개 수량 */
  currentDayUnitCount: number | "";
  /** 당일재고 잔량(g) */
  currentDayRemainderG: number | "";
  sourceRowIds?: string[];
};

export type MaterialCardInput = {
  materialCardId: string;
  materialName: string;
  lots: LotRowInput[];
};

export type ProductItemInput = {
  productKey: string;
  productName: string;
  standardName: string;
  displayProductLabel?: string;
  baseProductName?: string;
  productStandardName?: string;
};

export type ProductOutputInput = {
  productOutputId: string;
  productKey: string;
  productName: string;
  standardName: string;
  displayProductLabel?: string;
  baseProductName?: string;
  productStandardName?: string;
  finishedQty: number | "";
};

export type ExtraParbakeRowInput = {
  extraParbakeId: string;
  qty: number | "";
  /** 제조일자 YYYY-MM-DD (일지·표시는 +364일 소비기한) */
  manufacturedDate: string;
  /** 혼합 베이스일 추가 파베이크 소스(토마토/베샤멜 등). 단일 종류일 때는 자동 보완 가능 */
  parbakeName?: string;
  /** @deprecated 레거시: 과거에는 소비기한을 직접 저장 */
  expiryDate?: string;
};

/** 혼합 베이스 날: 파베이크 종류별 폐기량(개). 자동 분배하지 않고 사용자 입력만 사용 */
export type ParbakeWasteByTypeInput = {
  parbakeName: string;
  wasteQty: number | "";
};

/** 일반·미니 혼합일: 우주인 파베이크 생산량이 어느 규격인지 (생산일지 표기용) */
export type AstronautParbakeSizeLane = "standard" | "mini";

/** 베이스(토마토/베샤멜 등)별 우주인·판매용 파베이크 생산량 */
export type ParbakeProductionByBaseInput = {
  parbakeName: string;
  astronautQty: number | "";
  saleQty: number | "";
};

export type SecondClosureInput = {
  productOutputs: ProductOutputInput[];
  /** @deprecated parbakeProductionByBase 합계와 동기화. 신규 UI는 by-base 사용 */
  astronautParbakeQty: number | "";
  /** @deprecated parbakeProductionByBase 합계와 동기화 */
  saleParbakeQty: number | "";
  /** 베이스별 우주인/판매용 파베이크 생산량 */
  parbakeProductionByBase?: ParbakeProductionByBaseInput[];
  /** 일반+미니 혼합일만. 미니-only는 자동, 일반-only는 불필요 */
  astronautParbakeSizeLane?: AstronautParbakeSizeLane | "";
  /** 일반+미니 혼합일 판매용 파베이크 표기 */
  saleParbakeSizeLane?: AstronautParbakeSizeLane | "";
  extraParbakes: ExtraParbakeRowInput[];
  /** 베이스 2종 이상인 날만 사용. 타입별 파베이크 폐기량(개) */
  parbakeWasteByType?: ParbakeWasteByTypeInput[];
};

export type DateGroupInput = {
  id: string;
  date: string;
  doughMixQty: number | "";
  doughWasteQty: number | "";
  materials: MaterialCardInput[];
  products: ProductItemInput[];
  secondClosure: SecondClosureInput;
};

export type BomRowRef = {
  productName: string;
  materialName: string;
  bomGPerEa: number;
  basis: string;
};

export type LotUsageRow = {
  lotRowId: string;
  materialCardId: string;
  materialName: string;
  sourceType: "from-log" | "manual";
  expiryDate: string;
  outboundQty: number;
  prevDayStockQty: number;
  currentDayStockQty: number;
  actualUsageQty: number;
};

/** 제품 기준별 분류 (Step 3.5: 당일 도우 / 보관 파베이크 / 브레드 예외) */
export type ProductClassification = {
  usesTodayDough: boolean;
  usesStoredParbake: boolean;
  isBreadProduct: boolean;
  requiresBaseSauceBom: boolean;
  participatesInParbakeTypeInference: boolean;
};

export type ProductSummary = {
  productKey: string;
  productName: string;
  standardName: string;
  /** 화면 표시용 (예: "마르게리따 - 파베이크사용") */
  displayProductLabel: string;
  /** BOM/계산용 순수 제품명 */
  baseProductName: string;
  /** BOM/계산용 제품 기준 */
  productStandardName: string;
  finishedQty: number;
  inferredParbakeName: string | null;
  inferredBaseSauceMaterialName: string | null;
  inferredBaseSaucePerUnitQty: number | null;
  /** Step 3.5: 제품 기준별 분류 */
  usesTodayDough: boolean;
  usesStoredParbake: boolean;
  isBreadProduct: boolean;
  requiresBaseSauceBom: boolean;
  participatesInParbakeTypeInference: boolean;
};

export type ResolvedExtraParbake = {
  extraParbakeId: string;
  parbakeName: string;
  qty: number;
  manufacturedDate: string;
  /** 일지 표시용 소비기한 (= manufacturedDate + 364일) */
  expiryDate: string;
  displayLabel: string;
  productCandidates: {
    productKey: string;
    productName: string;
    standardName: string;
    displayProductLabel?: string;
    baseProductName?: string;
  }[];
  targetProductResolved: boolean;
};

export type UnresolvedExtraParbake = {
  extraParbakeId: string;
  qty: number;
  manufacturedDate: string;
  reason: string;
};

/** 생산일지 「파베이크 목적별 생산량」 한 줄 */
export type ParbakePurposeProductionLine = {
  role: "astronaut" | "sale";
  parbakeName: string;
  qty: number;
};

export type BaseWasteResult = {
  resolved: boolean;
  parbakeName?: string;
  baseSauceMaterialName?: string;
  weightedBaseSaucePerUnitQty?: number;
  baseWasteQty?: number;
};

/** 총괄(P1) 베이스 폐기량 1행 = 베이스 종류 1개 */
export type BaseWasteRow = {
  resolved: boolean;
  parbakeName?: string;
  baseSauceMaterialName?: string;
  weightedBaseSaucePerUnitQty?: number;
  baseWasteQty?: number;
};

export type FifoLotRow = {
  lotRowId: string;
  expiryDate: string;
  actualUsageQty: number;
  fifoDeductedWasteQty: number;
  effectiveUsageAfterWasteQty: number;
};

export type BaseUsageResult = {
  resolved: boolean;
  baseSauceMaterialName?: string;
  totalBaseActualUsageBeforeWasteQty?: number;
  totalBaseUsageAfterWasteQty?: number;
  fifoLots?: FifoLotRow[];
  displayLabel?: string;
};

/** 총괄(P1) 베이스 사용량 1행 = 베이스 종류 1개 */
export type BaseUsageRow = {
  resolved: boolean;
  baseSauceMaterialName?: string;
  totalBaseActualUsageBeforeWasteQty?: number;
  totalBaseUsageAfterWasteQty?: number;
  fifoLots?: FifoLotRow[];
  displayLabel?: string;
};

export type ComputedResult = {
  totalFinishedQty: number;
  totalExtraParbakeQty: number;
  doughMixQty: number;
  doughWasteQty: number;
  doughUsageQty: number;
  sameDayParbakeProductionQty: number;
  parbakeWasteQty: number;
  /** 기준 브레드 완제품 합계만 반영한 도우 폐기(개) */
  breadWasteQty: number;
  /** 당일 도우 사용·브레드가 아닌 완제품 합계 (일반 피자 등) */
  generalDoughFinishedQty: number;

  astronautParbakeQty: number;
  saleParbakeQty: number;
  astronautParbakeOutputLabel: string | null;
  saleParbakeOutputLabel: string | null;
  /** 혼합·우주인 완제품 포함 목적별 파베 생산량 (생산일지 표시용) */
  parbakePurposeProductionLines: ParbakePurposeProductionLine[];

  /** Step 3.5: 당일 도우 사용 완제품 수량 합계 */
  directDoughFinishedQty: number;
  /** Step 3.5: 보관 파베이크 사용 완제품 수량 합계 */
  storedParbakeFinishedQty: number;
  /** Step 3.5: 당일 도우 흐름 기대값 (direct + 우주인 + 판매 + 폐기) */
  expectedDirectDoughFlowQty: number;
  /** Step 3.5: 도우 사용량 - 기대 흐름 (0이 아니면 검증 경고) */
  directDoughBalanceQty: number;

  productSummaries: ProductSummary[];

  lotUsages: LotUsageRow[];

  resolvedExtraParbakes: ResolvedExtraParbake[];
  unresolvedExtraParbakes: UnresolvedExtraParbake[];

  /** 총괄(P1) 베이스 종류별 폐기량 행 목록. 단일 베이스면 1행, 혼합이면 타입별 1행 */
  baseWasteRows: BaseWasteRow[];
  /** 총괄(P1) 베이스 종류별 사용량 행 목록 */
  baseUsageRows: BaseUsageRow[];

  /** @deprecated 단일 베이스 호환용. baseWasteRows[0] / 비어있으면 첫 행 */
  baseWaste: BaseWasteResult;
  /** @deprecated 단일 베이스 호환용. baseUsageRows[0] / 비어있으면 첫 행 */
  baseUsage: BaseUsageResult;

  warnings: string[];
};
