"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import type { MaterialStockLabOverviewRow } from "@/app/api/admin/material-stock-lab/overview/route";

type MovementRow = {
  id: string;
  inventory_item_code: string;
  material_id: string | null;
  movement_type: string;
  qty_g: number;
  effective_at: string;
  recorded_at: string;
  memo: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  created_at: string;
  created_by: string | null;
};

const MOVEMENT_TYPES: { value: string; label: string; hint: string }[] = [
  { value: "receipt", label: "입고 (receipt)", hint: "재고 증가(+)" },
  { value: "return_unused", label: "미사용 반납 (return_unused)", hint: "재고 증가(+)" },
  { value: "waste", label: "폐기 (waste)", hint: "재고 감소(−)" },
  { value: "ecount_reconcile", label: "이카운트 보정 (ecount_reconcile)", hint: "부호 포함 직접 입력" },
  { value: "adjustment", label: "실사조정 (adjustment)", hint: "부호 포함 직접 입력" },
];

function fmtNum(n: number): string {
  return Number(n || 0).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ko-KR");
  } catch {
    return iso;
  }
}

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MaterialStockLabClient() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [savingBaseline, setSavingBaseline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<MaterialStockLabOverviewRow[]>([]);
  const [globalSyncAt, setGlobalSyncAt] = useState<string | null>(null);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [search, setSearch] = useState("");

  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [movementFilterCode, setMovementFilterCode] = useState("");

  const [formCode, setFormCode] = useState("");
  const [formMaterialId, setFormMaterialId] = useState("");
  const [formType, setFormType] = useState("receipt");
  const [formQty, setFormQty] = useState("");
  const [formEffective, setFormEffective] = useState(() => toDatetimeLocalValue(new Date().toISOString()));
  const [formMemo, setFormMemo] = useState("");
  const [savingMovement, setSavingMovement] = useState(false);

  const [voidTarget, setVoidTarget] = useState<MovementRow | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) router.replace("/");
  }, [authLoading, isAdmin, router]);

  const authHeaders = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return null;
    return {
      Authorization: `Bearer ${session.access_token}`,
      "x-refresh-token": session.refresh_token ?? "",
      "Content-Type": "application/json",
    } as Record<string, string>;
  }, []);

  const loadOverview = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    const headers = await authHeaders();
    if (!headers) {
      setError("로그인 세션이 없습니다.");
      setLoading(false);
      return;
    }
    const qs = new URLSearchParams();
    if (onlyDiff) qs.set("onlyDiff", "1");
    if (search.trim()) qs.set("q", search.trim());
    const res = await fetch(`/api/admin/material-stock-lab/overview?${qs.toString()}`, { headers });
    const json = (await res.json()) as {
      ok?: boolean;
      rows?: MaterialStockLabOverviewRow[];
      global_ecount_last_synced_at?: string | null;
      error?: string;
      message?: string;
    };
    setLoading(false);
    if (!res.ok || !json.ok || !json.rows) {
      setError(json.message ?? json.error ?? "불러오기 실패");
      return;
    }
    setRows(json.rows);
    setGlobalSyncAt(json.global_ecount_last_synced_at ?? null);
  }, [authHeaders, isAdmin, onlyDiff, search]);

  const loadMovements = useCallback(async () => {
    if (!isAdmin) return;
    const headers = await authHeaders();
    if (!headers) return;
    const qs = new URLSearchParams({ limit: "80" });
    if (movementFilterCode.trim()) qs.set("code", movementFilterCode.trim());
    const res = await fetch(`/api/admin/material-stock-lab/movements?${qs.toString()}`, { headers });
    const json = (await res.json()) as { ok?: boolean; rows?: MovementRow[]; error?: string; message?: string };
    if (!res.ok || !json.ok) return;
    setMovements(json.rows ?? []);
  }, [authHeaders, isAdmin, movementFilterCode]);

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    void loadOverview();
  }, [authLoading, isAdmin, loadOverview]);

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    void loadMovements();
  }, [authLoading, isAdmin, loadMovements]);

  const codeOptions = useMemo(() => {
    const list = rows.map((r) => ({
      code: r.inventory_item_code,
      label: `${r.inventory_item_code} — ${r.material_names.length ? r.material_names.join(", ") : "(원료 미매핑)"}`,
      candidates: r.material_candidates,
      warn: r.mapping_count > 1,
    }));
    return list.sort((a, b) => a.code.localeCompare(b.code));
  }, [rows]);

  useEffect(() => {
    if (!formCode && codeOptions.length > 0) {
      setFormCode(codeOptions[0]!.code);
    }
  }, [codeOptions, formCode]);

  const selectedFormRow = useMemo(() => rows.find((r) => r.inventory_item_code === formCode), [rows, formCode]);

  useEffect(() => {
    const cands = selectedFormRow?.material_candidates ?? [];
    if (cands.length === 1) setFormMaterialId(cands[0]!.id);
    else if (cands.length === 0) setFormMaterialId("");
  }, [selectedFormRow]);

  const captureBaseline = async () => {
    if (!isAdmin) return;
    if (!window.confirm("현재 이카운트 재고 스냅샷을 기준재고로 저장합니다. 계속할까요?")) return;
    setSavingBaseline(true);
    setError(null);
    const headers = await authHeaders();
    if (!headers) {
      setError("로그인 세션이 없습니다.");
      setSavingBaseline(false);
      return;
    }
    const res = await fetch("/api/admin/material-stock-lab/baseline", { method: "POST", headers });
    const json = (await res.json()) as { ok?: boolean; error?: string; message?: string; inserted?: number };
    setSavingBaseline(false);
    if (!res.ok || !json.ok) {
      setError(json.message ?? json.error ?? "기준재고 저장 실패");
      return;
    }
    await loadOverview();
    await loadMovements();
  };

  const submitMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    if (!formCode.trim()) {
      setError("품목코드를 선택해 주세요.");
      return;
    }
    const qty = Number(String(formQty).replace(/,/g, ""));
    if (!Number.isFinite(qty) || qty === 0) {
      setError("수량을 입력해 주세요.");
      return;
    }
    const effectiveIso = new Date(formEffective).toISOString();
    if (Number.isNaN(Date.parse(effectiveIso))) {
      setError("유효일시가 올바르지 않습니다.");
      return;
    }
    setSavingMovement(true);
    setError(null);
    const headers = await authHeaders();
    if (!headers) {
      setError("로그인 세션이 없습니다.");
      setSavingMovement(false);
      return;
    }
    const body: Record<string, unknown> = {
      inventory_item_code: formCode,
      movement_type: formType,
      qty_g:
        formType === "adjustment" || formType === "ecount_reconcile" ? qty : Math.abs(qty),
      effective_at: effectiveIso,
      memo: formMemo.trim() || null,
    };
    if (formMaterialId.trim()) body.material_id = formMaterialId.trim();

    const res = await fetch("/api/admin/material-stock-lab/movements", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string; message?: string };
    setSavingMovement(false);
    if (!res.ok || !json.ok) {
      setError(json.message ?? json.error ?? "movement 저장 실패");
      return;
    }
    setFormMemo("");
    setFormQty("");
    await loadOverview();
    await loadMovements();
  };

  const submitVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidTarget) return;
    setVoiding(true);
    setError(null);
    const headers = await authHeaders();
    if (!headers) {
      setError("로그인 세션이 없습니다.");
      setVoiding(false);
      return;
    }
    const res = await fetch(`/api/admin/material-stock-lab/movements/${voidTarget.id}/void`, {
      method: "POST",
      headers,
      body: JSON.stringify({ void_reason: voidReason.trim() }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string; message?: string };
    setVoiding(false);
    if (!res.ok || !json.ok) {
      setError(json.message ?? json.error ?? "void 실패");
      return;
    }
    setVoidTarget(null);
    setVoidReason("");
    await loadOverview();
    await loadMovements();
  };

  if (authLoading || !isAdmin) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-slate-500 text-sm">확인 중…</div>
    );
  }

  return (
    <div className="space-y-8 text-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">재고 장부 테스트 (Admin Lab)</h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            이카운트 현재고와 앱 장부(기준재고 + movement)를 비교합니다. 운영 발주·생산계획 계산에는 영향을 주지 않습니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadOverview()}
            disabled={loading}
            className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            새로고침
          </button>
          <button
            type="button"
            onClick={captureBaseline}
            disabled={savingBaseline}
            className="rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            {savingBaseline ? "저장 중…" : "현재 이카운트 재고를 기준재고로 저장"}
          </button>
          <Link href="/admin" className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">
            기준정보 관리로
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-sm text-rose-200">{error}</div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          검색 (코드·원료명)
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void loadOverview()}
            className="w-56 rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-100"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
          차이 있는 항목만
        </label>
        <button
          type="button"
          onClick={() => void loadOverview()}
          className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-slate-100 hover:bg-slate-600"
        >
          필터 적용
        </button>
        <div className="text-xs text-slate-500">
          마지막 동기(전역): <span className="text-slate-300">{fmtTs(globalSyncAt)}</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-700/80">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-900/90 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2">품목코드</th>
              <th className="px-3 py-2">원료명(보조)</th>
              <th className="px-3 py-2 text-right">이카운트</th>
              <th className="px-3 py-2 text-right">기준재고</th>
              <th className="px-3 py-2 text-right">movement 합</th>
              <th className="px-3 py-2 text-right">앱 계산</th>
              <th className="px-3 py-2 text-right">차이</th>
              <th className="px-3 py-2 text-right">차이율</th>
              <th className="px-3 py-2">LOT sync(코드별)</th>
              <th className="px-3 py-2">최근 baseline</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-slate-500">
                  불러오는 중…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-slate-500">
                  표시할 행이 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const diffPct =
                  Math.abs(r.ecount_stock_g) < 1e-9
                    ? r.diff_g === 0
                      ? 0
                      : null
                    : (r.diff_g / r.ecount_stock_g) * 100;
                return (
                  <tr key={r.inventory_item_code} className="border-t border-slate-800 hover:bg-slate-900/50">
                    <td className="px-3 py-2 font-mono text-xs text-cyan-200/90">{r.inventory_item_code}</td>
                    <td className="px-3 py-2 text-slate-300">
                      <div className="flex flex-wrap items-center gap-1">
                        <span>{r.material_names.length ? r.material_names.join(", ") : "—"}</span>
                        {r.mapping_count > 1 && (
                          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-200">
                            동일 코드 {r.mapping_count}건
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.ecount_stock_g)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.lab_baseline_qty_g)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.lab_movement_sum_g)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-100">{fmtNum(r.lab_current_stock_g)}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        Math.abs(r.diff_g) < 1e-6 ? "text-emerald-300" : "text-rose-300"
                      }`}
                    >
                      {fmtNum(r.diff_g)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                      {diffPct === null ? "—" : `${diffPct.toFixed(1)}%`}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">{fmtTs(r.ecount_last_synced_at)}</td>
                    <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">{fmtTs(r.lab_baseline_at)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <form onSubmit={submitMovement} className="rounded-xl border border-slate-700/80 p-4 space-y-3">
          <h2 className="text-base font-semibold text-slate-100">수동 movement</h2>
          <label className="block text-xs text-slate-400">
            품목코드
            <select
              value={formCode}
              onChange={(e) => {
                setFormCode(e.target.value);
                setFormMaterialId("");
              }}
              className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-100"
            >
              {codeOptions.length === 0 ? (
                <option value="">(표시할 코드 없음 — 기준재고 저장 또는 이카운트 동기 후 확인)</option>
              ) : (
                codeOptions.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                    {o.warn ? " ⚠" : ""}
                  </option>
                ))
              )}
            </select>
          </label>
          {(selectedFormRow?.material_candidates?.length ?? 0) > 1 && (
            <label className="block text-xs text-slate-400">
              원료 행 선택 (선택)
              <select
                value={formMaterialId}
                onChange={(e) => setFormMaterialId(e.target.value)}
                className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-100"
              >
                <option value="">(미지정)</option>
                {selectedFormRow!.material_candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.material_name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block text-xs text-slate-400">
            유형
            <select
              value={formType}
              onChange={(e) => setFormType(e.target.value)}
              className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-100"
            >
              {MOVEMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[11px] text-slate-500">{MOVEMENT_TYPES.find((t) => t.value === formType)?.hint}</p>
          <label className="block text-xs text-slate-400">
            수량 (g) {formType === "adjustment" || formType === "ecount_reconcile" ? "· 부호 포함" : "· 양수"}
            <input
              value={formQty}
              onChange={(e) => setFormQty(e.target.value)}
              className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-100"
            />
          </label>
          <label className="block text-xs text-slate-400">
            효력 시각 (effective_at)
            <input
              type="datetime-local"
              value={formEffective}
              onChange={(e) => setFormEffective(e.target.value)}
              className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-100"
            />
          </label>
          <label className="block text-xs text-slate-400">
            메모
            <input
              value={formMemo}
              onChange={(e) => setFormMemo(e.target.value)}
              className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-100"
            />
          </label>
          <button
            type="submit"
            disabled={savingMovement}
            className="w-full rounded-lg bg-emerald-700 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {savingMovement ? "저장 중…" : "movement 저장"}
          </button>
        </form>

        <div className="rounded-xl border border-slate-700/80 p-4 space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-100">최근 movement</h2>
            <div className="flex gap-2 items-center">
              <input
                placeholder="코드 필터"
                value={movementFilterCode}
                onChange={(e) => setMovementFilterCode(e.target.value)}
                className="w-32 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs font-mono text-slate-100"
              />
              <button
                type="button"
                onClick={() => void loadMovements()}
                className="rounded border border-slate-600 px-2 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
              >
                적용
              </button>
            </div>
          </div>
          <ul className="max-h-80 overflow-auto divide-y divide-slate-800 text-sm">
            {movements.map((m) => (
              <li key={m.id} className="py-2 flex flex-wrap justify-between gap-2">
                <div>
                  <div className="font-mono text-xs text-cyan-200/90">{m.inventory_item_code}</div>
                  <div className="text-slate-400 text-xs">
                    {m.movement_type} · {fmtNum(m.qty_g)} g · {fmtTs(m.effective_at)}
                  </div>
                  {m.voided_at ? (
                    <div className="text-rose-300 text-xs mt-0.5">void {fmtTs(m.voided_at)}</div>
                  ) : null}
                </div>
                {!m.voided_at && (
                  <button
                    type="button"
                    onClick={() => {
                      setVoidTarget(m);
                      setVoidReason("");
                    }}
                    className="shrink-0 rounded border border-rose-500/50 px-2 py-1 text-xs text-rose-200 hover:bg-rose-950/40"
                  >
                    void
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {voidTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={submitVoid} className="w-full max-w-md rounded-xl border border-slate-600 bg-slate-900 p-4 space-y-3">
            <h3 className="font-semibold text-slate-100">movement void</h3>
            <p className="text-xs text-slate-400 font-mono">{voidTarget.id}</p>
            <label className="block text-xs text-slate-400">
              사유 (필수)
              <input
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2 text-sm text-slate-100"
                required
              />
            </label>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setVoidTarget(null);
                  setVoidReason("");
                }}
                className="rounded border border-slate-600 px-3 py-2 text-sm text-slate-300"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={voiding || !voidReason.trim()}
                className="rounded bg-rose-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {voiding ? "처리 중…" : "void 확정"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
