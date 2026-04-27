"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type MaterialType = "raw_material" | "submaterial";
type OrderPolicy = "normal" | "on_demand";

type VendorLite = { id: string; vendor_name: string; is_active: boolean };
type MaterialOption = {
  material_type: MaterialType;
  source_id: string;
  material_name: string;
  material_code: string | null;
};
type VendorItem = {
  id: string;
  vendor_id: string;
  material_code: string | null;
  material_name_snapshot: string;
  material_type: MaterialType;
  order_spec_label: string | null;
  purchase_unit_weight_g: number;
  purchase_unit_name: string | null;
  lead_time_days: number;
  safety_stock_g: number;
  order_policy: OrderPolicy;
  is_primary_vendor: boolean;
  note: string | null;
};

type SetupGetResponse = {
  ok?: boolean;
  data?: { vendors: VendorLite[]; options: MaterialOption[]; items: VendorItem[] };
  error?: string;
  message?: string;
};
type SaveResponse = { ok?: boolean; data?: VendorItem; error?: string; message?: string };
type DeleteResponse = { ok?: boolean; error?: string; message?: string };

type Draft = {
  selectedOption: MaterialOption | null;
  order_spec_label: string;
  purchase_unit_weight_g: string;
  purchase_unit_name: string;
  lead_time_days: string;
  safety_stock_g: string;
  order_policy: OrderPolicy;
  is_primary_vendor: boolean;
  note: string;
};

const EMPTY_DRAFT: Draft = {
  selectedOption: null,
  order_spec_label: "",
  purchase_unit_weight_g: "",
  purchase_unit_name: "",
  lead_time_days: "0",
  safety_stock_g: "0",
  order_policy: "normal",
  is_primary_vendor: false,
  note: "",
};

function normalizeIntegerText(input: string): string {
  return input.replace(/[^\d]/g, "");
}

function formatThousands(input: string): string {
  const normalized = normalizeIntegerText(input);
  if (!normalized) return "";
  return Number(normalized).toLocaleString("ko-KR");
}

