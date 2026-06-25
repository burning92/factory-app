"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, RefreshCw, Wrench } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

type MismatchRow = {
  production_header_id: string;
  production_date: string;
  production_no: string;
  material_name: string;
  lot_date: string;
  ledger_qty: number;
  line_lot_qty: number;
  issue_type: string;
};

type RevertRow = {
  session_id: string;
  product_name: string;
  adjustment_date: string;
};

const ISSUE_LABEL: Record<string, string> = {
  phantom_line_lot: "유령 LOT (원장 없음)",
  missing_line_lot: "line_lots 누락",
  missing_line: "line_lots 누락",
  qty_mismatch: "수량 불일치 (단일 생산)",
  pool_imbalance: "풀 합계 불일치 (동일일 복수 생산)",
};

function formatYmdDot(iso: string): string {
  return iso ? iso.slice(0, 10).replaceAll("-", ".") : "";
}

export default function HarangInventoryRepairPage() {
  const { profile } = useAuth();
  const [mismatches, setMismatches] = useState<MismatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const loadMismatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("harang_list_production_ledger_line_lot_mismatches");
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      setMismatches([]);
      return;
    }
    setMismatches((data ?? []) as MismatchRow[]);
  }, []);

  useEffect(() => {
    if (profile?.role === "admin") void loadMismatches();
  }, [profile?.role, loadMismatches]);

  const runRevertAll = async () => {
    if (
      !confirm(
        "확정된 생산 사이클 재고조정을 모두 되돌립니다.\n원장 조정분·생산 usage_qty 변경이 복구됩니다.\n계속할까요?",
      )
    ) {
      return;
    }
    setBusy("revert");
    setLastResult(null);
    const { data, error: rpcError } = await supabase.rpc("revert_all_harang_stock_cycle_adjustments");
    setBusy(null);
    if (rpcError) {
      alert(rpcError.message);
      return;
    }
    const rows = (data ?? []) as RevertRow[];
    setLastResult(`재고조정 ${rows.length}건 되돌림 완료`);
    void loadMismatches();
  };

  const runCleanupOrphans = async () => {
    if (
      !confirm(
        "되돌린 뒤에도 남은 SA- 조정 원장(인코딩 오류 등)을 제거하고 LOT 현재고를 원장 합산으로 맞춥니다.\n① 재고조정 되돌리기 후에 실행하세요.\n계속할까요?",
      )
    ) {
      return;
    }
    setBusy("cleanup");
    setLastResult(null);
    const { data, error: rpcError } = await supabase.rpc("cleanup_harang_orphaned_adjustment_transactions");
    if (rpcError) {
      setBusy(null);
      alert(rpcError.message);
      return;
    }
    const orphanPayload = data as Record<string, unknown> | null;
    const { data: syncData, error: syncError } = await supabase.rpc("harang_sync_inventory_lots_from_ledger");
    setBusy(null);
    if (syncError) {
      alert(syncError.message);
      return;
    }
    const syncPayload = syncData as Record<string, unknown> | null;
    setLastResult(
      `유령 조정 원장 ${String(orphanPayload?.transactions_removed ?? 0)}건 제거, LOT ${String(syncPayload?.lots_updated ?? 0)}건 동기화`,
    );
    void loadMismatches();
  };

  const runReconcile = async () => {
    if (
      !confirm(
        "생산입고 line_lots를 원장(소비기한 LOT) 기준으로 다시 연결합니다.\n유령 LOT·과대 usage_qty가 정리됩니다.\n계속할까요?",
      )
    ) {
      return;
    }
    setBusy("reconcile");
    setLastResult(null);
    const { data, error: rpcError } = await supabase.rpc("harang_reconcile_production_lots_from_ledger");
    setBusy(null);
    if (rpcError) {
      alert(rpcError.message);
      return;
    }
    const payload = data as Record<string, unknown> | null;
    setLastResult(
      `정합 완료 — 라인 ${String(payload?.lines_updated ?? 0)}건, line_lots 삽입 ${String(payload?.line_lots_inserted ?? 0)}건`,
    );
    void loadMismatches();
  };

  if (profile?.role !== "admin") {
    return <div className="px-6 py-10 text-slate-600">관리자만 접근할 수 있습니다.</div>;
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 text-slate-900">
      <div className="max-w-6xl mx-auto">
        <Link
          href="/harang/admin"
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          하랑 마스터 관리
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">재고 데이터 정합 (작업 1)</h1>
            <p className="mt-1 text-sm text-slate-600">
              재고조정 되돌리기 → 생산입고를 원장(소비기한 LOT)에 재연결합니다. 입고·사용·재고·상세보기가
              맞춰진 뒤 작업 2(기준일 재고)·작업 3(재고조정)을 진행합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadMismatches()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            불일치 목록 새로고침
          </button>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>
            순서: <strong>① 재고조정 전부 되돌리기</strong> →{" "}
            <strong>② 유령 조정 원장 정리</strong> (마이그레이션{" "}
            <code className="text-amber-950">20260623230000</code> 적용 후) →{" "}
            <strong>③ 원장 기준 LOT 재연결</strong>.
          </p>
        </div>

        {lastResult ? (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            {lastResult}
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void runRevertAll()}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            <Wrench className="w-4 h-4" />
            {busy === "revert" ? "처리 중…" : "1. 재고조정 전부 되돌리기"}
          </button>
          <button
            type="button"
            onClick={() => void runCleanupOrphans()}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
          >
            <Wrench className="w-4 h-4" />
            {busy === "cleanup" ? "처리 중…" : "2. 유령 조정 원장 정리"}
          </button>
          <button
            type="button"
            onClick={() => void runReconcile()}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-60"
          >
            <Wrench className="w-4 h-4" />
            {busy === "reconcile" ? "처리 중…" : "3. 원장 기준 LOT 재연결"}
          </button>
        </div>

        {error ? (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <section className="mt-8 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
            <h2 className="text-sm font-semibold text-slate-800">
              원장 ↔ 생산입고 line_lots 불일치 ({mismatches.length}건)
            </h2>
            <p className="text-xs text-slate-700 mt-0.5">소비기한(lot_date) 단위. 정합 후 0건이 목표입니다.</p>
          </div>
          {loading ? (
            <p className="px-4 py-8 text-center text-slate-500 text-sm">불러오는 중…</p>
          ) : mismatches.length === 0 ? (
            <p className="px-4 py-8 text-center text-slate-500 text-sm">불일치 없음 (또는 마이그레이션 미적용)</p>
          ) : (
            <div className="overflow-x-auto bg-white">
              <table className="min-w-full text-sm text-slate-900">
                <thead className="bg-slate-100 text-slate-800 border-b-2 border-slate-300">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">생산일</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">No.</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">품목</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">소비기한 LOT</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">원장</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">line_lots</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">유형</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {mismatches.slice(0, 200).map((row, i) => {
                    const isPhantom = row.issue_type === "phantom_line_lot";
                    const isMismatch = row.issue_type === "qty_mismatch";
                    return (
                    <tr
                      key={`${row.production_header_id}-${row.lot_date}-${i}`}
                      className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}
                    >
                      <td className="px-3 py-2.5 tabular-nums text-slate-900 font-medium">{row.production_date}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-800">{row.production_no}</td>
                      <td className="px-3 py-2.5 text-slate-900 font-medium">{row.material_name}</td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-900">{formatYmdDot(row.lot_date)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-900 font-medium">
                        {Number(row.ledger_qty).toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-900 font-medium">
                        {Number(row.line_lot_qty).toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
                            isPhantom
                              ? "bg-red-100 text-red-900"
                              : isMismatch
                                ? "bg-amber-100 text-amber-950"
                                : "bg-slate-200 text-slate-900"
                          }`}
                        >
                          {ISSUE_LABEL[row.issue_type] ?? row.issue_type}
                        </span>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              {mismatches.length > 200 ? (
                <p className="px-4 py-3 text-sm text-slate-700 font-medium">… 외 {mismatches.length - 200}건</p>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
