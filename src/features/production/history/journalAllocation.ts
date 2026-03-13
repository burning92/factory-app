/**
 * Step 4 생산일지: 제품별 원료 배정 계산
 * - 전용 원료: BOM 기준 배정
 * - 공통 원료: non-anchor BOM 우선 배정, anchor 잔량 귀속
 * - 도우 베이스 소스: 총괄 페이지 참조만
 */

import type {
  DateGroupInput,
  BomRowRef,
  ComputedResult,
  LotUsageRow,
  ProductSummary,
} from "./types";
import type {
  AllocationRow,
  ProductAllocation,
  JournalAllocationResult,
  ProductUsageRow,
  ProductUsagePage,
  JournalUsageResult,
} from "./journalTypes";
import { getBomRowsForProductAndStandard } from "./bomAdapter";

const JOURNAL_STORAGE_KEY = "production-journal-data";

/** 제품별 BOM 행 조회 (배정용: 해당 제품 기준 전체 원료) */
export function getProductBomRows(
  baseProductName: string,
  productStandardName: string,
  bomList: BomRowRef[]
): BomRowRef[] {
  return getBomRowsForProductAndStandard(
    baseProductName,
    productStandardName,
    bomList
  );
}

/** 도우 베이스 소스 원료명 집합 (BOM에서 basis === "도우" 인 materialName) */
function getDoughBaseMaterialNames(bomList: BomRowRef[]): Set<string> {
  const set = new Set<string>();
  for (const b of bomList) {
    if (b.basis === "도우") set.add((b.materialName ?? "").trim());
  }
  return set;
}

/** 원료별 실제 사용량 합계 (lotUsages 기준) */
function getTotalActualUsageByMaterial(lotUsages: LotUsageRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const l of lotUsages) {
    const name = (l.materialName ?? "").trim();
    if (!name) continue;
    map.set(name, (map.get(name) ?? 0) + l.actualUsageQty);
  }
  return map;
}

