/**
 * Step 4 생산일지: 제품별 원료 배정/사용량 결과 타입
 */

export type AllocationType =
  | "unique-bom"       // 전용 원료 (BOM 기준)
  | "shared-bom"      // 공통 원료 (BOM 우선 배정)
  | "shared-residual" // 공통 원료 (잔량 귀속)
  | "summary-reference"; // 도우 베이스 소스 (총괄 페이지 참조)

export type AllocationRow = {
  materialName: string;
  allocationType: AllocationType;
  allocatedQty: number;
  unit: "g" | "개";
  note?: string;
};

export type ProductAllocation = {
  productKey: string;
  displayProductLabel: string;
  baseProductName: string;
  finishedQty: number;
  productStandardName: string;
  usesTodayDough: boolean;
  usesStoredParbake: boolean;
  allocationRows: AllocationRow[];
};

export type JournalAllocationResult = {
  productAllocations: ProductAllocation[];
  /** 공통 원료 배정 시 잔량 귀속 제품(마지막 제품) 표시용 */
  residualAnchorProductKey: string | null;
};

/** 제품별 원료 사용량 행 (1차 마감 actualUsageQty 기반, LOT별) */
export type ProductUsageRow = {
  materialName: string;
  expiryDate: string;
  usageQty: number;
  usageType:
    | "unique-actual"   // 전용 원료(실제 사용량)
    | "shared-actual"   // 공통 원료
    | "summary-reference";
  note?: string;
  /** BOM 표시용: finishedQty × bomGPerEa (같은 원료 여러 LOT여도 동일) */
  bomDisplayQty?: number;
};

/** 제품별 원료 사용량 페이지 */
export type ProductUsagePage = {
  productKey: string;
  displayProductLabel: string;
  baseProductName: string;
  productStandardName: string;
  finishedQty: number;
  usesTodayDough: boolean;
  usesStoredParbake: boolean;
  usageRows: ProductUsageRow[];
};

export type JournalUsageResult = {
  productUsagePages: ProductUsagePage[];
  residualAnchorProductKey: string | null;
};
