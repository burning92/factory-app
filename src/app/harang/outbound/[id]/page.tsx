"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { displayHarangProductName } from "@/features/harang/displayProductName";
import { formatYmdDot } from "@/features/harang/finishedProductExpiry";

type HeaderRow = {
  id: string;
  outbound_date: string;
  outbound_no: string;
  note: string | null;
  created_at: string;
  client_name: string | null;
  client_manager_name: string | null;
  client_phone: string | null;
  client_address: string | null;
  supplier_name: string | null;
  supplier_manager_name: string | null;
  supplier_phone: string | null;
  supplier_address: string | null;
};

type LineRow = {
  id: string;
  product_name: string;
  unit: string;
  outbound_qty: number;
  sort_order: number;
};

type LotRow = {
  line_id: string;
  quantity_used: number;
  production_headers:
    | {
        production_no: string;
        production_date: string;
        finished_product_lot_date: string | null;
      }
    | {
        production_no: string;
        production_date: string;
        finished_product_lot_date: string | null;
      }[]
    | null;
};

type PrintBaseRow = {
  key: string;
  product: string;
  lot: string;
  productionNo: string;
  qty: number;
};

type PrintEditRow = {
  pallet: string;
  box: string;
  note: string;
};

function fmtNum(n: number): string {
  return Number(n || 0).toLocaleString("ko-KR");
}

function fmtDecimal(n: number): string {
  const fixed = Number(n || 0).toFixed(3);
  return fixed.replace(/\.?0+$/, "");
}

