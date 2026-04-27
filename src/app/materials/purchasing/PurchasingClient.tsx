"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock3, PackageSearch, Siren } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { computePurchasingRows } from "@/features/materials/purchasing/calculations";
import type { PurchasingPeriodKey, PurchasingStatus, PurchasingSummaryData, PurchasingTableRow } from "@/features/materials/purchasing/types";

type ApiResponse = { ok?: boolean; data?: PurchasingSummaryData; error?: string; message?: string };
type PurchasingViewTab = "overall" | "immediate" | "vendor_grouped" | "shortage_forecast";

const PERIOD_OPTIONS: Array<{ key: PurchasingPeriodKey; label: string }> = [
  { key: "d7", label: "D+7" },
  { key: "d14", label: "D+14" },
  { key: "d30", label: "D+30" },
  { key: "month_end", label: "이번달 말" },
  { key: "month_next", label: "이번달+다음달" },
];

const VIEW_TAB_OPTIONS: Array<{ key: PurchasingViewTab; label: string }> = [
  { key: "overall", label: "전체 발주 판단" },
  { key: "immediate", label: "즉시 발주" },
  { key: "vendor_grouped", label: "공급처별 묶음" },
  { key: "shortage_forecast", label: "부족 예측" },
];

const STATUS_LABEL: Record<PurchasingStatus, string> = {
  urgent: "즉시발주",
  warning: "주의",
  scheduled: "예정",
  safe: "안전",
};

const STATUS_BADGE: Record<PurchasingStatus, string> = {
  urgent: "bg-rose-100 text-rose-800 border border-rose-200",
  warning: "bg-amber-100 text-amber-800 border border-amber-200",
  scheduled: "bg-blue-100 text-blue-800 border border-blue-200",
  safe: "bg-emerald-100 text-emerald-800 border border-emerald-200",
};

