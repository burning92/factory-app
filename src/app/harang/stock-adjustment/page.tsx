"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { displayHarangProductName } from "@/features/harang/displayProductName";
import {
  type StockAdjustmentSessionRow,
  type StockAdjustmentType,
  deleteStockAdjustmentDraft,
  deleteStockAdjustmentDrafts,
} from "@/features/harang/stockAdjustment";
import { supabase } from "@/lib/supabase";
import { isAdminLikeRole } from "@/lib/roles";
import { useAuth } from "@/contexts/AuthContext";

const TYPE_LABEL: Record<StockAdjustmentType, string> = {
  production_cycle: "생산 사이클",
  packaging: "부자재 전체",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "작성중",
  confirmed: "완료",
};

type TabKey = "cycle" | "packaging";

export default function HarangStockAdjustmentListPage() {
  const { profile } = useAuth();
  const isAdmin = isAdminLikeRole(profile?.role);
  const [tab, setTab] = useState<TabKey>("packaging");
  const [rows, setRows] = useState<StockAdjustmentSessionRow[]>([]);
  const [targetCounts, setTargetCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const type = tab === "cycle" ? "production_cycle" : "packaging";
    const { data, error } = await supabase
      .from("harang_stock_adjustment_sessions")
      .select("*")
      .eq("adjustment_type", type)
      .order("adjustment_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) {
      setLoading(false);
      alert(error.message);
      return;
    }
    const sessions = (data ?? []) as StockAdjustmentSessionRow[];
    setRows(sessions);

    const ids = sessions.map((s) => s.id);
    if (ids.length > 0) {
      const { data: targets, error: tErr } = await supabase
        .from("harang_stock_adjustment_production_targets")
        .select("session_id")
        .in("session_id", ids);
      if (tErr) {
        setLoading(false);
        alert(tErr.message);
        return;
      }
      const counts = new Map<string, number>();
      for (const t of targets ?? []) {
        const sid = String(t.session_id);
        counts.set(sid, (counts.get(sid) ?? 0) + 1);
      }
      setTargetCounts(counts);
    } else {
      setTargetCounts(new Map());
    }
    setLoading(false);
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const newHref = tab === "cycle" ? "/harang/stock-adjustment/cycle/new" : "/harang/stock-adjustment/packaging/new";
  const canCreateNew = tab === "packaging" || isAdmin;

  const emptyMessage = useMemo(() => {
    if (tab === "cycle") return "생산 사이클 재고조정 이력이 없습니다.";
    return "부자재 재고조정 이력이 없습니다.";
  }, [tab]);

  const draftRows = useMemo(() => rows.filter((r) => r.status === "draft"), [rows]);

  const handleDeleteDraft = async (row: StockAdjustmentSessionRow) => {
    const label =
      row.adjustment_type === "production_cycle"
        ? `${row.adjustment_date} · ${displayHarangProductName(row.product_name)}`
        : `${row.adjustment_date} · 부자재 전체`;
    const ok = window.confirm(
      `작성중인 조정을 삭제할까요?\n\n${label}\n\n임시 저장 내용이 모두 사라집니다.`,
    );
    if (!ok) return;
    setDeletingId(row.id);
    try {
      await deleteStockAdjustmentDraft(row.id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteAllDrafts = async () => {
    const ok = window.confirm(
      `작성중인 조정 ${draftRows.length}건을 모두 삭제할까요?\n\n임시 저장 내용이 사라지며, 완료된 조정은 삭제되지 않습니다.`,
    );
    if (!ok) return;
    setBulkDeleting(true);
    try {
      await deleteStockAdjustmentDrafts(draftRows.map((r) => r.id));
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 text-slate-900">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">재고조정</h1>
            <p className="text-sm text-slate-600 mt-1">
              부자재 전체 조정 · 생산 사이클 조정(레거시·관리자)
            </p>
          </div>
          {canCreateNew ? (
          <Link
            href={newHref}
            className="px-4 py-2 rounded-lg bg-cyan-500 text-white text-sm font-medium hover:bg-cyan-400"
          >
            + 새 조정
          </Link>
          ) : null}
        </div>

        {draftRows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span>작성중인 조정 {draftRows.length}건이 있습니다.</span>
            {draftRows.length > 1 && (
              <button
                type="button"
                onClick={() => void handleDeleteAllDrafts()}
                disabled={bulkDeleting || deletingId !== null}
                className="px-3 py-1.5 rounded-lg border border-red-300 bg-white text-red-700 text-xs font-medium hover:bg-red-50 disabled:opacity-50"
              >
                {bulkDeleting ? "삭제 중…" : "작성중 전체 삭제"}
              </button>
            )}
          </div>
        )}

        <div className="flex gap-2 border-b border-slate-200">
          {isAdmin ? (
          <button
            type="button"
            onClick={() => setTab("cycle")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === "cycle"
                ? "border-amber-600 text-amber-800"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            생산 사이클 (레거시)
          </button>
          ) : null}
          <button
            type="button"
            onClick={() => setTab("packaging")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === "packaging"
                ? "border-cyan-600 text-cyan-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            부자재
          </button>
        </div>

        {tab === "cycle" ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            생산 사이클 재고조정은 usage_qty·line_lots·원장을 동시에 수정하는 레거시 방식입니다.
            신규 운영에서는 단순 실사조정(2차 개발 예정)을 사용하세요.
          </div>
        ) : null}

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="min-w-full text-sm text-slate-900">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-3">조정일</th>
                <th className="px-4 py-3">유형</th>
                <th className="px-4 py-3">대상</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3 text-right">작업</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    불러오는 중…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const targetLabel =
                    row.adjustment_type === "production_cycle"
                      ? displayHarangProductName(row.product_name)
                      : "부자재 전체";
                  const detailHref =
                    row.status === "draft"
                      ? row.adjustment_type === "production_cycle"
                        ? `/harang/stock-adjustment/cycle/new?draft_id=${row.id}`
                        : `/harang/stock-adjustment/packaging/new?draft_id=${row.id}`
                      : `/harang/stock-adjustment/cycle/${row.id}`;
                  return (
                    <tr key={row.id} className="border-t border-slate-100 text-slate-900 hover:bg-slate-50/80">
                      <td className="px-4 py-3 whitespace-nowrap">{row.adjustment_date}</td>
                      <td className="px-4 py-3">{TYPE_LABEL[row.adjustment_type]}</td>
                      <td className="px-4 py-3">
                        {row.adjustment_type === "production_cycle" ? (
                          <span>{targetLabel || "—"}</span>
                        ) : (
                          <span className="text-slate-600">부자재 전체</span>
                        )}
                        {row.adjustment_type === "production_cycle" && (targetCounts.get(row.id) ?? 0) > 0 && (
                          <span className="ml-2 text-xs text-slate-500">
                            생산입고 {targetCounts.get(row.id)}건
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            row.status === "confirmed"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-amber-50 text-amber-800"
                          }`}
                        >
                          {STATUS_LABEL[row.status] ?? row.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center justify-end gap-3">
                          <Link
                            href={detailHref}
                            className="text-cyan-700 hover:text-cyan-900 text-sm font-medium"
                          >
                            {row.status === "draft" ? "이어쓰기" : "보기"}
                          </Link>
                          {row.status === "draft" && (
                            <button
                              type="button"
                              disabled={deletingId === row.id || bulkDeleting}
                              onClick={() => void handleDeleteDraft(row)}
                              className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50"
                            >
                              {deletingId === row.id ? "삭제 중…" : "삭제"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </section>

        <p className="text-xs text-slate-500">
          생산 사이클: 품목별 생산입고 선택 → 실사 → 분배. 부자재: 전체 통 조정(별도 메뉴).
        </p>
      </div>
    </div>
  );
}