/** 같은 날 제품들에서 원료별 등장 횟수. 2 이상이면 공통 원료 */
function getMaterialToProductCount(
  productSummaries: ProductSummary[],
  bomList: BomRowRef[]
): Map<string, number> {
  const count = new Map<string, number>();
  for (const p of productSummaries) {
    const rows = getProductBomRows(p.baseProductName, p.productStandardName, bomList);
    const seen = new Set<string>();
    for (const r of rows) {
      const name = (r.materialName ?? "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      count.set(name, (count.get(name) ?? 0) + 1);
    }
  }
  return count;
}

/**
 * 제품별 원료 배정 결과 생성.
 * - productSummaries 순서상 마지막 제품 = 잔량 귀속(anchor).
 * - 공통 원료: non-anchor는 BOM 기준 배정, anchor는 잔량 귀속.
 */
export function buildPerProductAllocation(
  dateGroup: DateGroupInput,
  computedResult: ComputedResult,
  bomList: BomRowRef[]
): JournalAllocationResult {
  const { productSummaries, lotUsages } = computedResult;
  const doughBaseNames = getDoughBaseMaterialNames(bomList);
  const totalActualByMaterial = getTotalActualUsageByMaterial(lotUsages);
  const materialToProductCount = getMaterialToProductCount(productSummaries, bomList);
  const anchorIndex = productSummaries.length > 0 ? productSummaries.length - 1 : -1;
  const residualAnchorProductKey =
    anchorIndex >= 0 ? productSummaries[anchorIndex]!.productKey : null;

  const productAllocations: ProductAllocation[] = [];

  for (let i = 0; i < productSummaries.length; i++) {
    const p = productSummaries[i]!;
    const isAnchor = i === anchorIndex;
    const bomRows = getProductBomRows(p.baseProductName, p.productStandardName, bomList);
    const allocationRows: AllocationRow[] = [];

    for (const row of bomRows) {
      const materialName = (row.materialName ?? "").trim();
      if (!materialName) continue;

      const isDoughBase = doughBaseNames.has(materialName);
      if (isDoughBase) {
        allocationRows.push({
          materialName,
          allocationType: "summary-reference",
          allocatedQty: 0,
          unit: "g",
          note: "도우 베이스 소스는 총괄 페이지에서 관리",
        });
        continue;
      }

      const sharedCount = materialToProductCount.get(materialName) ?? 0;
      const isShared = sharedCount > 1;
      const totalActual = totalActualByMaterial.get(materialName) ?? 0;
      const bomGPerEa = row.bomGPerEa ?? 0;

      if (!isShared) {
        const qty = Math.round(p.finishedQty * bomGPerEa);
        allocationRows.push({
          materialName,
          allocationType: "unique-bom",
          allocatedQty: qty,
          unit: "g",
          note: "전용 원료(BOM 기준)",
        });
        continue;
      }

      if (isAnchor) {
        let nonAnchorSum = 0;
        for (let j = 0; j < productSummaries.length; j++) {
          if (j === anchorIndex) continue;
          const other = productSummaries[j]!;
          const otherRows = getProductBomRows(other.baseProductName, other.productStandardName, bomList);
          const otherRow = otherRows.find((r) => (r.materialName ?? "").trim() === materialName);
          if (otherRow) nonAnchorSum += (other.finishedQty ?? 0) * (otherRow.bomGPerEa ?? 0);
        }
        const residual = Math.max(0, Math.round(totalActual - nonAnchorSum));
        allocationRows.push({
          materialName,
          allocationType: "shared-residual",
          allocatedQty: residual,
          unit: "g",
          note: "공통 원료(잔량 귀속)",
        });
      } else {
        const qty = Math.round(p.finishedQty * bomGPerEa);
        allocationRows.push({
          materialName,
          allocationType: "shared-bom",
          allocatedQty: qty,
          unit: "g",
          note: "공통 원료(BOM 우선 배정)",
        });
      }
    }

    productAllocations.push({
      productKey: p.productKey,
      displayProductLabel: p.displayProductLabel,
      baseProductName: p.baseProductName ?? p.displayProductLabel,
      finishedQty: p.finishedQty,
      productStandardName: p.productStandardName,
      usesTodayDough: p.usesTodayDough,
      usesStoredParbake: p.usesStoredParbake,
      allocationRows,
    });
  }

  return { productAllocations, residualAnchorProductKey };
}

/**
 * 전용 원료: 해당 원료의 actualUsageQty LOT 전체를 그 제품에 귀속.
 * lotUsages에서 materialName 일치하는 LOT를 소비기한 오름차순으로 반환.
 */
export function buildUniqueMaterialUsageRows(
  materialName: string,
  lotUsages: LotUsageRow[]
): { expiryDate: string; usageQty: number }[] {
  return lotUsages
    .filter((l) => (l.materialName ?? "").trim() === materialName)
    .map((l) => ({
      expiryDate: l.expiryDate ?? "—",
      usageQty: l.actualUsageQty,
    }))
    .sort((a, b) => (a.expiryDate || "").localeCompare(b.expiryDate || ""));
}

/**
 * 공통 원료의 실제 사용량(LOT별 actualUsageQty)을 제품별로 FIFO 분배.
 * material 단위로 "공유 LOT 잔량 상태"를 하나만 두고, 제품 순서대로 배정할 때
 * 앞 제품에 배정된 만큼 해당 LOT 잔량을 실제 차감한 뒤, 다음 제품은 차감 후 잔량 기준으로 배정.
 * non-anchor 제품에 BOM 필요량을 FIFO로 먼저 배정, 최종 잔량은 anchor 제품에 귀속.
 * 반환: productKey -> 해당 제품에 배정된 LOT별 사용량 목록
 */
export function allocateSharedMaterialLotsByFifo(
  materialName: string,
  productSummaries: ProductSummary[],
  bomList: BomRowRef[],
  lotUsages: LotUsageRow[],
  anchorIndex: number
): Map<string, { expiryDate: string; usageQty: number }[]> {
  const result = new Map<string, { expiryDate: string; usageQty: number }[]>();

  const byExpiry = new Map<string, number>();
  for (const l of lotUsages) {
    if ((l.materialName ?? "").trim() !== materialName) continue;
    const exp = l.expiryDate ?? "—";
    byExpiry.set(exp, (byExpiry.get(exp) ?? 0) + l.actualUsageQty);
  }
  const materialLots = Array.from(byExpiry.entries())
    .map(([expiryDate, actualUsageQty]) => ({ expiryDate, actualUsageQty }))
    .sort((a, b) => (a.expiryDate || "").localeCompare(b.expiryDate || ""));

  if (materialLots.length === 0) return result;

  const materialLotsRemaining = materialLots.map((l) => ({
    expiryDate: l.expiryDate,
    remainingQty: l.actualUsageQty,
  }));

  const productIndicesWithMaterial: number[] = [];
  for (let i = 0; i < productSummaries.length; i++) {
    const p = productSummaries[i]!;
    const rows = getProductBomRows(p.baseProductName, p.productStandardName, bomList);
    if (rows.some((r) => (r.materialName ?? "").trim() === materialName))
      productIndicesWithMaterial.push(i);
  }
  const materialAnchorIndex =
    productIndicesWithMaterial.length > 0
      ? productIndicesWithMaterial[productIndicesWithMaterial.length - 1]!
      : -1;

  const needByProduct: { productKey: string; need: number }[] = [];
  for (const i of productIndicesWithMaterial) {
    if (i === materialAnchorIndex) continue;
    const p = productSummaries[i]!;
    const rows = getProductBomRows(p.baseProductName, p.productStandardName, bomList);
    const row = rows.find((r) => (r.materialName ?? "").trim() === materialName);
    const need = row ? Math.round((p.finishedQty ?? 0) * (row.bomGPerEa ?? 0)) : 0;
    if (need > 0) needByProduct.push({ productKey: p.productKey, need });
  }

  for (const { productKey, need } of needByProduct) {
    let needLeft = need;
    const rows: { expiryDate: string; usageQty: number }[] = [];
    for (const lot of materialLotsRemaining) {
      if (needLeft <= 0 || lot.remainingQty <= 0) continue;
      const take = Math.min(needLeft, lot.remainingQty);
      lot.remainingQty -= take;
      needLeft -= take;
      rows.push({ expiryDate: lot.expiryDate, usageQty: take });
    }
    if (rows.length > 0) result.set(productKey, rows);
  }

  const anchorKey =
    materialAnchorIndex >= 0 ? productSummaries[materialAnchorIndex]!.productKey : null;
  if (anchorKey) {
    const rows: { expiryDate: string; usageQty: number }[] = [];
    for (const lot of materialLotsRemaining) {
      if (lot.remainingQty <= 0) continue;
      rows.push({ expiryDate: lot.expiryDate, usageQty: lot.remainingQty });
    }
    if (rows.length > 0) result.set(anchorKey, rows);
  }

  return result;
}

/**
 * 제품별 원료 사용량 생성 (1차 마감 actualUsageQty 기반).
 * 전용 원료: 해당 원료 actualUsageQty LOT 전량 해당 제품 귀속.
 * 공통 원료: BOM 우선 FIFO 배정 + 잔량 귀속, LOT별 행.
 */
export function buildPerProductUsage(
  dateGroup: DateGroupInput,
  computedResult: ComputedResult,
  bomList: BomRowRef[]
): JournalUsageResult {
  const { productSummaries, lotUsages } = computedResult;
  const doughBaseNames = getDoughBaseMaterialNames(bomList);
  const materialToProductCount = getMaterialToProductCount(productSummaries, bomList);
  const anchorIndex = productSummaries.length > 0 ? productSummaries.length - 1 : -1;
  const residualAnchorProductKey =
    anchorIndex >= 0 ? productSummaries[anchorIndex]!.productKey : null;

  const sharedAllocationCache = new Map<
    string,
    Map<string, { expiryDate: string; usageQty: number }[]>
  >();

  const productUsagePages: ProductUsagePage[] = [];

  for (let i = 0; i < productSummaries.length; i++) {
    const p = productSummaries[i]!;
    const isAnchor = i === anchorIndex;
    const bomRows = getProductBomRows(p.baseProductName, p.productStandardName, bomList);
    const usageRows: ProductUsageRow[] = [];

    for (const row of bomRows) {
      const materialName = (row.materialName ?? "").trim();
      if (!materialName) continue;

      const bomGPerEa = row.bomGPerEa ?? 0;
      const bomDisplayQty = Math.round(p.finishedQty * bomGPerEa);

      const isDoughBase = doughBaseNames.has(materialName);
      if (isDoughBase) {
        usageRows.push({
          materialName,
          expiryDate: "—",
          usageQty: 0,
          usageType: "summary-reference",
          note: "도우 베이스 소스는 총괄 페이지에서 관리",
          bomDisplayQty: 0,
        });
        continue;
      }

      const sharedCount = materialToProductCount.get(materialName) ?? 0;
      const isShared = sharedCount > 1;

      if (!isShared) {
        const lotRows = buildUniqueMaterialUsageRows(materialName, lotUsages);
        for (const r of lotRows) {
          usageRows.push({
            materialName,
            expiryDate: r.expiryDate,
            usageQty: r.usageQty,
            usageType: "unique-actual",
            note: "전용 원료(실제 사용량)",
            bomDisplayQty,
          });
        }
        continue;
      }

      let perProduct = sharedAllocationCache.get(materialName);
      if (!perProduct) {
        perProduct = allocateSharedMaterialLotsByFifo(
          materialName,
          productSummaries,
          bomList,
          lotUsages,
          anchorIndex
        );
        sharedAllocationCache.set(materialName, perProduct);
      }

      const rowsForProduct = perProduct.get(p.productKey) ?? [];
      const sharedNote = isAnchor
        ? "공통 원료(잔량 귀속)"
        : "공통 원료(BOM 우선 배정)";
      for (const r of rowsForProduct) {
        usageRows.push({
          materialName,
          expiryDate: r.expiryDate,
          usageQty: r.usageQty,
          usageType: "shared-actual",
          note: sharedNote,
          bomDisplayQty,
        });
      }
    }

    productUsagePages.push({
      productKey: p.productKey,
      displayProductLabel: p.displayProductLabel,
      baseProductName: p.baseProductName ?? p.displayProductLabel,
      productStandardName: p.productStandardName,
      finishedQty: p.finishedQty,
      usesTodayDough: p.usesTodayDough,
      usesStoredParbake: p.usesStoredParbake,
      usageRows,
    });
  }

  return { productUsagePages, residualAnchorProductKey };
}

/** sessionStorage 키 (날짜별 생산일지 데이터) */
export function getJournalStorageKey(): string {
  return JOURNAL_STORAGE_KEY;
}