export default function SetupClient() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const canView = profile?.role === "admin" || profile?.role === "manager" || profile?.role === "headquarters";

  const [vendorId, setVendorId] = useState("");
  const [materialType, setMaterialType] = useState<MaterialType>("raw_material");
  const [q, setQ] = useState("");
  const [onlyUnregistered, setOnlyUnregistered] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [vendors, setVendors] = useState<VendorLite[]>([]);
  const [options, setOptions] = useState<MaterialOption[]>([]);
  const [items, setItems] = useState<VendorItem[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [searchInput, setSearchInput] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!canView) router.replace("/materials");
  }, [authLoading, canView, router]);

  const fetchSetupData = useCallback(async () => {
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
    const qs = new URLSearchParams({
      material_type: materialType,
      only_unregistered: onlyUnregistered ? "1" : "0",
    });
    if (vendorId) qs.set("vendor_id", vendorId);
    if (q.trim()) qs.set("q", q.trim());
    const res = await fetch(`/api/materials/purchasing/setup?${qs.toString()}`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "x-refresh-token": session.refresh_token ?? "",
      },
    });
    const json = (await res.json()) as SetupGetResponse;
    setLoading(false);
    if (!res.ok || !json.ok || !json.data) {
      setError(json.message ?? json.error ?? "발주조건 데이터를 불러오지 못했습니다.");
      return;
    }
    setVendors(json.data.vendors.filter((v) => v.is_active));
    setOptions(json.data.options);
    setItems(json.data.items);
    if (!vendorId && json.data.vendors[0]?.id) setVendorId(json.data.vendors[0].id);
  }, [authLoading, canView, materialType, onlyUnregistered, q, vendorId]);

  useEffect(() => {
    fetchSetupData();
  }, [fetchSetupData]);

  useEffect(() => {
    setDraft(EMPTY_DRAFT);
    setSearchInput("");
    setIsDropdownOpen(false);
  }, [materialType, vendorId]);

  const searchedOptions = useMemo(() => {
    const needle = searchInput.trim().toLowerCase();
    if (!needle) return options.slice(0, 60);
    return options
      .filter((o) => o.material_name.toLowerCase().includes(needle) || (o.material_code ?? "").toLowerCase().includes(needle))
      .slice(0, 80);
  }, [options, searchInput]);

  const vendorItems = useMemo(() => {
    return items
      .filter((i) => i.vendor_id === vendorId && i.material_type === materialType)
      .sort((a, b) => a.material_name_snapshot.localeCompare(b.material_name_snapshot));
  }, [items, materialType, vendorId]);

  const saveRow = async () => {
    if (!vendorId) {
      setError("공급처를 먼저 선택하세요.");
      return;
    }
    if (!draft.selectedOption) {
      setError("품명을 선택하세요.");
      return;
    }
    setSaving(true);
    setError(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setSaving(false);
      setError("로그인 세션이 없습니다.");
      return;
    }
    const payload = {
      vendor_id: vendorId,
      material_type: draft.selectedOption.material_type,
      material_code: draft.selectedOption.material_code,
      material_name_snapshot: draft.selectedOption.material_name,
      order_spec_label: draft.order_spec_label.trim() || null,
      purchase_unit_weight_g: Number(draft.purchase_unit_weight_g) || 0,
      purchase_unit_name: draft.purchase_unit_name.trim() || null,
      lead_time_days: Number(draft.lead_time_days) || 0,
      safety_stock_g: Number(draft.safety_stock_g) || 0,
      order_policy: draft.order_policy,
      is_primary_vendor: draft.is_primary_vendor,
      note: draft.note.trim() || null,
    };
    const res = await fetch("/api/materials/purchasing/setup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        "x-refresh-token": session.refresh_token ?? "",
      },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as SaveResponse;
    setSaving(false);
    if (!res.ok || !json.ok || !json.data) {
      setError(json.message ?? json.error ?? "저장 실패");
      return;
    }
    await fetchSetupData();
    setDraft(EMPTY_DRAFT);
    setSearchInput("");
    setIsDropdownOpen(false);
  };

  const saveEditRow = async (row: VendorItem) => {
    setSaving(true);
    setError(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setSaving(false);
      setError("로그인 세션이 없습니다.");
      return;
    }
    const res = await fetch("/api/materials/purchasing/setup", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        "x-refresh-token": session.refresh_token ?? "",
      },
      body: JSON.stringify(row),
    });
    const json = (await res.json()) as SaveResponse;
    setSaving(false);
    if (!res.ok || !json.ok || !json.data) {
      setError(json.message ?? json.error ?? "수정 저장 실패");
      return;
    }
    setItems((prev) => prev.map((x) => (x.id === json.data!.id ? json.data! : x)));
    setEditingRowId(null);
  };

  const deleteRow = async (row: VendorItem) => {
    const confirmMessage = row.is_primary_vendor
      ? `기본공급처로 설정된 품목입니다.\n삭제하면 '${row.material_name_snapshot}' 품목은 기본 공급처 미설정 상태가 됩니다.\n정말 삭제하시겠습니까?`
      : `'${row.material_name_snapshot}' 행을 삭제하시겠습니까?`;
    if (!window.confirm(confirmMessage)) return;

    setSaving(true);
    setError(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setSaving(false);
      setError("로그인 세션이 없습니다.");
      return;
    }
    const qs = new URLSearchParams({ id: row.id });
    const res = await fetch(`/api/materials/purchasing/setup?${qs.toString()}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "x-refresh-token": session.refresh_token ?? "",
      },
    });
    const json = (await res.json()) as DeleteResponse;
    setSaving(false);
    if (!res.ok || !json.ok) {
      setError(json.message ?? json.error ?? "삭제 실패");
      return;
    }
    await fetchSetupData();
  };

  const selectedVendorName = useMemo(() => vendors.find((v) => v.id === vendorId)?.vendor_name ?? "-", [vendors, vendorId]);

  if (authLoading) return <div className="p-6 text-sm text-slate-300">권한 확인 중...</div>;
  if (!canView) return null;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">공급처별 발주조건 입력</h1>
          <p className="text-sm text-slate-400 mt-1">공급처를 고르고 품명을 검색 선택해 행 단위로 빠르게 저장합니다.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/materials/purchasing/vendors" className="rounded border border-cyan-400/50 bg-cyan-500/10 px-3 py-1.5 text-sm text-cyan-200">
            공급처 관리
          </Link>
          <Link href="/materials/purchasing" className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200">
            발주 판단 화면
          </Link>
        </div>
      </div>

      <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-3 grid gap-2 md:grid-cols-6">
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-100">
          <option value="">공급처 선택</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>{v.vendor_name}</option>
          ))}
        </select>
        <select value={materialType} onChange={(e) => setMaterialType(e.target.value as MaterialType)} className="bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-100">
          <option value="raw_material">원재료</option>
          <option value="submaterial">부자재</option>
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="품목 검색(목록 필터)" className="bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-100" />
        <label className="inline-flex items-center gap-2 rounded border border-slate-600 bg-slate-800 px-2 py-2 text-sm text-slate-200">
          <input type="checkbox" checked={onlyUnregistered} onChange={(e) => setOnlyUnregistered(e.target.checked)} />
          미등록 품목만 보기
        </label>
        <div className="md:col-span-2 text-xs text-slate-400 flex items-center">선택 공급처: <span className="ml-1 text-slate-200">{selectedVendorName}</span></div>
      </section>

      <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-3 space-y-2">
        <h2 className="text-sm font-semibold text-slate-100">행 단위 신규 등록</h2>
        <div className="grid gap-2 md:grid-cols-8">
          <div className="md:col-span-2 relative">
            <label className="mb-1 block text-xs text-slate-400">품목명</label>
            <input
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setIsDropdownOpen(true);
              }}
              onFocus={() => setIsDropdownOpen(true)}
              onBlur={() => {
                window.setTimeout(() => setIsDropdownOpen(false), 120);
              }}
              placeholder="품명 검색 후 선택"
              className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-100"
            />
            {isDropdownOpen && searchedOptions.length > 0 ? (
              <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded border border-slate-600 bg-slate-900 shadow-xl">
                {searchedOptions.map((opt) => (
                  <button
                    key={`${opt.material_type}-${opt.source_id}`}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setDraft((p) => ({ ...p, selectedOption: opt }));
                      setSearchInput(opt.material_name);
                      setIsDropdownOpen(false);
                    }}
                    className="block w-full px-2 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800"
                  >
                    {opt.material_name} {opt.material_code ? `(${opt.material_code})` : ""}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">발주규격</label>
            <input value={draft.order_spec_label} onChange={(e) => setDraft((p) => ({ ...p, order_spec_label: e.target.value }))} placeholder="예: 1kg×10" className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-100" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">1단위(g)</label>
            <input
              value={formatThousands(draft.purchase_unit_weight_g)}
              onChange={(e) =>
                setDraft((p) => ({ ...p, purchase_unit_weight_g: normalizeIntegerText(e.target.value) }))
              }
              inputMode="numeric"
              placeholder="0"
              className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">단위명</label>
            <input value={draft.purchase_unit_name} onChange={(e) => setDraft((p) => ({ ...p, purchase_unit_name: e.target.value }))} placeholder="박스/EA" className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-100" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">리드타임(일)</label>
            <input value={draft.lead_time_days} onChange={(e) => setDraft((p) => ({ ...p, lead_time_days: e.target.value }))} placeholder="0" className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-100" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">안전재고(g)</label>
            <input
              value={formatThousands(draft.safety_stock_g)}
              onChange={(e) =>
                setDraft((p) => ({ ...p, safety_stock_g: normalizeIntegerText(e.target.value) }))
              }
              inputMode="numeric"
              placeholder="0"
              className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">발주정책</label>
            <select value={draft.order_policy} onChange={(e) => setDraft((p) => ({ ...p, order_policy: e.target.value as OrderPolicy }))} className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-100">
              <option value="normal">일반재고</option>
              <option value="on_demand">필요시발주</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs text-slate-400">메모</label>
            <input value={draft.note} onChange={(e) => setDraft((p) => ({ ...p, note: e.target.value }))} placeholder="비고" className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-100" />
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-slate-400">기본공급처</label>
            <label className="inline-flex h-[42px] w-full items-center gap-2 rounded border border-slate-600 bg-slate-800 px-2 py-2 text-sm text-slate-200">
              <input type="checkbox" checked={draft.is_primary_vendor} onChange={(e) => setDraft((p) => ({ ...p, is_primary_vendor: e.target.checked }))} />
              기본
            </label>
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-transparent">저장</label>
            <button onClick={saveRow} disabled={saving} className="h-[42px] w-full rounded bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-60">
              행 저장
            </button>
          </div>
        </div>
      </section>

      {error ? <div className="rounded border border-rose-400/30 bg-rose-500/10 p-2 text-sm text-rose-200">{error}</div> : null}
      {loading ? <div className="text-sm text-slate-300">불러오는 중...</div> : null}

      <section className="rounded-xl border border-slate-700 bg-slate-900/60 overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-700 text-sm text-slate-200">등록된 품목 ({vendorItems.length})</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1200px]">
            <thead className="bg-slate-800/80 text-slate-200">
              <tr>
                {["구분", "품목명", "코드", "발주규격", "환산(g)", "단위", "LT", "안전재고", "정책", "기본", "메모", ""].map((h) => (
                  <th key={h} className="px-2 py-2 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vendorItems.map((row) => {
                const editing = editingRowId === row.id;
                return (
                  <tr key={row.id} className="border-t border-slate-800">
                    <td className="px-2 py-2">{row.material_type === "raw_material" ? "원재료" : "부자재"}</td>
                    <td className="px-2 py-2 text-slate-100">{row.material_name_snapshot}</td>
                    <td className="px-2 py-2">{row.material_code ?? "-"}</td>
                    <td className="px-2 py-2">
                      <input
                        disabled={!editing}
                        value={row.order_spec_label ?? ""}
                        onChange={(e) => setItems((prev) => prev.map((x) => (x.id === row.id ? { ...x, order_spec_label: e.target.value } : x)))}
                        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 disabled:opacity-60"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        disabled={!editing}
                        value={String(row.purchase_unit_weight_g ?? 0)}
                        onChange={(e) => setItems((prev) => prev.map((x) => (x.id === row.id ? { ...x, purchase_unit_weight_g: Number(e.target.value) || 0 } : x)))}
                        className="w-24 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 disabled:opacity-60"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        disabled={!editing}
                        value={row.purchase_unit_name ?? ""}
                        onChange={(e) => setItems((prev) => prev.map((x) => (x.id === row.id ? { ...x, purchase_unit_name: e.target.value } : x)))}
                        className="w-20 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 disabled:opacity-60"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        disabled={!editing}
                        value={String(row.lead_time_days ?? 0)}
                        onChange={(e) => setItems((prev) => prev.map((x) => (x.id === row.id ? { ...x, lead_time_days: Number(e.target.value) || 0 } : x)))}
                        className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 disabled:opacity-60"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        disabled={!editing}
                        value={String(row.safety_stock_g ?? 0)}
                        onChange={(e) => setItems((prev) => prev.map((x) => (x.id === row.id ? { ...x, safety_stock_g: Number(e.target.value) || 0 } : x)))}
                        className="w-24 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 disabled:opacity-60"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <select
                        disabled={!editing}
                        value={row.order_policy}
                        onChange={(e) => setItems((prev) => prev.map((x) => (x.id === row.id ? { ...x, order_policy: e.target.value as OrderPolicy } : x)))}
                        className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 disabled:opacity-60"
                      >
                        <option value="normal">일반</option>
                        <option value="on_demand">필요시</option>
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        disabled={!editing}
                        checked={row.is_primary_vendor}
                        onChange={(e) => setItems((prev) => prev.map((x) => (x.id === row.id ? { ...x, is_primary_vendor: e.target.checked } : x)))}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        disabled={!editing}
                        value={row.note ?? ""}
                        onChange={(e) => setItems((prev) => prev.map((x) => (x.id === row.id ? { ...x, note: e.target.value } : x)))}
                        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 disabled:opacity-60"
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      {editing ? (
                        <button onClick={() => saveEditRow(row)} className="rounded bg-cyan-600 px-2 py-1 text-xs text-white">저장</button>
                      ) : (
                        <div className="inline-flex items-center gap-1">
                          <button onClick={() => setEditingRowId(row.id)} className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200">수정</button>
                          <button
                            onClick={() => deleteRow(row)}
                            disabled={saving}
                            className="rounded border border-rose-500/50 px-2 py-1 text-xs text-rose-200 hover:bg-rose-500/10 disabled:opacity-60"
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

