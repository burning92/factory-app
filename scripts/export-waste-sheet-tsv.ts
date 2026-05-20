/**
 * 경영 대시보드(`/executive`) 폐기 테이블과 동일 소스의 일별 TSV를 표준 출력으로 내보냅니다.
 * 구글 시트 A1에 전체 복사·붙여넣기 하면 열이 나뉩니다.
 *
 * 사용 (프로젝트 루트):
 *   npm run export:waste-tsv
 *   npx tsx scripts/export-waste-sheet-tsv.ts --from=2024 --to=2026
 * Windows에서 출력 전체를 클립보드로:
 *   npx tsx scripts/export-waste-sheet-tsv.ts | clip
 *
 * 환경 변수 (.env.local 권장):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (권장 — RLS로 anon이 막힐 때)
 *   또는 NEXT_PUBLIC_SUPABASE_ANON_KEY
 */

import fs from "fs";
import path from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BomRow, Material } from "../src/lib/mockData";
import { bomRowsToRefs, materialsToMeta } from "../src/features/dashboard/bomMaterialAdapters";
import { loadProductionBundle } from "../src/features/dashboard/loadProductionBundle";
import {
  mergeBundleDaysWithManualImportsForTable,
  type ManualWasteImportSeries,
} from "../src/features/dashboard/wasteDetailMockData";

function loadEnvLocal() {
  const p = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  const raw = fs.readFileSync(p, "utf8");
  for (const line of raw.split(/\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq <= 0) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

function parseArgs(): { fromYear: number; toYear: number } {
  const cy = new Date().getFullYear();
  let fromYear = 2024;
  let toYear = cy;
  for (const a of process.argv.slice(2)) {
    const m = /^--from=(\d{4})$/.exec(a);
    if (m) fromYear = Number(m[1]);
    const m2 = /^--to=(\d{4})$/.exec(a);
    if (m2) toYear = Number(m2[1]);
  }
  if (fromYear > toYear) [fromYear, toYear] = [toYear, fromYear];
  return { fromYear, toYear };
}

type DateQtyMap = Record<string, number>;

function toDateQtyMap(filePath: string): DateQtyMap {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return {};
  const out: DateQtyMap = {};
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const row = JSON.parse(s) as { date?: string; qty?: unknown };
      const date = String(row.date ?? "").slice(0, 10);
      const qty = Number(row.qty);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(qty)) continue;
      out[date] = (out[date] ?? 0) + qty;
    } catch {
      // ignore malformed
    }
  }
  return out;
}

function manualSeriesForYear(year: number): ManualWasteImportSeries {
  const dir = path.join(process.cwd(), "data", "manual-imports");
  return {
    doughProductionByDate: toDateQtyMap(path.join(dir, `${year}-dough-production.jsonl`)),
    doughWasteByDate: toDateQtyMap(path.join(dir, `${year}-waste-dough.jsonl`)),
    parbakeWasteByDate: toDateQtyMap(path.join(dir, `${year}-waste-parbake.jsonl`)),
    parbakeProductionByDate: toDateQtyMap(path.join(dir, `${year}-parbake-production.jsonl`)),
  };
}

async function fetchMaterialsAndBom(sb: SupabaseClient): Promise<{
  materials: Material[];
  bomList: BomRow[];
}> {
  const { data: matData, error: me } = await sb
    .from("materials")
    .select("id, material_name, box_weight_g, unit_weight_g, inventory_item_code")
    .order("material_name");
  if (me) throw me;
  const materials: Material[] = (matData ?? []).map(
    (row: {
      id: string | number;
      material_name: string | null;
      box_weight_g: number | null;
      unit_weight_g: number | null;
      inventory_item_code: string | null;
    }) => ({
      id: String(row.id),
      materialName: row.material_name ?? "",
      boxWeightG: Number(row.box_weight_g) || 0,
      unitWeightG: Number(row.unit_weight_g) || 0,
      inventoryItemCode: row.inventory_item_code ?? undefined,
    })
  );

  const { data: bomData, error: be } = await sb
    .from("bom")
    .select("id, product_name, material_name, bom_g_per_ea, basis")
    .order("product_name");
  if (be) throw be;
  const bomList: BomRow[] = (bomData ?? []).map(
    (row: {
      id: string | number;
      product_name: string | null;
      material_name: string | null;
      bom_g_per_ea: number | null;
      basis: "완제품" | "도우";
    }) => ({
      id: String(row.id),
      productName: row.product_name ?? "",
      materialName: row.material_name ?? "",
      bomGPerEa: Number(row.bom_g_per_ea) || 0,
      basis: row.basis,
    })
  );

  return { materials, bomList };
}

function createSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const key = serviceKey || anonKey;
  if (!url || !key) {
    console.error(
      "환경 변수가 없습니다. .env.local 에 NEXT_PUBLIC_SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY(권장) 또는 NEXT_PUBLIC_SUPABASE_ANON_KEY 를 설정하세요."
    );
    process.exit(1);
  }
  return createClient(url, key);
}

function rowHasData(r: {
  doughMixQty: number;
  doughWasteQty: number;
  parbakeWasteQty: number;
  sameDayParbakeProductionQty: number;
}): boolean {
  return (
    r.doughMixQty > 0 ||
    r.doughWasteQty > 0 ||
    r.parbakeWasteQty > 0 ||
    r.sameDayParbakeProductionQty > 0
  );
}

async function main() {
  loadEnvLocal();
  const { fromYear, toYear } = parseArgs();
  const sb = createSupabase();
  const { materials, bomList } = await fetchMaterialsAndBom(sb);
  const bomRefs = bomRowsToRefs(bomList);
  const meta = materialsToMeta(materials);

  const merged: ReturnType<typeof mergeBundleDaysWithManualImportsForTable>["rows"] = [];

  for (let y = fromYear; y <= toYear; y++) {
    const { bundle, error } = await loadProductionBundle(sb, y, bomRefs, meta);
    if (error) {
      console.error(`[${y}] 번들 로드 실패:`, error.message);
      process.exit(1);
    }
    if (!bundle) continue;
    const manual = manualSeriesForYear(y);
    const { rows } = mergeBundleDaysWithManualImportsForTable(bundle.days, manual);
    merged.push(...rows);
  }

  merged.sort((a, b) => a.date.localeCompare(b.date));

  const header =
    "일자\t반죽량\t반죽폐기량(도우폐기)\t파베이크생산량\t파베이크폐기량";
  const lines = merged
    .filter(rowHasData)
    .map((r) =>
      [
        r.date,
        r.doughMixQty,
        r.doughWasteQty,
        r.sameDayParbakeProductionQty,
        r.parbakeWasteQty,
      ].join("\t")
    );

  console.log([header, ...lines].join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
