"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  STATUS_LABEL,
  canManageHqHarangProductionRequests,
  type HarangProductionRequestStatus,
} from "@/features/harang/productionRequests";
import { displayHarangProductName } from "@/features/harang/displayProductName";

type RequestRow = {
  id: string;
  request_no: string;
  request_date: string;
  due_date: string;
  priority: number;
  status: HarangProductionRequestStatus;
  note: string | null;
};

type LineRow = {
  id: string;
  header_id: string;
  product_name: string;
  requested_qty: number;
  produced_qty: number;
  remaining_qty: number;
  material_shortage_flag: boolean;
};

export default function HarangProductionRequestsPage() {
  const { organization, profile } = useAuth();
  const canRegister = canManageHqHarangProductionRequests(organization?.organization_code, profile?.role);
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [lineMap, setLineMap] = useState<Map<string, LineRow[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showClosedStatuses, setShowClosedStatuses] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("harang_production_requests")
      .select("id, request_no, request_date, due_date, priority, status, note")
      .order("request_date", { ascending: false })
      .order("request_no", { ascending: false });

    if (!showClosedStatuses) {
      q = q.in("status", ["pending", "shortage", "in_progress"]);
    }

    const res = await q;
    setLoading(false);
    if (res.error) return alert(res.error.message);
    const nextRows = (res.data ?? []) as RequestRow[];
    setRows(nextRows);

    if (nextRows.length === 0) {
      setLineMap(new Map());
      return;
    }

    const ids = nextRows.map((r) => r.id);
    const lineRes = await supabase
      .from("harang_production_request_lines")
      .select("id, header_id, product_name, requested_qty, produced_qty, remaining_qty, material_shortage_flag")
      .in("header_id", ids)
      .order("sort_order", { ascending: true });
    if (lineRes.error) return alert(lineRes.error.message);
    const byHeader = new Map<string, LineRow[]>();
    for (const line of (lineRes.data ?? []) as LineRow[]) {
      const arr = byHeader.get(line.header_id) ?? [];
      arr.push(line);
      byHeader.set(line.header_id, arr);
    }
    setLineMap(byHeader);
  }, [showClosedStatuses]);

  useEffect(() => {
    void load();
  }, [load]);

  const quickEdit = async (row: RequestRow) => {
    const dueDate = prompt("납기일(YYYY-MM-DD)", row.due_date);
    if (!dueDate) return;
    const priorityRaw = prompt("우선순위", String(row.priority));
    if (!priorityRaw) return;
    const noteRaw = prompt("비고", row.note ?? "");
    if (noteRaw == null) return;
    const priority = Number(priorityRaw);
    if (!Number.isFinite(priority)) {
      alert("우선순위는 숫자로 입력하세요.");
      return;
    }
    setBusyId(row.id);
    const { error } = await supabase.rpc("update_harang_production_request_header", {
      p_header_id: row.id,
      p_due_date: dueDate,
      p_priority: priority,
      p_note: noteRaw.trim() || null,
    });
    setBusyId(null);
    if (error) {
      alert(error.message);
      return;
    }
    await load();
  };

  const quickDelete = async (row: RequestRow) => {
    if (!confirm("이 요청을 완전 삭제할까요?")) return;
    setBusyId(row.id);
    const { error } = await supabase.rpc("delete_harang_production_request", { p_header_id: row.id });
    setBusyId(null);
    if (error) {
      alert(error.message);
      return;
    }
    await load();
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">생산요청</h1>
            <p className="text-sm text-slate-600 mt-1">
              본사 등록 · 하랑 생산 반영 · 잔여·예약·부족 기준 (
              {canRegister ? "등록 가능(본사 매니저·관리자)" : "조회·반영(역할에 따라)"})
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={showClosedStatuses}
                onChange={(e) => setShowClosedStatuses(e.target.checked)}
              />
              종료 상태 포함
            </label>
            {canRegister && (
              <Link
                href="/harang/production-requests/new"
                className="px-3 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700"
              >
                요청 등록
              </Link>
            )}
            <Link
              href="/harang/production-requests/dashboard"
              className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm bg-white"
            >
              소요·부족
            </Link>
          </div>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm text-slate-800">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="px-3 py-2 text-left">요청번호</th>
                  <th className="px-3 py-2 text-left">요청일</th>
                  <th className="px-3 py-2 text-left">납기</th>
                  <th className="px-3 py-2 text-left">제품·수량</th>
                  <th className="px-3 py-2 text-right">잔여합</th>
                  <th className="px-3 py-2 text-center">부족</th>
                  <th className="px-3 py-2 text-right">우선</th>
                  <th className="px-3 py-2 text-left">상태</th>
                  <th className="px-3 py-2 text-left">작업</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                      불러오는 중...
                    </td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                      요청이 없습니다.
                    </td>
                  </tr>
                )}
                {!loading &&
                  rows.map((r) => {
                    const lines = lineMap.get(r.id) ?? [];
                    const requestedSum = lines.reduce((a, l) => a + Number(l.requested_qty), 0);
                    const producedSum = lines.reduce((a, l) => a + Number(l.produced_qty), 0);
                    const remainSum = lines.reduce((a, l) => a + Number(l.remaining_qty), 0);
                    const anyShort = lines.some((l) => l.material_shortage_flag && Number(l.remaining_qty) > 0);
                    const titleSummary =
                      lines.length === 0
                        ? ""
                        : lines
                            .map(
                              (l) =>
                                `${displayHarangProductName(l.product_name)} 요청 ${Number(l.requested_qty).toLocaleString("ko-KR")}`,
                            )
                            .join(" · ");
                    return (
                      <tr key={r.id} className="border-b border-slate-100 [&>td]:align-top">
                        <td className="px-3 py-2 font-mono text-xs">{r.request_no}</td>
                        <td className="px-3 py-2">{r.request_date}</td>
                        <td className="px-3 py-2">{r.due_date}</td>
                        <td className="px-3 py-2 min-w-[220px] max-w-[340px]" title={titleSummary || undefined}>
                          {lines.length === 0 ? (
                            "-"
                          ) : (
                            <div className="space-y-2">
                              {lines.map((l) => (
                                <div key={l.id} className="space-y-0.5">
                                  <div className="font-semibold text-slate-900 leading-snug break-words">
                                    {displayHarangProductName(l.product_name)}
                                  </div>
                                  <div className="text-base font-bold tabular-nums text-cyan-900">
                                    요청 {Number(l.requested_qty).toLocaleString("ko-KR")}
                                  </div>
                                </div>
                              ))}
                              <div
                                className={
                                  lines.length > 1
                                    ? "pt-1.5 mt-0.5 border-t border-slate-100 text-[11px] text-slate-500"
                                    : "text-[11px] text-slate-500"
                                }
                              >
                                {lines.length > 1 ? (
                                  <>
                                    합계 요청 {requestedSum.toLocaleString("ko-KR")} · 완료 {producedSum.toLocaleString("ko-KR")} ·
                                    잔여 {remainSum.toLocaleString("ko-KR")}
                                  </>
                                ) : (
                                  <>
                                    완료 {producedSum.toLocaleString("ko-KR")} · 잔여 {remainSum.toLocaleString("ko-KR")}
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{remainSum.toLocaleString("ko-KR")}</td>
                        <td className="px-3 py-2 text-center">{anyShort ? "Y" : "-"}</td>
                        <td className="px-3 py-2 text-right">{r.priority}</td>
                        <td className="px-3 py-2">{STATUS_LABEL[r.status] ?? r.status}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/harang/production-requests/${r.id}`}
                              className="text-cyan-700 hover:underline text-xs font-medium"
                            >
                              보기
                            </Link>
                            {canRegister && !["cancelled"].includes(r.status) && (
                              <button
                                type="button"
                                disabled={busyId === r.id}
                                onClick={() => void quickEdit(r)}
                                className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 bg-white disabled:opacity-50"
                              >
                                수정
                              </button>
                            )}
                            {canRegister && (
                              <button
                                type="button"
                                disabled={busyId === r.id}
                                onClick={() => void quickDelete(r)}
                                className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 bg-white disabled:opacity-50"
                              >
                                삭제
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
