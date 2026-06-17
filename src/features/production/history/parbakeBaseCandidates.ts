/**
 * BOM 도우(하위원료) 행에서 파베이크 베이스 후보 수집 — 2차 마감 수동 선택용
 */

import { getDoughBaseRowsFromProductBom } from "./bomAdapter";
import type { BomRowRef } from "./types";

export type ParbakeBaseCandidate = {
  parbakeName: string;
  baseSauceMaterialName: string;
  /** BOM 출처 제품명 예시 */
  sampleProductNames: string[];
};

function parbakeNameFromBaseSauce(materialName: string): string | null {
  const name = (materialName ?? "").trim();
  if (/도우.*토마토|토마토.*도우/i.test(name)) return "토마토 파베이크";
  if (/도우.*베샤멜|베샤멜.*도우/i.test(name)) return "베샤멜 파베이크";
  if (/도우.*로제|로제.*도우/i.test(name)) return "로제 파베이크";
  if (/도우.*바질|바질.*도우/i.test(name)) return "바질 파베이크";
  if (/도우.*치즈|치즈.*도우/i.test(name)) return "베샤멜 파베이크";
  return null;
}

function isDoughBaseSauceRow(row: BomRowRef): boolean {
  const name = (row.materialName ?? "").trim();
  return (
    row.basis === "도우" &&
    /도우.*소스|소스.*도우/i.test(name) &&
    !/토핑/i.test(name)
  );
}

/**
 * 당일 완제품 BOM + 전체 BOM에서 도우 소스 → 파베이크 베이스 후보.
 * 파베이크사용·브레드 혼합일처럼 자동 추론이 안 되는 날에도 선택지를 제공한다.
 */
export function collectParbakeBaseCandidatesFromBom(
  bomList: BomRowRef[],
  products: { baseProductName?: string; productStandardName?: string; displayProductLabel?: string }[] = []
): ParbakeBaseCandidate[] {
  const byParbake = new Map<string, { sauce: string; products: Set<string> }>();

  const add = (parbakeName: string, sauce: string, productLabel: string) => {
    let entry = byParbake.get(parbakeName);
    if (!entry) {
      entry = { sauce, products: new Set() };
      byParbake.set(parbakeName, entry);
    }
    if (productLabel) entry.products.add(productLabel);
  };

  for (const p of products) {
    const base = (p.baseProductName ?? "").trim();
    if (!base) continue;
    const std = (p.productStandardName ?? "일반").trim() || "일반";
    const label =
      (p.displayProductLabel ?? "").trim() || `${base} - ${std}`;
    for (const row of getDoughBaseRowsFromProductBom(base, std, bomList)) {
      if (!isDoughBaseSauceRow(row)) continue;
      const parbakeName = parbakeNameFromBaseSauce(row.materialName);
      if (parbakeName) add(parbakeName, row.materialName, label);
    }
  }

  for (const row of bomList) {
    if (!isDoughBaseSauceRow(row)) continue;
    const parbakeName = parbakeNameFromBaseSauce(row.materialName);
    if (!parbakeName) continue;
    add(parbakeName, row.materialName, (row.productName ?? "").trim());
  }

  return Array.from(byParbake.entries())
    .map(([parbakeName, { sauce, products: prodSet }]) => ({
      parbakeName,
      baseSauceMaterialName: sauce,
      sampleProductNames: Array.from(prodSet).sort((a, b) => a.localeCompare(b, "ko")),
    }))
    .sort((a, b) => a.parbakeName.localeCompare(b.parbakeName, "ko"));
}
