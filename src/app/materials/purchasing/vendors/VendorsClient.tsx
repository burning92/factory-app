"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type VendorRow = {
  id: string;
  vendor_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  is_active: boolean;
};

type VendorApiResponse = { ok?: boolean; data?: VendorRow[] | VendorRow; error?: string; message?: string };

type VendorDraft = {
  vendor_name: string;
  contact_name: string;
  phone: string;
  email: string;
  note: string;
  is_active: boolean;
};

const EMPTY_DRAFT: VendorDraft = {
  vendor_name: "",
  contact_name: "",
  phone: "",
  email: "",
  note: "",
  is_active: true,
};

export default function VendorsClient() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const canView = profile?.role === "admin" || profile?.role === "manager" || profile?.role === "headquarters";

  const [rows, setRows] = useState<VendorRow[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<VendorDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!canView) router.replace("/materials");
  }, [authLoading, canView, router]);

  const loadRows = useCallback(async () => {
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
    const qs = new URLSearchParams();
    if (q.trim()) qs.set("q", q.trim());
    const res = await fetch(`/api/materials/purchasing/vendors?${qs.toString()}`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "x-refresh-token": session.refresh_token ?? "",
      },
    });
    const json = (await res.json()) as VendorApiResponse;
    setLoading(false);
    if (!res.ok || !json.ok || !Array.isArray(json.data)) {
      setError(json.message ?? json.error ?? "공급처 목록을 불러오지 못했습니다.");
      return;
    }
    setRows(json.data);
  }, [authLoading, canView, q]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const resetDraft = () => {
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
  };

  const handleSave = async () => {
    const vendorName = draft.vendor_name.trim();
    if (!vendorName) {
      setError("공급처명은 필수입니다.");
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
    const method = editingId ? "PATCH" : "POST";
    const payload = {
      id: editingId,
      vendor_name: vendorName,
      contact_name: draft.contact_name.trim() || null,
      phone: draft.phone.trim() || null,
      email: draft.email.trim() || null,
      note: draft.note.trim() || null,
      is_active: draft.is_active,
    };
    const res = await fetch("/api/materials/purchasing/vendors", {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        "x-refresh-token": session.refresh_token ?? "",
      },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as VendorApiResponse;
    setSaving(false);
    if (!res.ok || !json.ok) {
      setError(json.message ?? json.error ?? "저장 실패");
      return;
    }
    resetDraft();
    await loadRows();
  };

  const visibleRows = useMemo(() => {
    if (!q.trim()) return rows;
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => r.vendor_name.toLowerCase().includes(needle));
  }, [q, rows]);

  if (authLoading) return <div className="p-6 text-sm text-slate-300">권한 확인 중...</div>;
  if (!canView) return null;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">공급처 관리</h1>
          <p className="text-sm text-slate-400 mt-1">발주조건 입력에서 사용할 공급처를 먼저 등록합니다.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/materials/purchasing/setup" className="rounded border border-cyan-400/50 bg-cyan-500/10 px-3 py-1.5 text-sm text-cyan-200">
            발주조건 입력으로 이동
          </Link>
          <Link href="/materials/purchasing" className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200">
            발주 판단 화면
          </Link>
        </div>
      </div>

      <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-3 grid gap-2 md:grid-cols-6">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="공급처 검색"
          className="md:col-span-2 bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-100"
        />
        <input value={draft.vendor_name} onChange={(e) => setDraft((p) => ({ ...p, vendor_name: e.target.value }))} placeholder="공급처명 *" className="bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-100" />
        <input value={draft.contact_name} onChange={(e) => setDraft((p) => ({ ...p, contact_name: e.target.value }))} placeholder="담당자명" className="bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-100" />
        <input value={draft.phone} onChange={(e) => setDraft((p) => ({ ...p, phone: e.target.value }))} placeholder="연락처" className="bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-100" />
        <input value={draft.email} onChange={(e) => setDraft((p) => ({ ...p, email: e.target.value }))} placeholder="이메일" className="bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-100" />
        <input value={draft.note} onChange={(e) => setDraft((p) => ({ ...p, note: e.target.value }))} placeholder="메모" className="md:col-span-3 bg-slate-800 border border-slate-600 rounded px-2 py-2 text-sm text-slate-100" />
        <label className="inline-flex items-center gap-2 rounded border border-slate-600 bg-slate-800 px-2 py-2 text-sm text-slate-200">
          <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft((p) => ({ ...p, is_active: e.target.checked }))} />
          사용
        </label>
        <div className="md:col-span-2 flex gap-2">
          <button onClick={handleSave} disabled={saving} className="rounded bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-60">
            {editingId ? "수정 저장" : "신규 등록"}
          </button>
          <button onClick={resetDraft} type="button" className="rounded border border-slate-600 px-3 py-2 text-sm text-slate-200">
            초기화
          </button>
        </div>
      </section>

      {error ? <div className="rounded border border-rose-400/30 bg-rose-500/10 p-2 text-sm text-rose-200">{error}</div> : null}
      {loading ? <div className="text-sm text-slate-300">불러오는 중...</div> : null}

      <section className="rounded-xl border border-slate-700 bg-slate-900/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-slate-800/80 text-slate-200">
              <tr>
                {["공급처명", "담당자", "연락처", "이메일", "메모", "사용", ""].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id} className="border-t border-slate-800">
                  <td className="px-3 py-2 text-slate-100">{row.vendor_name}</td>
                  <td className="px-3 py-2">{row.contact_name ?? "-"}</td>
                  <td className="px-3 py-2">{row.phone ?? "-"}</td>
                  <td className="px-3 py-2">{row.email ?? "-"}</td>
                  <td className="px-3 py-2">{row.note ?? "-"}</td>
                  <td className="px-3 py-2">{row.is_active ? "사용" : "미사용"}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(row.id);
                        setDraft({
                          vendor_name: row.vendor_name,
                          contact_name: row.contact_name ?? "",
                          phone: row.phone ?? "",
                          email: row.email ?? "",
                          note: row.note ?? "",
                          is_active: row.is_active,
                        });
                      }}
                      className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200"
                    >
                      수정
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

