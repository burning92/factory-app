import type { HarangInventoryTransaction } from "@/features/harang/types";

/** LOT별 원장 합계 (정본 재고) */
export function ledgerSumByLotId(txs: HarangInventoryTransaction[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const tx of txs) {
    if (!tx.lot_id) continue;
    map.set(tx.lot_id, (map.get(tx.lot_id) ?? 0) + Number(tx.quantity_delta));
  }
  return map;
}

export function ledgerSumForLot(txs: HarangInventoryTransaction[], lotId: string): number {
  let sum = 0;
  for (const tx of txs) {
    if (tx.lot_id === lotId) sum += Number(tx.quantity_delta);
  }
  return sum;
}

const LEDGER_EPS = 0.0005;

export function ledgerMatchesCurrent(ledgerSum: number, currentQty: number): boolean {
  return Math.abs(ledgerSum - currentQty) <= LEDGER_EPS;
}

export type ProductionLineIntegrityIssue =
  | "usage_qty_mismatch"
  | "legacy_unlinked"
  | "phantom_line_lot"
  | "missing_line_lot"
  | "ledger_qty_mismatch";

export type ProductionLineIntegrity = {
  lineId: string;
  materialName: string;
  usageQty: number;
  lineLotSum: number;
  ledgerSum: number;
  issues: ProductionLineIntegrityIssue[];
};

type LineLotRow = {
  line_id: string;
  quantity_used: number;
  inventory_transaction_id?: number | null;
  lot_id?: string;
};

/**
 * 생산 상세 화면용: line_lots ↔ usage 원장 정합성 (클라이언트 진단)
 */
export function diagnoseProductionLineIntegrity(
  lines: Array<{ id: string; material_name: string; usage_qty: number }>,
  lineLots: LineLotRow[],
  usageTxs: HarangInventoryTransaction[],
): ProductionLineIntegrity[] {
  const txById = new Map(usageTxs.map((t) => [t.id, t]));
  const lotsByLine = new Map<string, LineLotRow[]>();
  for (const pl of lineLots) {
    const list = lotsByLine.get(pl.line_id) ?? [];
    list.push(pl);
    lotsByLine.set(pl.line_id, list);
  }

  return lines.map((line) => {
    const pls = lotsByLine.get(line.id) ?? [];
    const lineLotSum = pls.reduce((s, p) => s + Number(p.quantity_used), 0);
    const issues: ProductionLineIntegrityIssue[] = [];

    if (line.usage_qty > LEDGER_EPS && Math.abs(lineLotSum - line.usage_qty) > LEDGER_EPS) {
      issues.push("usage_qty_mismatch");
    }

    let ledgerSum = 0;
    for (const pl of pls) {
      if (pl.inventory_transaction_id == null && Number(pl.quantity_used) > LEDGER_EPS) {
        issues.push("legacy_unlinked");
      }
      if (pl.inventory_transaction_id != null) {
        const tx = txById.get(pl.inventory_transaction_id);
        if (!tx) {
          issues.push("phantom_line_lot");
        } else {
          ledgerSum += -Number(tx.quantity_delta);
          if (Math.abs(-Number(tx.quantity_delta) - Number(pl.quantity_used)) > LEDGER_EPS) {
            issues.push("ledger_qty_mismatch");
          }
        }
      } else if (Number(pl.quantity_used) > LEDGER_EPS) {
        issues.push("phantom_line_lot");
      }
    }

    if (line.usage_qty > LEDGER_EPS && ledgerSum < LEDGER_EPS && pls.length > 0) {
      if (!issues.includes("phantom_line_lot") && !issues.includes("legacy_unlinked")) {
        issues.push("phantom_line_lot");
      }
    }

    if (line.usage_qty > LEDGER_EPS && pls.length === 0) {
      issues.push("missing_line_lot");
    }

    if (pls.length > 0 && Math.abs(ledgerSum - lineLotSum) > LEDGER_EPS && ledgerSum > LEDGER_EPS) {
      if (!issues.includes("ledger_qty_mismatch")) issues.push("ledger_qty_mismatch");
    }

    return {
      lineId: line.id,
      materialName: line.material_name,
      usageQty: line.usage_qty,
      lineLotSum,
      ledgerSum,
      issues: Array.from(new Set(issues)),
    };
  });
}

export const INTEGRITY_ISSUE_LABEL: Record<ProductionLineIntegrityIssue, string> = {
  usage_qty_mismatch: "usage_qty와 line_lots 합계 불일치",
  legacy_unlinked: "레거시 원장 미연결",
  phantom_line_lot: "line_lot에 대응 usage 원장 없음",
  missing_line_lot: "line_lots 누락",
  ledger_qty_mismatch: "line_lot과 usage 원장 수량 불일치",
};
