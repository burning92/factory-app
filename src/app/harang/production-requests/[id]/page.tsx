"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  computeLineMaterialDisplay,
  materialKey,
  sumStockByMaterial,
  STATUS_LABEL,
  canManageHqHarangProductionRequests,
} from "@/features/harang/productionRequests";
import type { HarangCategory } from "@/features/harang/types";
import { supabase } from "@/lib/supabase";

type Line = {
  id: string;
  product_name: string;
  requested_qty: number;
  produced_qty: number;
  remaining_qty: number;
  material_shortage_flag: boolean;
  note: string | null;
};

type MatRow = {
  id: string;
  request_line_id: string;
  material_category: HarangCategory;
  material_id: string;
  material_name: string;
  unit: string;
  bom_qty_per_unit: number;
  snapshot_required_total: number;
};

type ResRow = {
  request_line_id: string;
  material_category: HarangCategory;
  material_id: string;
  reserved_qty: number;
};

function isParbakeMaterialName(name: string): boolean {
  return name.replace(/\s/g, "").includes("파베이크도우");
}

export default function HarangProductionRequestDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { organization, profile } = useAuth();
  const canCancelRequest = canManageHqHarangProductionRequests(organization?.organization_code, profile?.role);

  const [header, setHeader] = useState<{
    id: string;
    request_no: string;
    request_date: string;
    due_date: string;
    priority: number;
    status: string;
    note: string | null;
  } | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [materials, setMaterials] = useState<MatRow[]>([]);
  const [reservations, setReservations] = useState<ResRow[]>([]);
  const [stockByKey, setStockByKey] = useState<Map<string, number>>(new Map());
  const [totalReservedByKey, setTotalReservedByKey] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingHeader, setEditingHeader] = useState(false);
  const [editDueDate, setEditDueDate] = useState("");
  const [editPriority, setEditPriority] = useState("0");
  const [editNote, setEditNote] = useState("");
  const [canHardDelete, setCanHardDelete] = useState(false);
  const [deleteBlockedReason, setDeleteBlockedReason] = useState("");
  const [actualUsageRows, setActualUsageRows] = useState<
    Array<{ material_category: HarangCategory; material_name: string; unit: string; usage_total: number }>
  >([]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const hRes = await supabase.from("harang_production_requests").select("*").eq("id", id).single();
    if (hRes.error) {
      setLoading(false);
      alert(hRes.error.message);
      return;
    }
    const lRes = await supabase
      .from("harang_production_request_lines")
      .select("*")
      .eq("header_id", id)
      .order("sort_order", { ascending: true });
    const lineIds = (lRes.data ?? []).map((x) => x.id);
    const mRes =
      lineIds.length > 0
        ? await supabase.from("harang_production_request_line_materials").select("*").in("request_line_id", lineIds)
        : { data: [] as MatRow[] };
    const rRes =
      lineIds.length > 0
        ? await supabase.from("harang_production_request_reservations").select("*").in("request_line_id", lineIds)
        : { data: [] as ResRow[] };

    const matRows = (mRes.data ?? []) as MatRow[];
    const lotsRes = await supabase
      .from("harang_inventory_lots")
      .select("category, item_id, current_quantity");
    const stockMap = sumStockByMaterial((lotsRes.data ?? []) as Parameters<typeof sumStockByMaterial>[0]);

    const allRes = await supabase.from("harang_production_request_reservations").select(
      "material_category, material_id, reserved_qty",
    );
    const tr = new Map<string, number>();
    for (const row of allRes.data ?? []) {
      const k = materialKey(
        row.material_category as HarangCategory,
        row.material_id as string,
      );
      tr.set(k, (tr.get(k) ?? 0) + Number(row.reserved_qty));
    }

    setHeader(hRes.data as typeof header);
    const hd = hRes.data as {
      due_date?: string | null;
      priority?: number | null;
      note?: string | null;
    };
    setEditDueDate(String(hd.due_date ?? ""));
    setEditPriority(String(hd.priority ?? 0));
    setEditNote(String(hd.note ?? ""));
    setLines((lRes.data ?? []) as Line[]);
    setMaterials(matRows);
    setReservations((rRes.data ?? []) as ResRow[]);
    setStockByKey(stockMap);
    setTotalReservedByKey(tr);

    const shouldShowActualUsage = ["completed", "settled"].includes(String((hRes.data as { status?: string } | null)?.status ?? ""));
    if (shouldShowActualUsage) {
      const phRes = await supabase
        .from("harang_production_headers")
        .select("id")
        .eq("request_id", id);
      if (!phRes.error) {
        const pids = (phRes.data ?? []).map((x) => x.id as string);
        if (pids.length > 0) {
          const plRes = await supabase
            .from("harang_production_lines")
            .select("material_category, material_name, unit, usage_qty")
            .in("header_id", pids);
          if (!plRes.error) {
            const agg = new Map<string, { material_category: HarangCategory; material_name: string; unit: string; usage_total: number }>();
            for (const row of plRes.data ?? []) {
              const cat = row.material_category as HarangCategory;
              const name = String(row.material_name ?? "");
              const unit = String(row.unit ?? "");
              const k = `${cat}:${name}:${unit}`;
              const prev = agg.get(k) ?? { material_category: cat, material_name: name, unit, usage_total: 0 };
              prev.usage_total += Number(row.usage_qty ?? 0);
              agg.set(k, prev);
            }
            setActualUsageRows(Array.from(agg.values()).sort((a, b) => a.material_name.localeCompare(b.material_name, "ko")));
          } else {
            setActualUsageRows([]);
          }
        } else {
          setActualUsageRows([]);
        }
      } else {
        setActualUsageRows([]);
      }
    } else {
      setActualUsageRows([]);
    }
    const [prodRes, closeRes] = await Promise.all([
      supabase.from("harang_production_headers").select("id", { count: "exact", head: true }).eq("request_id", id),
      lineIds.length > 0
        ? supabase
            .from("harang_production_request_line_closures")
            .select("id", { count: "exact", head: true })
            .in("request_line_id", lineIds)
        : Promise.resolve({ count: 0, error: null } as unknown as { count: number | null; error: null }),
    ]);
    const hasProductionHistory = !!((prodRes.count ?? 0) > 0);
    const hasClosureHistory = !!((closeRes.count ?? 0) > 0);
    const canDelete = !hasProductionHistory && !hasClosureHistory;
    setCanHardDelete(canDelete);
    setDeleteBlockedReason(
      canDelete ? "" : "이미 생산반영 또는 종결 이력이 있는 요청은 삭제할 수 없습니다.",
    );

    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveHeaderEdit = async () => {
    if (!header || !canCancelRequest) return;
    setBusy(true);
    const { error } = await supabase.rpc("update_harang_production_request_header", {
      p_header_id: header.id,
      p_due_date: editDueDate || null,
      p_priority: Number(editPriority),
      p_note: editNote || null,
    });
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    setEditingHeader(false);
    await load();
  };

  const closeRemaining = async (line: Line) => {
    if (!header || !canCancelRequest) return;
    if (line.remaining_qty <= 0) return;
    const rawQty = prompt(`종결수량을 입력하세요. (잔여 ${Number(line.remaining_qty).toLocaleString("ko-KR")})`, String(line.remaining_qty));
    if (!rawQty) return;
    const q = Number(rawQty.replace(/,/g, ""));
    if (!Number.isFinite(q) || q <= 0) {
      alert("종결수량은 0보다 커야 합니다.");
      return;
    }
    const reason = prompt("종결사유를 입력하세요.");
    if (!reason || !reason.trim()) {
      alert("종결사유는 필수입니다.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("close_harang_request_line_remaining", {
      p_line_id: line.id,
      p_close_qty: q,
      p_reason: reason.trim(),
    });
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    await load();
  };

  const deleteRequest = async () => {
    if (!header || !canCancelRequest) return;
    if (!canHardDelete) {
      alert(deleteBlockedReason || "삭제할 수 없습니다.");
      return;
    }
    if (!confirm("이 요청을 완전 삭제할까요?")) return;
    setBusy(true);
    const { error } = await supabase.rpc("delete_harang_production_request", { p_header_id: header.id });
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    router.replace("/harang/production-requests");
  };

  if (loading || !header) {
    return (
      <div className="px-4 py-12 text-center text-slate-500">{loading ? "불러오는 중…" : "없는 요청입니다."}</div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500 font-mono">{header.request_no}</p>
            <h1 className="text-2xl font-semibold text-slate-900 mt-1">생산요청 상세</h1>
            <p className="text-sm text-slate-600 mt-1">
              상태: {STATUS_LABEL[header.status as keyof typeof STATUS_LABEL] ?? header.status} · 납기 {header.due_date}{" "}
              · 우선 {header.priority}
            </p>
            {header.note && <p className="text-sm text-slate-700 mt-2">비고: {header.note}</p>}
            {!canHardDelete && canCancelRequest && (
              <p className="text-xs text-amber-700 mt-2">{deleteBlockedReason}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Link
              href="/harang/production-requests"
              className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm bg-white"
            >
              목록
            </Link>
            {canCancelRequest && !["completed", "settled", "cancelled"].includes(header.status) && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditingHeader((prev) => !prev)}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm bg-white"
                >
                  {editingHeader ? "수정취소" : "수정"}
                </button>
                <button
                  type="button"
                  disabled={busy || !canHardDelete}
                  onClick={() => void deleteRequest()}
                  className="px-3 py-2 rounded-lg border border-red-300 text-red-700 text-sm disabled:opacity-50"
                >
                  삭제
                </button>
              </>
            )}
          </div>
        </div>

        {editingHeader && canCancelRequest && (
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <h2 className="text-sm font-semibold text-slate-800">요청 운영 정보 수정</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="text-xs text-slate-600">
                납기일
                <input
                  type="date"
                  value={editDueDate}
                  onChange={(e) => setEditDueDate(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
                />
              </label>
              <label className="text-xs text-slate-600">
                우선순위
                <input
                  type="number"
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
                />
              </label>
              <label className="text-xs text-slate-600 sm:col-span-3">
                비고
                <input
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditingHeader(false)}
                className="px-3 py-2 rounded border border-slate-300 text-slate-700 text-sm"
              >
                취소
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveHeaderEdit()}
                className="px-3 py-2 rounded bg-cyan-600 text-white text-sm disabled:opacity-50"
              >
                저장
              </button>
            </div>
          </section>
        )}

        {lines.map((line) => {
          const lineMats = materials.filter((m) => m.request_line_id === line.id);
          const shortageLabels: string[] = [];
          const hasParbakeShortage = lineMats.some((m) => {
            if (m.material_category !== "raw_material" || !isParbakeMaterialName(m.material_name)) return false;
            const rem = Number(line.remaining_qty);
            const need = rem * Number(m.bom_qty_per_unit);
            const mk = materialKey(m.material_category, m.material_id);
            const stock = stockByKey.get(mk) ?? 0;
            const totalR = totalReservedByKey.get(mk) ?? 0;
            const lineR =
              reservations.find(
                (r) =>
                  r.request_line_id === line.id &&
                  r.material_category === m.material_category &&
                  r.material_id === m.material_id,
              )?.reserved_qty ?? 0;
            const d = computeLineMaterialDisplay({
              need,
              stock,
              totalReserved: totalR,
              lineReserved: lineR,
            });
            return d.shortage > 0;
          });
          const hasRawShortage = lineMats.some((m) => {
            if (m.material_category !== "raw_material" || isParbakeMaterialName(m.material_name)) return false;
            const rem = Number(line.remaining_qty);
            const need = rem * Number(m.bom_qty_per_unit);
            const mk = materialKey(m.material_category, m.material_id);
            const stock = stockByKey.get(mk) ?? 0;
            const totalR = totalReservedByKey.get(mk) ?? 0;
            const lineR =
              reservations.find(
                (r) =>
                  r.request_line_id === line.id &&
                  r.material_category === m.material_category &&
                  r.material_id === m.material_id,
              )?.reserved_qty ?? 0;
            const d = computeLineMaterialDisplay({
              need,
              stock,
              totalReserved: totalR,
              lineReserved: lineR,
            });
            return d.shortage > 0;
          });
          const hasPackagingShortage = lineMats.some((m) => {
            if (m.material_category !== "packaging_material") return false;
            const rem = Number(line.remaining_qty);
            const need = rem * Number(m.bom_qty_per_unit);
            const mk = materialKey(m.material_category, m.material_id);
            const stock = stockByKey.get(mk) ?? 0;
            const totalR = totalReservedByKey.get(mk) ?? 0;
            const lineR =
              reservations.find(
                (r) =>
                  r.request_line_id === line.id &&
                  r.material_category === m.material_category &&
                  r.material_id === m.material_id,
              )?.reserved_qty ?? 0;
            const d = computeLineMaterialDisplay({
              need,
              stock,
              totalReserved: totalR,
              lineReserved: lineR,
            });
            return d.shortage > 0;
          });
          if (hasParbakeShortage) shortageLabels.push("파베이크 부족");
          if (hasRawShortage) shortageLabels.push("원재료 부족");
          if (hasPackagingShortage) shortageLabels.push("부자재 부족");
          return (
            <section key={line.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{line.product_name}</h2>
                  <p className="text-sm text-slate-600 tabular-nums">
                    요청 {Number(line.requested_qty).toLocaleString("ko-KR")} · 완료{" "}
                    {Number(line.produced_qty).toLocaleString("ko-KR")} · 잔여{" "}
                    {Number(line.remaining_qty).toLocaleString("ko-KR")}
                    {shortageLabels.length > 0 && line.remaining_qty > 0 && (
                      <span className="ml-2 text-amber-700 font-medium">{shortageLabels.join(" · ")}</span>
                    )}
                  </p>
                </div>
                {!["completed", "settled", "cancelled"].includes(header.status) && (
                  <div className="flex items-end gap-2">
                    <Link
                      href={`/harang/production-input/new?request_id=${header.id}&request_line_id=${line.id}`}
                      className="px-3 py-2 rounded-lg border border-cyan-300 text-cyan-800 text-sm bg-cyan-50"
                    >
                      생산입고 이동
                    </Link>
                    {canCancelRequest && line.remaining_qty > 0 && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void closeRemaining(line)}
                        className="px-3 py-2 rounded-lg border border-amber-300 text-amber-800 text-sm bg-amber-50 disabled:opacity-50"
                      >
                        잔량 종결
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-xs sm:text-sm text-slate-800">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-600">
                      <th className="text-left py-2 px-2">자재</th>
                      <th className="text-right py-2 px-2">남은 생산 필요량</th>
                      <th className="text-right py-2 px-2">현재고</th>
                      <th className="text-right py-2 px-2">이 요청 배정량</th>
                      <th className="text-right py-2 px-2">전체 배정량</th>
                      <th className="text-right py-2 px-2">사용 가능량</th>
                      <th className="text-right py-2 px-2">부족량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      {
                        key: "parbake",
                        title: "파베이크",
                        rows: lineMats.filter(
                          (m) => m.material_category === "raw_material" && isParbakeMaterialName(m.material_name),
                        ),
                      },
                      {
                        key: "raw",
                        title: "원재료",
                        rows: lineMats.filter(
                          (m) => m.material_category === "raw_material" && !isParbakeMaterialName(m.material_name),
                        ),
                      },
                      {
                        key: "packaging",
                        title: "부자재",
                        rows: lineMats.filter((m) => m.material_category === "packaging_material"),
                      },
                    ].map((group) => (
                      <Fragment key={`${line.id}:${group.key}`}>
                        {group.rows.length > 0 && (
                          <tr className="border-b border-slate-200 bg-slate-50">
                            <td colSpan={7} className="py-1.5 px-2 text-xs font-semibold text-slate-700">
                              {group.title}
                            </td>
                          </tr>
                        )}
                        {group.rows.map((m) => {
                          const rem = Number(line.remaining_qty);
                          const need = rem * Number(m.bom_qty_per_unit);
                          const mk = materialKey(m.material_category, m.material_id);
                          const stock = stockByKey.get(mk) ?? 0;
                          const totalR = totalReservedByKey.get(mk) ?? 0;
                          const lineR =
                            reservations.find(
                              (r) =>
                                r.request_line_id === line.id &&
                                r.material_category === m.material_category &&
                                r.material_id === m.material_id,
                            )?.reserved_qty ?? 0;
                          const d = computeLineMaterialDisplay({
                            need,
                            stock,
                            totalReserved: totalR,
                            lineReserved: lineR,
                          });
                          return (
                            <tr key={m.id} className="border-b border-slate-100">
                              <td className="py-2 px-2 text-slate-900">
                                {(() => {
                                  const displayUnit = group.key === "raw" ? "g" : m.unit;
                                  return (
                                    <>
                                {m.material_name}{" "}
                                      <span className="text-slate-500">({displayUnit})</span>
                                    </>
                                  );
                                })()}
                              </td>
                              <td className="py-2 px-2 text-right tabular-nums">{need.toLocaleString("ko-KR")}</td>
                              <td className="py-2 px-2 text-right tabular-nums">{stock.toLocaleString("ko-KR")}</td>
                              <td className="py-2 px-2 text-right tabular-nums">{lineR.toLocaleString("ko-KR")}</td>
                              <td className="py-2 px-2 text-right tabular-nums">{totalR.toLocaleString("ko-KR")}</td>
                              <td className="py-2 px-2 text-right tabular-nums">
                                {d.availableGlobal.toLocaleString("ko-KR")}
                              </td>
                              <td className="py-2 px-2 text-right tabular-nums text-amber-800">
                                {d.shortage > 0 ? d.shortage.toLocaleString("ko-KR") : "-"}
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-500">
                스냅샷: 요청 시점 BOM 기준(bom_qty_per_unit). 가용 = 현재고 − 전체 예약. 부족은 이 라인 필요 대비
                타 예약을 뺀 가용으로 판단.
              </p>
            </section>
          );
        })}

        {["completed", "settled"].includes(header.status) && (
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">실제 총 사용량 합계 (생산입고 누적)</h2>
            {actualUsageRows.length === 0 ? (
              <p className="text-sm text-slate-500">집계할 생산입고 사용내역이 없습니다.</p>
            ) : (
              <div className="space-y-5">
                {[
                  { key: "parbake", title: "파베이크", rows: actualUsageRows.filter((r) => r.material_category === "raw_material" && isParbakeMaterialName(r.material_name)) },
                  { key: "raw", title: "원재료", rows: actualUsageRows.filter((r) => r.material_category === "raw_material" && !isParbakeMaterialName(r.material_name)) },
                  { key: "packaging", title: "부자재", rows: actualUsageRows.filter((r) => r.material_category === "packaging_material") },
                ].map((group) => {
                  const rows = group.rows;
                  if (rows.length === 0) return null;
                  const displayUnit = group.key === "raw" ? "g" : "EA";
                  return (
                    <div key={group.key} className="rounded-lg border border-slate-200 overflow-hidden">
                      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-800">{group.title}</div>
                      <table className="w-full text-sm text-slate-800">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-600">
                            <th className="px-3 py-2 text-left">소모품목명</th>
                            <th className="px-3 py-2 text-right">실제 사용량 합계</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={`${group.key}:${r.material_name}:${r.unit}`} className="border-b border-slate-100">
                              <td className="px-3 py-2">{r.material_name}</td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {r.usage_total.toLocaleString("ko-KR", { maximumFractionDigits: 3 })} {displayUnit}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