function fmtNum(value: number): string {
  return Number(value || 0).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

export default function PurchasingClient() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const canView = profile?.role === "admin" || profile?.role === "manager" || profile?.role === "headquarters";

  const [period, setPeriod] = useState<PurchasingPeriodKey>("month_next");
  const [viewTab, setViewTab] = useState<PurchasingViewTab>("overall");
  const [includeStockOnlyRows, setIncludeStockOnlyRows] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | PurchasingStatus>("all");
  const [vendorFilter, setVendorFilter] = useState<string>("all");
  const [policyFilter, setPolicyFilter] = useState<"all" | "normal" | "on_demand">("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PurchasingSummaryData | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<string | null>(null);

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
    const qs = new URLSearchParams({ period, version: "master" });
    const res = await fetch(`/api/materials/purchasing/summary?${qs.toString()}`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "x-refresh-token": session.refresh_token ?? "",
      },
    });
    const json = (await res.json()) as ApiResponse;
    setLoading(false);
    if (!res.ok || !json.ok || !json.data) {
      setError(json.message ?? json.error ?? "발주 요약을 불러오지 못했습니다.");
      return;
    }
    setSummary(json.data);
  }, [authLoading, canView, period]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const rows = useMemo(() => {
    if (!summary) return [] as PurchasingTableRow[];
    return computePurchasingRows({
      entries: summary.entries,
      bomRows: summary.bomRows,
      submaterialRows: summary.submaterialRows,
      materialRows: summary.materialRows,
      vendorItemRows: summary.vendorItemRows,
      inventoryRows: summary.inventoryRows,
      todayIso: summary.today_iso,
      rangeStart: summary.range_start,
      rangeEnd: summary.range_end,
    });
  }, [summary]);

  const vendorOptions = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.vendor_name).filter((v) => v.trim().length > 0))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (vendorFilter !== "all" && r.vendor_name !== vendorFilter) return false;
      if (policyFilter !== "all" && r.order_policy !== policyFilter) return false;
      if (q && !r.material_name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [policyFilter, query, rows, statusFilter, vendorFilter]);

  const visibleRows = useMemo(() => {
    const hasActionSignal = (row: PurchasingTableRow) => row.recommended_order_g > 0 || !!row.shortage_start_date;
    const baseFiltered = filteredRows.filter((row) => {
      if (includeStockOnlyRows) return true;
      if (viewTab === "overall") return row.required_selected_g > 0;
      return hasActionSignal(row);
    });
    if (viewTab === "immediate") {
      return baseFiltered.filter((row) => row.status === "urgent" || row.status === "warning");
    }
    if (viewTab === "shortage_forecast") {
      return baseFiltered
        .filter((row) => !!row.shortage_start_date)
        .slice()
        .sort((a, b) => (a.shortage_start_date ?? "").localeCompare(b.shortage_start_date ?? ""));
    }
    if (viewTab === "vendor_grouped") {
      return baseFiltered
        .slice()
        .sort(
          (a, b) =>
            a.vendor_name.localeCompare(b.vendor_name) ||
            (a.order_due_date ?? "9999-12-31").localeCompare(b.order_due_date ?? "9999-12-31") ||
            b.recommended_order_g - a.recommended_order_g
        );
    }
    return baseFiltered;
  }, [filteredRows, includeStockOnlyRows, viewTab]);

  const kpis = useMemo(() => {
    const today = summary?.today_iso ?? "";
    const plus7 = summary ? new Date(`${summary.today_iso}T00:00:00`) : null;
    const plus14 = summary ? new Date(`${summary.today_iso}T00:00:00`) : null;
    if (plus7) plus7.setDate(plus7.getDate() + 7);
    if (plus14) plus14.setDate(plus14.getDate() + 14);
    const toIso = (d: Date | null) =>
      d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "";
    const day7 = toIso(plus7);
    const day14 = toIso(plus14);

    return {
      urgent: rows.filter((r) => r.status === "urgent").length,
      in7d: rows.filter((r) => r.shortage_g > 0 && r.shortage_start_date && r.shortage_start_date >= today && r.shortage_start_date <= day7).length,
      in14d: rows.filter((r) => r.shortage_g > 0 && r.shortage_start_date && r.shortage_start_date >= today && r.shortage_start_date <= day14).length,
      recommendCount: rows.filter((r) => r.recommended_order_g > 0).length,
      recommendTotalG: rows.reduce((sum, r) => sum + r.recommended_order_g, 0),
    };
  }, [rows, summary]);

  const selectedRow = useMemo(
    () => visibleRows.find((r) => r.material_name === selectedMaterial) ?? visibleRows[0] ?? null,
    [visibleRows, selectedMaterial]
  );

  useEffect(() => {
    if (!selectedMaterial && visibleRows[0]) setSelectedMaterial(visibleRows[0].material_name);
    if (selectedMaterial && !visibleRows.some((r) => r.material_name === selectedMaterial)) {
      setSelectedMaterial(visibleRows[0]?.material_name ?? null);
    }
  }, [visibleRows, selectedMaterial]);

  if (authLoading) return <div className="p-6 text-sm text-slate-300">권한 확인 중...</div>;
  if (!canView) return null;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">원재료 발주 판단 (1차)</h1>
        <p className="text-sm text-slate-400 mt-1">예정입고 반영 없이 재고/소요/리드타임 기준으로 권장 발주량을 계산합니다.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link href="/materials/purchasing/vendors" className="rounded border border-cyan-400/50 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-200">
            공급처 관리
          </Link>
          <Link href="/materials/purchasing/setup" className="rounded border border-cyan-400/50 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-200">
            공급처별 발주조건 입력
          </Link>
        </div>
      </div>

      <section className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <div className="rounded-xl border border-rose-300/40 bg-rose-900/20 p-3">
          <p className="text-xs text-rose-200">즉시발주 품목</p>
          <p className="text-xl font-semibold text-white mt-1">{kpis.urgent}</p>
        </div>
        <div className="rounded-xl border border-amber-300/40 bg-amber-900/20 p-3">
          <p className="text-xs text-amber-200">7일 내 부족 품목</p>
          <p className="text-xl font-semibold text-white mt-1">{kpis.in7d}</p>
        </div>
        <div className="rounded-xl border border-yellow-300/40 bg-yellow-900/20 p-3">
          <p className="text-xs text-yellow-200">14일 내 부족 품목</p>
          <p className="text-xl font-semibold text-white mt-1">{kpis.in14d}</p>
        </div>
        <div className="rounded-xl border border-cyan-300/40 bg-cyan-900/20 p-3">
          <p className="text-xs text-cyan-200">권장 발주 품목</p>
          <p className="text-xl font-semibold text-white mt-1">{kpis.recommendCount}</p>
        </div>
        <div className="rounded-xl border border-blue-300/40 bg-blue-900/20 p-3">
          <p className="text-xs text-blue-200">총 권장 발주량(g)</p>
          <p className="text-xl font-semibold text-white mt-1">{fmtNum(kpis.recommendTotalG)}</p>
        </div>
      </section>

      <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-3 grid gap-2 md:grid-cols-5">
        <div className="md:col-span-5 flex flex-wrap gap-2">
          {VIEW_TAB_OPTIONS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setViewTab(tab.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                viewTab === tab.key
                  ? "bg-cyan-500/20 text-cyan-200 border border-cyan-400/40"
                  : "bg-slate-800 text-slate-300 border border-slate-600 hover:bg-slate-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
          <label className="ml-auto inline-flex items-center gap-2 rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200">
            <input
              type="checkbox"
              checked={includeStockOnlyRows}
              onChange={(e) => setIncludeStockOnlyRows(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            재고만 있는 품목 포함
          </label>
        </div>
        <select value={period} onChange={(e) => setPeriod(e.target.value as PurchasingPeriodKey)} className="bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-100">
          {PERIOD_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
        <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} className="bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-100">
          <option value="all">공급처 전체</option>
          {vendorOptions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | PurchasingStatus)} className="bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-100">
          <option value="all">상태 전체</option>
          <option value="urgent">즉시발주</option>
          <option value="warning">주의</option>
          <option value="scheduled">예정</option>
          <option value="safe">안전</option>
        </select>
        <select value={policyFilter} onChange={(e) => setPolicyFilter(e.target.value as "all" | "normal" | "on_demand")} className="bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-100">
          <option value="all">발주정책 전체</option>
          <option value="normal">일반재고</option>
          <option value="on_demand">필요시발주</option>
        </select>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="품목 검색" className="bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-100 placeholder:text-slate-500" />
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-300/30 bg-rose-900/20 p-3 text-sm text-rose-200">{error}</div>
      ) : null}
      {loading ? <div className="text-sm text-slate-300">불러오는 중...</div> : null}

      <section className="grid gap-3 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 overflow-hidden">
          <div className="overflow-x-auto pb-1">
            <table className="w-full text-sm min-w-[1500px]">
              <thead className="bg-slate-800/80 text-slate-200">
                <tr>
                  {[
                    "상태",
                    "원료명",
                    "공급처",
                    "현재고(g)",
                    "안전재고(g)",
                    "발주정책",
                    "7일 소요",
                    "14일 소요",
                    "선택기간 총소요",
                    "부족량(g)",
                    "부족 시작일",
                    "리드타임",
                    "발주 필요일",
                    "권장 발주량(g)",
                    "권장 발주량(단위)",
                  ].map((h) => (
                    <th key={h} className="px-2 py-2 text-left font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr
                    key={row.material_name}
                    onClick={() => setSelectedMaterial(row.material_name)}
                    className={`border-t border-slate-800 cursor-pointer hover:bg-slate-800/50 ${
                      selectedRow?.material_name === row.material_name ? "bg-slate-800/70" : ""
                    }`}
                  >
                    <td className="px-2 py-2 whitespace-nowrap">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[row.status]}`}>{STATUS_LABEL[row.status]}</span>
                    </td>
                    <td className="px-2 py-2 text-slate-100 whitespace-nowrap">{row.material_name}</td>
                    <td className={`px-2 py-2 whitespace-nowrap ${row.has_primary_vendor ? "" : "text-amber-300"}`}>{row.vendor_name}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{fmtNum(row.stock_g)}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{fmtNum(row.safety_stock_g)}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{row.order_policy === "on_demand" ? "필요시발주" : "일반재고"}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{fmtNum(row.required_7d_g)}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{fmtNum(row.required_14d_g)}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{fmtNum(row.required_selected_g)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-rose-300 whitespace-nowrap">{fmtNum(row.shortage_g)}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{row.shortage_start_date ?? "-"}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{row.lead_time_days}일</td>
                    <td className="px-2 py-2 whitespace-nowrap">{row.order_due_date ?? "-"}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold text-cyan-300 whitespace-nowrap">{fmtNum(row.recommended_order_g)}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{row.recommended_order_units != null ? fmtNum(row.recommended_order_units) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="rounded-xl border border-slate-700 bg-slate-900/60 p-3 2xl:sticky 2xl:top-16 2xl:self-start">
          {!selectedRow ? (
            <div className="text-sm text-slate-400 flex items-center gap-2">
              <PackageSearch className="w-4 h-4" />
              원료를 선택하면 상세가 표시됩니다.
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-slate-400 text-xs">원료</p>
                <p className="text-slate-100 font-semibold">{selectedRow.material_name}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded border border-slate-700 p-2">
                  <p className="text-xs text-slate-400">상태</p>
                  <p className="text-slate-100 mt-1">{STATUS_LABEL[selectedRow.status]}</p>
                </div>
                <div className="rounded border border-slate-700 p-2">
                  <p className="text-xs text-slate-400">공급처/리드타임</p>
                  <p className="text-slate-100 mt-1">{selectedRow.vendor_name} / {selectedRow.lead_time_days}일</p>
                </div>
              </div>
              {!selectedRow.has_primary_vendor ? (
                <div className="rounded border border-amber-400/40 bg-amber-500/10 p-2 text-xs text-amber-200">
                  기본 공급처가 없어 발주조건(리드타임/정책/안전재고/환산단위)을 적용하지 못했습니다.
                </div>
              ) : null}
              <div className="rounded border border-slate-700 p-2">
                <p className="text-xs text-slate-400 mb-1">부족 시작일 계산 근거</p>
                <p className="text-slate-200">
                  {selectedRow.shortage_start_date
                    ? `${selectedRow.shortage_start_date} 시점 누적소요 + ${
                        selectedRow.order_policy === "normal" ? "안전재고" : "0"
                      }가 현재고를 초과`
                    : "선택기간 내 부족 없음"}
                </p>
              </div>
              <div className="rounded border border-slate-700 p-2">
                <p className="text-xs text-slate-400 mb-2">날짜별/누적 소요</p>
                <div className="max-h-40 overflow-auto space-y-1">
                  {selectedRow.date_points.length === 0 ? (
                    <p className="text-slate-500">데이터 없음</p>
                  ) : (
                    selectedRow.date_points.map((p) => (
                      <div key={p.date} className="flex items-center justify-between text-xs">
                        <span className="text-slate-300">{p.date}</span>
                        <span className="text-slate-200">
                          일 {fmtNum(p.required_g)}g / 누적 {fmtNum(p.cumulative_required_g)}g
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="rounded border border-slate-700 p-2">
                <p className="text-xs text-slate-400 mb-2">소요 유발 제품 (TOP)</p>
                <div className="max-h-40 overflow-auto space-y-1">
                  {selectedRow.product_drivers.length === 0 ? (
                    <p className="text-slate-500">데이터 없음</p>
                  ) : (
                    selectedRow.product_drivers.map((d) => (
                      <div key={d.product_name_snapshot} className="flex items-center justify-between text-xs">
                        <span className="text-slate-300">{d.product_name_snapshot}</span>
                        <span className="text-cyan-300">{fmtNum(d.required_g)}g</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="rounded border border-slate-700 p-2">
                <p className="text-xs text-slate-400">발주 단위 환산</p>
                <p className="text-slate-200 mt-1">
                  {selectedRow.purchase_unit_weight_g
                    ? `${fmtNum(selectedRow.recommended_order_g)}g -> ${
                        selectedRow.recommended_order_units ?? 0
                      }${selectedRow.order_unit_name ?? "단위"} (기준 ${fmtNum(selectedRow.purchase_unit_weight_g)}g${
                        selectedRow.order_spec_label ? `, 규격 ${selectedRow.order_spec_label}` : ""
                      })`
                    : "환산 단위 미설정 (g 단위 발주)"}
                </p>
              </div>
            </div>
          )}
        </aside>
      </section>

      <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-3 grid sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
        <div className="flex items-center gap-2 text-rose-300"><Siren className="w-4 h-4" />즉시발주: 발주 필요일이 오늘 이하</div>
        <div className="flex items-center gap-2 text-amber-300"><AlertTriangle className="w-4 h-4" />주의: 발주 필요일이 3일 이내</div>
        <div className="flex items-center gap-2 text-blue-300"><Clock3 className="w-4 h-4" />예정: 부족은 있으나 긴급 아님</div>
        <div className="flex items-center gap-2 text-emerald-300"><CheckCircle2 className="w-4 h-4" />안전: 부족 없음</div>
      </section>
    </div>
  );
}

