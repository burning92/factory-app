"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
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

type LotLedgerMismatch = {
  category: string;
  item_id: string;
  item_name: string;
  lot_id: string;
  lot_date: string;
  initial_quantity: number;
  current_quantity: number;
  ledger_sum: number;
  diff: number;
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
  const [lotMismatches, setLotMismatches] = useState<LotLedgerMismatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [showLegacyTools, setShowLegacyTools] = useState(false);

  const loadMismatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [prodRes, lotRes] = await Promise.all([
      supabase.rpc("harang_list_production_ledger_line_lot_mismatches"),
      supabase.rpc("harang_list_lot_current_vs_ledger_mismatches"),
    ]);
    setLoading(false);
    if (prodRes.error) {
      setError(prodRes.error.message);
      setMismatches([]);
      setLotMismatches([]);
      return;
    }
    setMismatches((prodRes.data ?? []) as MismatchRow[]);
    setLotMismatches(lotRes.error ? [] : ((lotRes.data ?? []) as LotLedgerMismatch[]));
    if (lotRes.error && !prodRes.error) {
      setError(`생산 불일치는 조회됨. LOT 캐시 불일치 RPC 미적용: ${lotRes.error.message}`);
    }
  }, []);

  useEffect(() => {
    if (profile?.role === "admin") void loadMismatches();
  }, [profile?.role, loadMismatches]);

  const runRevertAll = async () => {
    if (
      !confirm(
        "[위험 · 레거시] 확정된 생산 사이클 재고조정을 모두 되돌립니다.\n원장 조정분·생산 usage_qty 변경이 복구됩니다.\n계속할까요?",
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
    const rows = (data ?? []) as Array<{ session_id: string }>;
    setLastResult(`재고조정 ${rows.length}건 되돌림 완료`);
    void loadMismatches();
  };

  const runCleanupOrphans = async () => {
    if (
      !confirm(
        "[위험 · 레거시] SA- 조정 원장을 제거하고 LOT current를 전체 sync합니다.\n신규 운영에서는 사용하지 마세요.\n계속할까요?",
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
        "[위험 · 레거시] line_lots를 원장 기준으로 재구성합니다.\nproduction line_lots/usage_qty를 수정합니다.\n신규 정합 구조와 상충할 수 있습니다.\n계속할까요?",
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

  const negativeLedgerLots = lotMismatches.filter((r) => Number(r.ledger_sum) < -0.0005);

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
            <h1 className="text-2xl font-semibold text-slate-900">재고 정합 진단</h1>
            <p className="mt-1 text-sm text-slate-600">
              읽기 전용 불일치 리포트입니다. 신규 생산은 원장 정본 + 저장 시 검증으로 보호됩니다.
              데이터 복구는 별도 승인·dry-run 후에만 진행하세요.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadMismatches()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            진단 새로고침
          </button>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-950">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>
            <strong>신규 운영 원칙:</strong> 재고 정본 = <code>harang_inventory_transactions</code>.
            생산 저장 시 line_lots와 usage 원장이 1:1로 생성·검증됩니다.
            아래 레거시 복구 도구는 기존 꼬인 데이터 전용이며 기본 숨김입니다.
          </p>
        </div>

        {lastResult ? (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            {lastResult}
          </div>
        ) : null}

        <section className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
            <h2 className="text-sm font-semibold text-slate-800">
              LOT 캐시 vs 원장 불일치 ({lotMismatches.length}건)
            </h2>
          </div>
          {loading ? (
            <p className="px-4 py-6 text-center text-slate-500 text-sm">불러오는 중…</p>
          ) : lotMismatches.length === 0 ? (
            <p className="px-4 py-6 text-center text-slate-500 text-sm">불일치 없음 (또는 마이그레이션 미적용)</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 border-b border-slate-300">
                  <tr>
                    <th className="px-3 py-2 text-left">품목</th>
                    <th className="px-3 py-2 text-left">LOT</th>
                    <th className="px-3 py-2 text-right">캐시</th>
                    <th className="px-3 py-2 text-right">원장</th>
                    <th className="px-3 py-2 text-right">차이</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {lotMismatches.slice(0, 50).map((row) => (
                    <tr key={row.lot_id} className={Number(row.ledger_sum) < 0 ? "bg-red-50" : undefined}>
                      <td className="px-3 py-2">{row.item_name}</td>
                      <td className="px-3 py-2 tabular-nums">{formatYmdDot(row.lot_date)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(row.current_quantity).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(row.ledger_sum).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(row.diff).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {negativeLedgerLots.length > 0 ? (
            <p className="px-4 py-3 text-sm text-red-800 font-medium">
              원장 음수 LOT {negativeLedgerLots.length}건 — 백필/전체 sync 없이 원인 분석 필요
            </p>
          ) : null}
        </section>

        <section className="mt-8 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
            <h2 className="text-sm font-semibold text-slate-800">
              생산 ↔ 원장 line_lots 불일치 ({mismatches.length}건)
            </h2>
          </div>
          {loading ? (
            <p className="px-4 py-8 text-center text-slate-500 text-sm">불러오는 중…</p>
          ) : mismatches.length === 0 ? (
            <p className="px-4 py-8 text-center text-slate-500 text-sm">불일치 없음</p>
          ) : (
            <div className="overflow-x-auto bg-white">
              <table className="min-w-full text-sm text-slate-900">
                <thead className="bg-slate-100 text-slate-800 border-b-2 border-slate-300">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold">생산일</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold">No.</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold">품목</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold">LOT</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold">원장</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold">line_lots</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold">유형</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {mismatches.slice(0, 200).map((row, i) => (
                    <tr key={`${row.production_header_id}-${row.lot_date}-${i}`} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                      <td className="px-3 py-2.5 tabular-nums">{row.production_date}</td>
                      <td className="px-3 py-2.5 font-mono text-xs">{row.production_no}</td>
                      <td className="px-3 py-2.5">{row.material_name}</td>
                      <td className="px-3 py-2.5 tabular-nums">{formatYmdDot(row.lot_date)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{Number(row.ledger_qty).toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{Number(row.line_lot_qty).toLocaleString()}</td>
                      <td className="px-3 py-2.5">
                        <span className="inline-block rounded px-2 py-0.5 text-xs font-semibold bg-slate-200">
                          {ISSUE_LABEL[row.issue_type] ?? row.issue_type}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="mt-8 rounded-xl border border-red-200 bg-red-50/50 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowLegacyTools((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-semibold text-red-900 hover:bg-red-50"
          >
            <span>⚠ 레거시 복구 도구 (위험 · 기본 숨김)</span>
            {showLegacyTools ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showLegacyTools ? (
            <div className="px-4 pb-4 space-y-3 border-t border-red-200">
              <p className="pt-3 text-xs text-red-800">
                전체 revert / reconcile / sync는 기존 꼬인 데이터 복구용입니다. G03 등 개별 복구 전략 수립 전에는 실행하지 마세요.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void runRevertAll()}
                  disabled={busy !== null}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {busy === "revert" ? "처리 중…" : "재고조정 전부 되돌리기"}
                </button>
                <button
                  type="button"
                  onClick={() => void runCleanupOrphans()}
                  disabled={busy !== null}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
                >
                  {busy === "cleanup" ? "처리 중…" : "유령 조정 + 전체 sync"}
                </button>
                <button
                  type="button"
                  onClick={() => void runReconcile()}
                  disabled={busy !== null}
                  className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {busy === "reconcile" ? "처리 중…" : "원장 기준 line_lots 재연결"}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