export default function HarangOutboundDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [header, setHeader] = useState<HeaderRow | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [lots, setLots] = useState<LotRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [printRowsEdit, setPrintRowsEdit] = useState<Record<string, PrintEditRow>>({});

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [hRes, lRes] = await Promise.all([
      supabase
        .from("harang_finished_product_outbound_headers")
        .select(`
          id, outbound_date, outbound_no, note, created_at,
          client_name, client_manager_name, client_phone, client_address,
          supplier_name, supplier_manager_name, supplier_phone, supplier_address
        `)
        .eq("id", id)
        .single(),
      supabase
        .from("harang_finished_product_outbound_lines")
        .select("id, product_name, unit, outbound_qty, sort_order")
        .eq("header_id", id)
        .order("sort_order", { ascending: true }),
    ]);
    if (hRes.error) {
      setLoading(false);
      alert(hRes.error.message);
      return;
    }
    if (lRes.error) {
      setLoading(false);
      alert(lRes.error.message);
      return;
    }
    const lineIds = (lRes.data ?? []).map((line) => line.id);
    const lotRes =
      lineIds.length > 0
        ? await supabase
            .from("harang_finished_product_outbound_line_lots")
            .select(`
              line_id, quantity_used,
              production_headers:production_header_id(production_no, production_date, finished_product_lot_date)
            `)
            .in("line_id", lineIds)
        : { data: [] as LotRow[], error: null };
    setLoading(false);
    if (lotRes.error) {
      alert(lotRes.error.message);
      return;
    }
    setHeader(hRes.data as HeaderRow);
    setLines((lRes.data ?? []) as LineRow[]);
    setLots((lotRes.data ?? []) as LotRow[]);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const lotMap = useMemo(() => {
    const map = new Map<string, LotRow[]>();
    for (const row of lots) {
      const arr = map.get(row.line_id) ?? [];
      arr.push(row);
      map.set(row.line_id, arr);
    }
    return map;
  }, [lots]);

  const printBaseRows = useMemo<PrintBaseRow[]>(() => {
    const out: PrintBaseRow[] = [];
    for (const line of lines) {
      const ls = lotMap.get(line.id) ?? [];
      if (ls.length === 0) {
        out.push({
          key: `${line.id}:0`,
          product: `[하랑]${displayHarangProductName(line.product_name)}`,
          lot: "-",
          productionNo: "-",
          qty: Number(line.outbound_qty ?? 0),
        });
        continue;
      }
      ls.forEach((lot, idx) => {
        const head = Array.isArray(lot.production_headers) ? lot.production_headers[0] : lot.production_headers;
        const lotYmd = String(head?.finished_product_lot_date ?? head?.production_date ?? "").slice(0, 10);
        out.push({
          key: `${line.id}:${idx}`,
          product: `[하랑]${displayHarangProductName(line.product_name)}`,
          lot: lotYmd ? formatYmdDot(lotYmd) : "-",
          productionNo: head?.production_no ?? "-",
          qty: Number(lot.quantity_used ?? 0),
        });
      });
    }
    return out;
  }, [lines, lotMap]);

  useEffect(() => {
    setPrintRowsEdit((prev) => {
      const next: Record<string, PrintEditRow> = {};
      for (const row of printBaseRows) {
        const existing = prev[row.key];
        next[row.key] = {
          pallet: existing?.pallet ?? String(Math.ceil(row.qty / 480)),
          box: existing?.box ?? fmtDecimal(row.qty / 20),
          note: existing?.note ?? "",
        };
      }
      return next;
    });
  }, [printBaseRows]);

  const printTotals = useMemo(() => {
    let qty = 0;
    let pallet = 0;
    let box = 0;
    for (const row of printBaseRows) {
      qty += row.qty;
      const edit = printRowsEdit[row.key];
      pallet += Number(edit?.pallet || 0);
      box += Number(edit?.box || 0);
    }
    return { qty, pallet, box };
  }, [printBaseRows, printRowsEdit]);

  if (loading) {
    return <div className="px-4 py-8 text-center text-slate-500">불러오는 중...</div>;
  }
  if (!header) {
    return <div className="px-4 py-8 text-center text-slate-500">내역을 찾을 수 없습니다.</div>;
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-5xl mx-auto space-y-5">
        <style jsx global>{`
          .only-print {
            display: none;
          }
          @media print {
            .no-print {
              display: none !important;
            }
            .only-print {
              display: block !important;
            }
            .print-wrap {
              max-width: none !important;
              margin: 0 !important;
              padding: 0 !important;
            }
            @page {
              size: A4 landscape;
              margin: 10mm;
            }
          }
        `}</style>

        <div className="no-print flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">완제품 출고명세서</h1>
            <p className="text-sm text-slate-600 mt-1">
              {header.outbound_no} · {header.outbound_date}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm bg-white"
            >
              출력
            </button>
            <Link href="/harang/outbound" className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm bg-white">
              목록으로
            </Link>
          </div>
        </div>

        <section className="no-print rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">출력 설정</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] table-fixed text-xs">
              <colgroup>
                <col style={{ width: "20%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "17%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "27%" }} />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-2 py-2 text-left">상품명</th>
                  <th className="px-2 py-2 text-left">소비기한</th>
                  <th className="px-2 py-2 text-right">수량</th>
                  <th className="px-2 py-2 text-right">파렛트 (480 EA / 24 BOX)</th>
                  <th className="px-2 py-2 text-right">20입 박스</th>
                  <th className="px-2 py-2 text-left">비고</th>
                </tr>
              </thead>
              <tbody>
                {printBaseRows.map((row) => (
                  <tr key={row.key} className="border-b border-slate-100 text-slate-900">
                    <td className="px-2 py-1.5">{row.product}</td>
                    <td className="px-2 py-1.5">{row.lot}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(row.qty)}</td>
                    <td className="px-2 py-1.5">
                      <input
                        value={printRowsEdit[row.key]?.pallet ?? ""}
                        onChange={(e) =>
                          setPrintRowsEdit((prev) => ({
                            ...prev,
                            [row.key]: { ...(prev[row.key] ?? { pallet: "", box: "", note: "" }), pallet: e.target.value },
                          }))
                        }
                        className="w-full rounded border border-slate-300 px-2 py-1 text-right text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={printRowsEdit[row.key]?.box ?? ""}
                        onChange={(e) =>
                          setPrintRowsEdit((prev) => ({
                            ...prev,
                            [row.key]: { ...(prev[row.key] ?? { pallet: "", box: "", note: "" }), box: e.target.value },
                          }))
                        }
                        className="w-full rounded border border-slate-300 px-2 py-1 text-right text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={printRowsEdit[row.key]?.note ?? ""}
                        onChange={(e) =>
                          setPrintRowsEdit((prev) => ({
                            ...prev,
                            [row.key]: { ...(prev[row.key] ?? { pallet: "", box: "", note: "" }), note: e.target.value },
                          }))
                        }
                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="no-print print-wrap rounded-xl border border-slate-300 bg-white p-4 sm:p-6 shadow-sm space-y-4">
          <div className="text-center border-b border-slate-300 pb-3">
            <h2 className="text-xl font-bold tracking-wide text-slate-900">출 고 명 세 서</h2>
            <p className="mt-1 text-sm text-slate-700">
              {header.outbound_no} / {formatYmdDot(header.outbound_date)}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-slate-300 p-3 space-y-1">
              <p className="text-xs font-semibold text-slate-600">공급받는자</p>
              <p className="font-semibold text-slate-900">{header.client_name || "-"}</p>
              <p className="text-slate-700">담당자: {header.client_manager_name || "-"}</p>
              <p className="text-slate-700">연락처: {header.client_phone || "-"}</p>
              <p className="text-slate-700">소재지: {header.client_address || "-"}</p>
            </div>
            <div className="rounded-lg border border-slate-300 p-3 space-y-1">
              <p className="text-xs font-semibold text-slate-600">공급자</p>
              <p className="font-semibold text-slate-900">{header.supplier_name || "-"}</p>
              <p className="text-slate-700">담당자: {header.supplier_manager_name || "-"}</p>
              <p className="text-slate-700">연락처: {header.supplier_phone || "-"}</p>
              <p className="text-slate-700">소재지: {header.supplier_address || "-"}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-700">
            <p>출고일자: <span className="font-medium text-slate-900">{formatYmdDot(header.outbound_date)}</span></p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm border border-slate-300">
              <thead>
                <tr className="border-b border-slate-300 bg-slate-50 text-slate-700">
                  <th className="px-3 py-2 text-left border-r border-slate-300">완제품명</th>
                  <th className="px-3 py-2 text-left border-r border-slate-300">소비기한 LOT</th>
                  <th className="px-3 py-2 text-left border-r border-slate-300">원본 생산입고 No.</th>
                  <th className="px-3 py-2 text-right border-r border-slate-300">출고수량</th>
                  <th className="px-3 py-2 text-left">비고</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const ls = lotMap.get(line.id) ?? [];
                  return ls.length > 0 ? (
                    ls.map((lot, idx) => {
                      const head = Array.isArray(lot.production_headers)
                        ? lot.production_headers[0]
                        : lot.production_headers;
                      const lotYmd = String(head?.finished_product_lot_date ?? head?.production_date ?? "").slice(0, 10);
                      return (
                        <tr key={`${line.id}:${idx}`} className="border-b border-slate-200 text-slate-900">
                          <td className="px-3 py-2 border-r border-slate-200">{idx === 0 ? `[하랑]${displayHarangProductName(line.product_name)}` : ""}</td>
                          <td className="px-3 py-2 tabular-nums border-r border-slate-200">{lotYmd ? formatYmdDot(lotYmd) : "-"}</td>
                          <td className="px-3 py-2 font-mono text-xs border-r border-slate-200">{head?.production_no ?? "-"}</td>
                          <td className="px-3 py-2 text-right tabular-nums border-r border-slate-200">
                            {Number(lot.quantity_used).toLocaleString("ko-KR")} {line.unit}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{idx === 0 ? header.note || "-" : ""}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr key={line.id} className="border-b border-slate-200 text-slate-900">
                      <td className="px-3 py-2 border-r border-slate-200">[하랑]{displayHarangProductName(line.product_name)}</td>
                      <td className="px-3 py-2 border-r border-slate-200">-</td>
                      <td className="px-3 py-2 border-r border-slate-200">-</td>
                      <td className="px-3 py-2 text-right tabular-nums border-r border-slate-200">
                        {Number(line.outbound_qty).toLocaleString("ko-KR")} {line.unit}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{header.note || "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="only-print print-wrap bg-white text-black pt-2">
          <div className="mx-auto w-[276mm] border border-black p-2">
            <div className="flex items-start justify-between gap-3">
              <div className="pt-14 pl-4 text-[18px] leading-none">
                <span className="font-semibold">출고일자</span>
                <span className="ml-5 font-bold">{header.outbound_date}</span>
              </div>
              <div className="w-[300px] border border-black">
                <table className="w-full table-fixed border-collapse text-[12px]">
                  <colgroup>
                    <col style={{ width: "33.33%" }} />
                    <col style={{ width: "33.33%" }} />
                    <col style={{ width: "33.33%" }} />
                  </colgroup>
                  <tbody>
                    <tr>
                      <td className="border border-black px-2 py-1.5 text-center font-semibold">담당</td>
                      <td className="border border-black px-2 py-1.5 text-center font-semibold">현장</td>
                      <td className="border border-black px-2 py-1.5 text-center font-semibold">배송기사</td>
                    </tr>
                    <tr>
                      <td className="border border-black px-2 py-6 text-center align-middle">{header.supplier_manager_name || ""}</td>
                      <td className="border border-black px-2 py-6">&nbsp;</td>
                      <td className="border border-black px-2 py-6">&nbsp;</td>
                    </tr>
                    <tr>
                      <td className="border border-black px-2 py-2 text-center font-semibold">기사님</td>
                      <td className="border border-black px-2 py-2" colSpan={2}>&nbsp;</td>
                    </tr>
                    <tr>
                      <td className="border border-black px-2 py-2 text-center font-semibold">연락처</td>
                      <td className="border border-black px-2 py-2" colSpan={2}>&nbsp;</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-3 border border-black">
              <table className="w-full border-collapse text-sm">
                <colgroup>
                  <col style={{ width: "34px" }} />
                  <col style={{ width: "120px" }} />
                  <col />
                  <col style={{ width: "88px" }} />
                  <col style={{ width: "130px" }} />
                  <col style={{ width: "82px" }} />
                  <col style={{ width: "160px" }} />
                </colgroup>
                <tbody>
                  <tr>
                    <td rowSpan={2} className="w-10 border border-black px-1 text-center font-semibold">공급자</td>
                    <td className="border border-black bg-slate-100 px-2 py-1.5 font-semibold">상호(법인명)</td>
                    <td className="border border-black px-2 py-1.5 font-semibold">{header.supplier_name || "-"}</td>
                    <td className="border border-black bg-slate-100 px-2 py-1.5 font-semibold">담당자</td>
                    <td className="border border-black px-2 py-1.5">{header.supplier_manager_name || "-"}</td>
                    <td className="border border-black bg-slate-100 px-2 py-1.5 font-semibold">연락처</td>
                    <td className="border border-black px-2 py-1.5">{header.supplier_phone || "-"}</td>
                  </tr>
                  <tr>
                    <td className="border border-black bg-slate-100 px-2 py-1.5 font-semibold">사업장소재지</td>
                    <td className="border border-black px-2 py-1.5" colSpan={5}>{header.supplier_address || "-"}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-2 border border-black">
              <table className="w-full border-collapse text-sm">
                <colgroup>
                  <col style={{ width: "34px" }} />
                  <col style={{ width: "120px" }} />
                  <col />
                  <col style={{ width: "88px" }} />
                  <col style={{ width: "130px" }} />
                  <col style={{ width: "82px" }} />
                  <col style={{ width: "160px" }} />
                </colgroup>
                <tbody>
                  <tr>
                    <td rowSpan={2} className="w-10 border border-black px-1 text-center font-semibold">공급받는자</td>
                    <td className="border border-black bg-slate-100 px-2 py-1.5 font-semibold">상호(법인명)</td>
                    <td className="border border-black px-2 py-1.5 font-semibold">{header.client_name || "-"}</td>
                    <td className="border border-black bg-slate-100 px-2 py-1.5 font-semibold">담당자</td>
                    <td className="border border-black px-2 py-1.5">{header.client_manager_name || "-"}</td>
                    <td className="border border-black bg-slate-100 px-2 py-1.5 font-semibold">연락처</td>
                    <td className="border border-black px-2 py-1.5">{header.client_phone || "-"}</td>
                  </tr>
                  <tr>
                    <td className="border border-black bg-slate-100 px-2 py-1.5 font-semibold">사업장소재지</td>
                    <td className="border border-black px-2 py-1.5" colSpan={5}>{header.client_address || "-"}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-4 border border-black">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="border border-black px-2 py-1.5 w-10">No</th>
                    <th className="border border-black px-2 py-1.5">상품명</th>
                    <th className="border border-black px-2 py-1.5 w-20">파렛트</th>
                    <th className="border border-black px-2 py-1.5 w-20">수량</th>
                    <th className="border border-black px-2 py-1.5 w-24">소비기한</th>
                    <th className="border border-black px-2 py-1.5 w-24">20입 박스</th>
                    <th className="border border-black px-2 py-1.5 w-24">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {printBaseRows.map((row, idx) => (
                    <tr key={`print:${row.key}`}>
                      <td className="border border-black px-2 py-1.5 text-center">{idx + 1}</td>
                      <td className="border border-black px-2 py-1.5">{row.product}</td>
                      <td className="border border-black px-2 py-1.5 text-right tabular-nums">{printRowsEdit[row.key]?.pallet || "0"}</td>
                      <td className="border border-black px-2 py-1.5 text-right tabular-nums">{fmtNum(row.qty)}</td>
                      <td className="border border-black px-2 py-1.5 text-center">{row.lot}</td>
                      <td className="border border-black px-2 py-1.5 text-right tabular-nums">{printRowsEdit[row.key]?.box || "0"}</td>
                      <td className="border border-black px-2 py-1.5">{printRowsEdit[row.key]?.note || ""}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="border border-black px-2 py-1.5 text-center font-semibold bg-yellow-200" colSpan={2}>합계</td>
                    <td className="border border-black px-2 py-1.5 text-right tabular-nums font-semibold bg-yellow-200">{fmtDecimal(printTotals.pallet)}</td>
                    <td className="border border-black px-2 py-1.5 text-right tabular-nums font-semibold bg-yellow-200">{fmtNum(printTotals.qty)}</td>
                    <td className="border border-black px-2 py-1.5 bg-yellow-200"></td>
                    <td className="border border-black px-2 py-1.5 text-right tabular-nums font-semibold bg-yellow-200">{fmtDecimal(printTotals.box)}</td>
                    <td className="border border-black px-2 py-1.5 bg-yellow-200"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
