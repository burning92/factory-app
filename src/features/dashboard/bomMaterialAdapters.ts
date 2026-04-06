import type { BomRow, Material } from "@/lib/mockData";
import type { BomRowRef } from "@/features/production/history/types";
import type { MaterialMeta } from "@/features/production/history/calculations";

export function bomRowsToRefs(rows: BomRow[]): BomRowRef[] {
  return rows.map((b) => ({
    productName: b.productName,
    materialName: b.materialName,
    bomGPerEa: b.bomGPerEa,
    basis: b.basis,
  }));
}

export function materialsToMeta(list: Material[]): MaterialMeta[] {
  return list.map((m) => ({
    materialName: m.materialName,
    boxWeightG: m.boxWeightG,
    unitWeightG: m.unitWeightG,
  }));
}
