"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { displayHarangProductName } from "@/features/harang/displayProductName";
import {
  formatYmdDot,
  harangProductExpiryFromProductionDate,
} from "@/features/harang/finishedProductExpiry";

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
  lots?: Array<{ lot_date: string | null }> | null;
};

type ProductionHeaderDetail = {
  id: string;
  production_date: string;
  production_no: string;
  product_name: string;
  finished_qty: number;
  finished_product_lot_date?: string | null;
  note: string | null;
  created_at: string;
};

function sectionLabel(category: "raw_material" | "packaging_material"): string {
  return category === "raw_material" ? "원재료" : "부자재";
}

export default function HarangProductionInputDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [header, setHeader] = useState<ProductionHeaderDetail | null>(null);
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [lotUsages, setLotUsages] = useState<ProductionLotUsage[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [headerRes, linesRes, lotsRes] = await Promise.all([
      supabase
        .from("harang_production_headers")
        .select("id, production_date, production_no, product_name, finished_qty, finished_product_lot_date, note, created_at")
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

  const handleDelete = async () => {
    if (!header) return;
    if (!confirm("이 생산입고 내역을 삭제할까요? LOT/재고/요청 반영이 함께 되돌아갑니다.")) return;
    setBusy(true);
    const { error } = await supabase.rpc("delete_harang_production_with_usage", { p_header_id: header.id });
    setBusy(false);
    if (error) {
      const msg = String(error.message ?? "");
      if (
        msg.includes("harang_finished_product_outbound_line_production_header_id_fkey") ||
        msg.includes("harang_finished_product_outbound_line_lots")
      ) {
        alert(
          "이미 완제품 출고에 사용된 생산입고 내역입니다.\n출고내역을 먼저 취소/삭제한 뒤 생산입고를 삭제해 주세요.",
        );
        return;
      }
      alert(msg);
      return;
    }
    router.replace("/harang/production-input");
  };

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
      const d = String(row.lots?.[0]?.lot_date ?? "").slice(0, 10).replaceAll("-", ".");
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
    <>
      {/* 인쇄: A4 세로, 행 단위로 끊김 완화 (브라우저마다 차이 있음) */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
@media print {
  @page { size: A4 portrait; margin: 10mm 12mm; }
  .harang-production-print-root { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .harang-production-print-root .harang-print-table thead { display: table-header-group; }
  .harang-production-print-root .harang-print-table tbody tr { break-inside: avoid; page-break-inside: avoid; }
  .harang-production-print-root .harang-print-section { break-inside: auto; page-break-inside: auto; }
  .harang-production-print-root .harang-print-section-title { break-after: avoid; page-break-after: avoid; }
}
`,
        }}
      />
      <div className="harang-production-print-root px-4 sm:px-6 lg:px-8 py-8 print:px-2 print:py-4 print:bg-white">
      <div className="max-w-5xl mx-auto space-y-5 print:max-w-none print:space-y-4">
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
            <Link
              href={`/harang/production-input/new?edit_id=${id}`}
              className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm bg-white"
            >
              수정
            </Link>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={busy}
              className="px-3 py-2 rounded-lg border border-red-300 text-red-700 text-sm bg-white disabled:opacity-60"
            >
              삭제
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
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:rounded-lg print:border-slate-300 print:p-3 print:shadow-none">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm print:gap-2 print:text-xs">
                <div><p className="text-slate-500 text-xs">일자-No.</p><p className="mt-1 text-slate-900 break-words">{header.production_no}</p></div>
                <div><p className="text-slate-500 text-xs">일자</p><p className="mt-1 text-slate-900">{header.production_date}</p></div>
                <div className="col-span-2 sm:col-span-1">
                  <p className="text-slate-500 text-xs">생산수량</p>
                  <p className="mt-1 text-slate-900 tabular-nums">{Number(header.finished_qty).toLocaleString("ko-KR")}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-xs">제품 시리얼 / LOT</p>
                  <p className="mt-1 text-slate-900 tabular-nums">
                    {formatYmdDot(
                      (header.finished_product_lot_date ?? header.production_date).slice(0, 10),
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500 text-xs">제품 소비기한</p>
                  <p className="mt-1 text-slate-900 tabular-nums">
                    {formatYmdDot(harangProductExpiryFromProductionDate(header.production_date))}
                  </p>
                </div>
              </div>
              <div className="mt-3 text-sm print:mt-2">
                <p className="text-slate-500 text-xs">제품명</p>
                <p className="mt-1 text-slate-900 text-sm md:text-base print:text-[11px] leading-snug break-words">
                  {displayHarangProductName(header.product_name)}
                </p>
              </div>
              <div className="mt-3 text-sm print:mt-2 print:text-xs">
                <p className="text-slate-500 text-xs">비고</p>
                <p className="mt-1 text-slate-900 break-words leading-snug">{header.note || "-"}</p>
              </div>
            </section>

            {([
              { title: "파베이크", rows: grouped.parbake },
              { title: sectionLabel("raw_material"), rows: grouped.raw },
              { title: sectionLabel("packaging_material"), rows: grouped.pack },
            ] as const).map((section) => (
              <section
                key={section.title}
                className="harang-print-section rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:rounded-lg print:border-slate-300 print:p-3 print:shadow-none"
              >
                <h2 className="harang-print-section-title text-sm font-semibold text-slate-800 mb-3 print:mb-2 print:text-xs">{section.title}</h2>
                <div className="overflow-x-auto print:overflow-visible">
                  <table className="harang-print-table w-full min-w-[760px] table-fixed text-sm print:min-w-0 print:w-full print:text-[11px]">
                    <colgroup>
                      <col className="w-[34%] print:w-[32%]" />
                      <col className="w-[18%] print:w-[17%]" />
                      <col className="w-[18%] print:w-[17%]" />
                      <col className="w-[30%] print:w-[34%]" />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-600 print:border-slate-400">
                        <th className="px-3 py-2 text-left print:px-1.5 print:py-1">소모품목명</th>
                        <th className="px-3 py-2 text-right print:px-1.5 print:py-1">BOM(소요)</th>
                        <th className="px-3 py-2 text-right print:px-1.5 print:py-1">사용량</th>
                        <th className="px-3 py-2 text-left print:px-1.5 print:py-1">LOT(소비기한/제조일자)</th>
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
                            <tr key={line.id} className="border-b border-slate-100 text-slate-900 print:border-slate-200">
                              <td className="px-3 py-2 align-top break-words print:px-1.5 print:py-1.5">{line.material_name}</td>
                              <td className="px-3 py-2 text-right tabular-nums align-top print:px-1.5 print:py-1.5">
                                {Number(line.bom_qty).toLocaleString("ko-KR", { maximumFractionDigits: 3 })} {unitLabel}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums align-top print:px-1.5 print:py-1.5">
                                {Number(line.usage_qty).toLocaleString("ko-KR", { maximumFractionDigits: 3 })} {unitLabel}
                              </td>
                              <td className="px-3 py-2 whitespace-pre-line align-top break-words print:whitespace-pre-line print:px-1.5 print:py-1.5">
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
    </>
  );
}

