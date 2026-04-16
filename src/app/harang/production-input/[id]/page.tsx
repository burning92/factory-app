"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type ProductionLine = {
  id: string;
  material_category: "raw_material" | "packaging_material";
  material_name: string;
  bom_qty: number;
  unit: string;
  usage_qty: number;
  lot_dates_summary: string | null;
  sort_order: number;
};

function isParbakeLineName(name: string): boolean {
  return name.replace(/\s/g, "").includes("파베이크도우");
}

function displayUnitForLine(line: ProductionLine): string {
  if (line.material_category === "packaging_material") return "EA";
  return isParbakeLineName(line.material_name) ? "EA" : "g";
}

type ProductionLotUsage = {
  line_id: string;
  quantity_used: number;
  lots?: { lot_date: string | null } | null;
};

type ProductionHeaderDetail = {
  id: string;
  production_date: string;
  production_no: string;
  product_name: string;
  finished_qty: number;
  note: string | null;
  created_at: string;
};

function sectionLabel(category: "raw_material" | "packaging_material"): string {
  return category === "raw_material" ? "원재료" : "부자재";
}

export default function HarangProductionInputDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [header, setHeader] = useState<ProductionHeaderDetail | null>(null);
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [lotUsages, setLotUsages] = useState<ProductionLotUsage[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [headerRes, linesRes, lotsRes] = await Promise.all([
      supabase
        .from("harang_production_headers")
        .select("id, production_date, production_no, product_name, finished_qty, note, created_at")
        .eq("id", id)
        .single(),
      supabase
        .from("harang_production_lines")
        .select("id, material_category, material_name, bom_qty, unit, usage_qty, lot_dates_summary, sort_order")
        .eq("header_id", id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("harang_production_line_lots")
        .select("line_id, quantity_used, lots:lot_id(lot_date)")
        .in(
          "line_id",
          (
            await supabase
              .from("harang_production_lines")
              .select("id")
              .eq("header_id", id)
          ).data?.map((r) => r.id) ?? ["00000000-0000-0000-0000-000000000000"],
        ),
    ]);
    setLoading(false);
    if (headerRes.error) return alert(headerRes.error.message);
    if (linesRes.error) return alert(linesRes.error.message);
    if (lotsRes.error) return alert(lotsRes.error.message);
    setHeader(headerRes.data as ProductionHeaderDetail);
    setLines((linesRes.data ?? []) as ProductionLine[]);
    setLotUsages((lotsRes.data ?? []) as ProductionLotUsage[]);
  }, [id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const usageMap = useMemo(() => {
    const map = new Map<
      string,
      { total: number; dates: string[]; details: Array<{ date: string; qty: number }> }
    >();
    for (const row of lotUsages) {
      const prev = map.get(row.line_id) ?? { total: 0, dates: [], details: [] };
      prev.total += Number(row.quantity_used) || 0;
      const d = String(row.lots?.lot_date ?? "").slice(0, 10).replaceAll("-", ".");
      if (d && !prev.dates.includes(d)) prev.dates.push(d);
      if (d) {
        prev.details.push({
          date: d,
          qty: Number(row.quantity_used) || 0,
        });
      }
      map.set(row.line_id, prev);
    }
    return map;
  }, [lotUsages]);

  const grouped = useMemo(() => {
    const parbake = lines.filter(
      (l) => l.material_category === "raw_material" && isParbakeLineName(l.material_name),
    );
    const rawOnly = lines.filter(
      (l) => l.material_category === "raw_material" && !isParbakeLineName(l.material_name),
    );
    const pack = lines.filter((l) => l.material_category === "packaging_material");
    return {
      parbake,
      raw: rawOnly,
      pack,
    };
  }, [lines]);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="print:hidden flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">생산입고 내역</h1>
            <p className="text-sm text-slate-600 mt-1">출력 가능한 상세 내역</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700"
            >
              출력
            </button>
            <Link href="/harang/production-input" className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm bg-white">
              목록으로
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">불러오는 중...</div>
        ) : !header ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">내역을 찾을 수 없습니다.</div>
        ) : (
          <>
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><p className="text-slate-500 text-xs">일자-No.</p><p className="mt-1 text-slate-900">{header.production_no}</p></div>
                <div><p className="text-slate-500 text-xs">일자</p><p className="mt-1 text-slate-900">{header.production_date}</p></div>
                <div><p className="text-slate-500 text-xs">제품명</p><p className="mt-1 text-slate-900">{header.product_name}</p></div>
                <div><p className="text-slate-500 text-xs">생산수량</p><p className="mt-1 text-slate-900 tabular-nums">{Number(header.finished_qty).toLocaleString("ko-KR")}</p></div>
              </div>
              <div className="mt-3 text-sm">
                <p className="text-slate-500 text-xs">비고</p>
                <p className="mt-1 text-slate-900">{header.note || "-"}</p>
              </div>
            </section>

            {([
              { title: "파베이크", rows: grouped.parbake },
              { title: sectionLabel("raw_material"), rows: grouped.raw },
              { title: sectionLabel("packaging_material"), rows: grouped.pack },
            ] as const).map((section) => (
              <section key={section.title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-800 mb-3">{section.title}</h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] table-fixed text-sm">
                    <colgroup>
                      <col className="w-[36%]" />
                      <col className="w-[19%]" />
                      <col className="w-[19%]" />
                      <col className="w-[26%]" />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-600">
                        <th className="px-3 py-2 text-left">소모품목명</th>
                        <th className="px-3 py-2 text-right">BOM(소요)</th>
                        <th className="px-3 py-2 text-right">사용량</th>
                        <th className="px-3 py-2 text-left">LOT(소비기한/제조일자)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.length === 0 ? (
                        <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500">내역 없음</td></tr>
                      ) : (
                        section.rows.map((line) => {
                          const usage = usageMap.get(line.id);
                          const unitLabel = displayUnitForLine(line);
                          const lotDetailText =
                            usage && usage.details.length > 0
                              ? usage.details
                                  .map(
                                    (x) =>
                                      `${x.date}(${x.qty.toLocaleString("ko-KR", {
                                        maximumFractionDigits: 3,
                                      })} ${unitLabel})`,
                                  )
                                  .join("\n")
                              : "";
                          return (
                            <tr key={line.id} className="border-b border-slate-100 text-slate-900">
                              <td className="px-3 py-2">{line.material_name}</td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {Number(line.bom_qty).toLocaleString("ko-KR", { maximumFractionDigits: 3 })} {unitLabel}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {Number(line.usage_qty).toLocaleString("ko-KR", { maximumFractionDigits: 3 })} {unitLabel}
                              </td>
                              <td className="px-3 py-2 whitespace-pre-line">
                                {lotDetailText || line.lot_dates_summary || usage?.dates.join(" · ") || "-"}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

