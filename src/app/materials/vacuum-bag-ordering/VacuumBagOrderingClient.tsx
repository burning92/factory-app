"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Package, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { DEFAULT_VACUUM_BAG_WEEKS, VACUUM_BAG_WEEK_OPTIONS } from "@/features/materials/vacuum-bag-ordering/calculations";
import type { VacuumBagMovementType, VacuumBagSummaryData } from "@/features/materials/vacuum-bag-ordering/types";

type ApiResponse = { ok?: boolean; data?: VacuumBagSummaryData; error?: string; message?: string };

const MOVEMENT_LABEL: Record<string, string> = {
  stock_set: "재고 맞추기",
  receipt: "입고",
  usage: "사용 (이전)",
};

function fmtNum(value: number): string {
  return Number(value || 0).toLocaleString("ko-KR", { maximumFractionDigits: 0 });
}

function todayIsoLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function VacuumBagOrderingClient() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const canView = profile?.role === "admin" || profile?.role === "manager" || profile?.role === "headquarters";

  const [weeks, setWeeks] = useState<number>(DEFAULT_VACUUM_BAG_WEEKS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<VacuumBagSummaryData | null>(null);

  const [formKind, setFormKind] = useState("");
  const [formType, setFormType] = useState<VacuumBagMovementType>("receipt");
  const [formQty, setFormQty] = useState("");
  const [formDate, setFormDate] = useState(todayIsoLocal());
  const [formMemo, setFormMemo] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!canView) router.replace("/materials");
  }, [authLoading, canView, router]);

  const loadSummary = useCallback(async () => {
    if (authLoading || !canView) return;
    setLoading(true);
    setError(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setLoading(false);
      setError("로그인 세션이 없습니다.");
      return;
    }
    const qs = new URLSearchParams({ weeks: String(weeks), version: "master" });
    const res = await fetch(`/api/materials/vacuum-bag-ordering/summary?${qs.toString()}`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "x-refresh-token": session.refresh_token ?? "",
      },
    });
    const json = (await res.json()) as ApiResponse;
    setLoading(false);
    if (!res.ok || !json.ok || !json.data) {
      setError(json.message ?? json.error ?? "진공봉투 전망을 불러오지 못했습니다.");
      return;
    }
    setSummary(json.data);
  }, [authLoading, canView, weeks]);

  useEffect(() => {
    if (summary?.kinds[0] && !formKind) setFormKind(summary.kinds[0].kind_key);
  }, [summary, formKind]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const shortageCount = useMemo(
    () => summary?.forecast_rows.filter((r) => r.is_shortage).length ?? 0,
    [summary]
  );

  const kindLabelByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const k of summary?.kinds ?? []) map.set(k.kind_key, k.label);
    return map;
  }, [summary?.kinds]);

  const needsSetup = useMemo(() => {
    if (!summary) return false;
    const allZero = summary.forecast_rows.every((r) => r.current_qty === 0);
    const noHistory = summary.recent_movements.length === 0;
    return allZero && noHistory;
  }, [summary]);

  const submitMovement = async () => {
    if (!formKind) return alert("봉투 종류를 선택해 주세요.");
    const qty = Number(formQty);
    if (!Number.isFinite(qty) || qty <= 0) return alert("수량을 입력해 주세요.");

    setSaving(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setSaving(false);
      return alert("로그인 세션이 없습니다.");
    }
    const res = await fetch("/api/materials/vacuum-bag-ordering/movements", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        "x-refresh-token": session.refresh_token ?? "",
      },
      body: JSON.stringify({
        kind_key: formKind,
        movement_type: formType,
        qty,
        movement_date: formDate,
        memo: formMemo.trim() || undefined,
      }),
    });
    const json = (await res.json()) as ApiResponse & { current_qty?: number };
    setSaving(false);
    if (!res.ok || !json.ok) {
      alert(json.message ?? json.error ?? "저장에 실패했습니다.");
      return;
    }
    setFormQty("");
    setFormMemo("");
    await loadSummary();
  };

  if (authLoading) return <div className="p-6 text-sm text-slate-300">권한 확인 중...</div>;
  if (!canView) return null;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      <div>
        <Link href="/materials" className="text-xs text-slate-500 hover:text-slate-300">
          ← 원부자재
        </Link>
        <h1 className="text-lg font-semibold text-slate-100 mt-1">진공봉투 발주 판단</h1>
        <p className="text-sm text-slate-400 mt-1">
          생산계획 일자에 맞춰 사용량은 자동 차감됩니다. 입고·재고 맞추기만 입력하면 됩니다.
        </p>
      </div>

      {needsSetup ? (
        <div className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-3 space-y-2">
          <p className="text-sm font-semibold text-cyan-100">처음 사용 — 재고부터 맞추세요</p>
          <ol className="text-xs text-slate-300 space-y-1 list-decimal list-inside">
            <li>
              아래 <strong className="text-cyan-200">재고 맞추기</strong>로 피자·미니 봉투 지금 수량 입력
            </li>
            <li>
              위 <strong className="text-cyan-200">3주 전망</strong>에서 예상 잔량 확인 (마이너스면 주문)
            </li>
            <li>
              이후 들어오면 <strong className="text-cyan-200">입고</strong>, 숫자 안 맞으면 재고 맞추기로 보정
            </li>
          </ol>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 px-4 py-2.5 text-xs text-slate-400">
          <span className="text-slate-300">자동:</span> 마지막 재고 맞추기 이후 생산계획(지난 일자)만큼 차감 ·{" "}
          <span className="text-slate-300">수동:</span> 입고 / 재고 맞추기
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400">전망 기간</span>
        {VACUUM_BAG_WEEK_OPTIONS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setWeeks(w)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              weeks === w
                ? "border-cyan-500 bg-cyan-500/20 text-cyan-100"
                : "border-slate-600 bg-slate-800/50 text-slate-300 hover:bg-slate-700/50"
            }`}
          >
            {w}주{w === DEFAULT_VACUUM_BAG_WEEKS ? " (기본)" : ""}
          </button>
        ))}
        <button
          type="button"
          onClick={() => loadSummary()}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-600 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700/50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          새로고침
        </button>
      </div>

      {summary && (
        <p className="text-xs text-slate-500">
          기준일 {summary.today_iso} · 전망 {summary.range_start} ~ {summary.range_end} ({summary.weeks}주)
        </p>
      )}

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>
      )}

      {summary && (
        <div
          className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${
            shortageCount > 0 ? "border-amber-500/50 bg-amber-500/10" : "border-emerald-500/40 bg-emerald-500/10"
          }`}
        >
          {shortageCount > 0 ? (
            <AlertTriangle className="h-5 w-5 text-amber-300 shrink-0" />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-emerald-300 shrink-0" />
          )}
          <div>
            <p className={`text-sm font-semibold ${shortageCount > 0 ? "text-amber-100" : "text-emerald-100"}`}>
              {shortageCount > 0 ? `${shortageCount}종 부족 예상 — 주문 검토 필요` : `${summary.weeks}주 계획 기준 재고 충분`}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              현재고 = 재고맞추기 + 입고 − 계획자동차감 · 예상 잔량 = 현재고 − {summary?.weeks}주 필요량
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {(summary?.forecast_rows ?? []).map((row) => (
          <div
            key={row.kind_key}
            className={`rounded-xl border p-4 ${
              row.is_shortage ? "border-rose-500/50 bg-rose-500/5" : "border-slate-700/60 bg-slate-800/40"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-cyan-400/80" />
                <h2 className="font-semibold text-slate-100">{row.label}</h2>
              </div>
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded ${
                  row.is_shortage ? "bg-rose-500/20 text-rose-200" : "bg-emerald-500/20 text-emerald-200"
                }`}
              >
                {row.is_shortage ? `부족 ${fmtNum(row.shortage_qty)}` : "충분"}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <div>
                <dt className="text-slate-500 text-xs">현재고</dt>
                <dd className="font-medium text-slate-100">{fmtNum(row.current_qty)}</dd>
              </div>
              <div>
                <dt className="text-slate-500 text-xs">계획 자동차감</dt>
                <dd className="font-medium text-slate-300">−{fmtNum(row.auto_used_qty)}</dd>
              </div>
              <div>
                <dt className="text-slate-500 text-xs">{summary?.weeks}주 필요량</dt>
                <dd className="font-medium text-slate-100">{fmtNum(row.required_qty)}</dd>
              </div>
              <div>
                <dt className="text-slate-500 text-xs">입고(맞춘 이후)</dt>
                <dd className="font-medium text-slate-300">+{fmtNum(row.receipt_qty)}</dd>
              </div>
              <div className="col-span-2 pt-1 border-t border-slate-700/50">
                <dt className="text-slate-500 text-xs">예상 잔량</dt>
                <dd className={`text-lg font-bold ${row.is_shortage ? "text-rose-300" : "text-cyan-200"}`}>
                  {row.projected_qty < 0 ? `−${fmtNum(row.shortage_qty)}` : fmtNum(row.projected_qty)}
                </dd>
              </div>
            </dl>
          </div>
        ))}
      </div>

      {summary && summary.excluded_plan_qty > 0 && (
        <p className="text-xs text-slate-500">
          브레드·보관용 파베이크 등 봉투 미사용 계획 {fmtNum(summary.excluded_plan_qty)}개는 집계에서 제외했습니다.
        </p>
      )}

      <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-200">재고 입력</h3>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { type: "receipt" as const, label: "입고", hint: "들어온 만큼" },
              { type: "stock_set" as const, label: "재고 맞추기", hint: "숫자 보정" },
            ] as const
          ).map(({ type, label, hint }) => (
            <button
              key={type}
              type="button"
              onClick={() => setFormType(type)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                formType === type
                  ? "border-cyan-500 bg-cyan-500/20 text-cyan-100"
                  : "border-slate-600 bg-slate-900/50 text-slate-300 hover:bg-slate-700/40"
              }`}
            >
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-[10px] opacity-70">{hint}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-slate-400">
            봉투 종류
            <select
              value={formKind}
              onChange={(e) => setFormKind(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            >
              {(summary?.kinds ?? []).map((k) => (
                <option key={k.kind_key} value={k.kind_key}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-slate-400">
            수량
            <input
              type="number"
              min={1}
              step={1}
              value={formQty}
              onChange={(e) => setFormQty(e.target.value)}
              placeholder={formType === "receipt" ? "입고 수량" : "지금 맞출 재고 수량"}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            />
          </label>
          <label className="block text-xs text-slate-400">
            일자
            <input
              type="date"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            />
          </label>
          <label className="block text-xs text-slate-400">
            메모 (선택)
            <input
              type="text"
              value={formMemo}
              onChange={(e) => setFormMemo(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={submitMovement}
          disabled={saving}
          className="rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>

      {summary && summary.recent_movements.length > 0 && (
        <div className="rounded-xl border border-slate-700/60 overflow-hidden">
          <h3 className="text-sm font-semibold text-slate-200 px-4 py-3 border-b border-slate-700/60">최근 이력</h3>
          <ul className="divide-y divide-slate-700/40 max-h-64 overflow-y-auto">
            {summary.recent_movements.map((m) => (
              <li key={m.id} className="px-4 py-2.5 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-slate-500 text-xs">{m.movement_date}</span>
                <span className="font-medium text-slate-200">{kindLabelByKey.get(m.kind_key) ?? m.kind_key}</span>
                <span className="text-xs rounded bg-slate-700/60 px-1.5 py-0.5 text-slate-300">
                  {MOVEMENT_LABEL[m.movement_type] ?? m.movement_type}
                </span>
                <span className="text-slate-100">{fmtNum(m.qty)}</span>
                {m.memo && <span className="text-xs text-slate-500 truncate">{m.memo}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading && !summary && <p className="text-sm text-slate-400">불러오는 중…</p>}
    </div>
  );
}
