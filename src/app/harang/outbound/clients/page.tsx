"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type OutboundClient = {
  id: string;
  name: string;
  manager_name: string | null;
  phone: string | null;
  address: string | null;
  is_active: boolean;
  sort_order: number;
};

type DraftClient = {
  name: string;
  manager_name: string;
  phone: string;
  address: string;
  sort_order: string;
  is_active: boolean;
};

const EMPTY_DRAFT: DraftClient = {
  name: "",
  manager_name: "",
  phone: "",
  address: "",
  sort_order: "0",
  is_active: true,
};

export default function HarangOutboundClientsPage() {
  const [rows, setRows] = useState<OutboundClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftClient>(EMPTY_DRAFT);

  const loadRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("harang_outbound_clients")
      .select("id, name, manager_name, phone, address, is_active, sort_order")
      .order("is_active", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    setLoading(false);
    if (error) {
      alert(error.message);
      return;
    }
    setRows((data ?? []) as OutboundClient[]);
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const startCreate = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  };

  const startEdit = (row: OutboundClient) => {
    setEditingId(row.id);
    setDraft({
      name: row.name ?? "",
      manager_name: row.manager_name ?? "",
      phone: row.phone ?? "",
      address: row.address ?? "",
      sort_order: String(row.sort_order ?? 0),
      is_active: !!row.is_active,
    });
  };

  const onSave = async () => {
    if (!draft.name.trim()) {
      alert("상호를 입력하세요.");
      return;
    }
    const sortOrder = Number(draft.sort_order || "0");
    if (!Number.isFinite(sortOrder)) {
      alert("정렬순서는 숫자로 입력하세요.");
      return;
    }

    setSaving(true);
    const payload = {
      name: draft.name.trim(),
      manager_name: draft.manager_name.trim() || null,
      phone: draft.phone.trim() || null,
      address: draft.address.trim() || null,
      sort_order: Math.trunc(sortOrder),
      is_active: draft.is_active,
    };

    const res = editingId
      ? await supabase.from("harang_outbound_clients").update(payload).eq("id", editingId)
      : await supabase.from("harang_outbound_clients").insert(payload);

    setSaving(false);
    if (res.error) {
      alert(res.error.message);
      return;
    }

    setDraft(EMPTY_DRAFT);
    setEditingId(null);
    await loadRows();
  };

  const onToggleActive = async (row: OutboundClient) => {
    const ok = confirm(
      `${row.name} 거래처를 ${row.is_active ? "비활성" : "활성"} 상태로 변경할까요?`,
    );
    if (!ok) return;
    const { error } = await supabase
      .from("harang_outbound_clients")
      .update({ is_active: !row.is_active })
      .eq("id", row.id);
    if (error) {
      alert(error.message);
      return;
    }
    await loadRows();
  };

  const onDelete = async (row: OutboundClient) => {
    const ok = confirm(`${row.name} 거래처를 삭제할까요?`);
    if (!ok) return;
    const { error } = await supabase.from("harang_outbound_clients").delete().eq("id", row.id);
    if (error) {
      alert(error.message);
      return;
    }
    if (editingId === row.id) {
      setEditingId(null);
      setDraft(EMPTY_DRAFT);
    }
    await loadRows();
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">하랑 출고처관리</h1>
            <p className="mt-1 text-sm text-slate-600">출고입력에서 자동 채움할 거래처를 관리합니다.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/harang/outbound/new"
              className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm bg-white"
            >
              출고입력
            </Link>
            <Link
              href="/harang/outbound"
              className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm bg-white"
            >
              출고내역
            </Link>
          </div>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">
              {editingId ? "출고처 수정" : "출고처 신규 등록"}
            </h2>
            <button
              type="button"
              onClick={startCreate}
              className="px-3 py-1.5 rounded border border-slate-300 text-xs text-slate-700 bg-white"
            >
              신규로 초기화
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-slate-600">
              상호 *
              <input
                value={draft.name}
                onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <label className="text-xs text-slate-600">
              담당자
              <input
                value={draft.manager_name}
                onChange={(e) => setDraft((prev) => ({ ...prev, manager_name: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <label className="text-xs text-slate-600">
              연락처
              <input
                value={draft.phone}
                onChange={(e) => setDraft((prev) => ({ ...prev, phone: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <label className="text-xs text-slate-600">
              정렬순서
              <input
                type="number"
                value={draft.sort_order}
                onChange={(e) => setDraft((prev) => ({ ...prev, sort_order: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <label className="text-xs text-slate-600 sm:col-span-2">
              소재지
              <input
                value={draft.address}
                onChange={(e) => setDraft((prev) => ({ ...prev, address: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 sm:col-span-2">
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(e) => setDraft((prev) => ({ ...prev, is_active: e.target.checked }))}
              />
              사용중(활성)
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={() => void onSave()}
              className="px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 disabled:opacity-60"
            >
              {saving ? "저장 중..." : editingId ? "수정 저장" : "신규 저장"}
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-3 py-2 text-left">상호</th>
                  <th className="px-3 py-2 text-left">담당자</th>
                  <th className="px-3 py-2 text-left">연락처</th>
                  <th className="px-3 py-2 text-left">소재지</th>
                  <th className="px-3 py-2 text-right">정렬</th>
                  <th className="px-3 py-2 text-left">상태</th>
                  <th className="px-3 py-2 text-left">작업</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                      불러오는 중...
                    </td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                      등록된 출고처가 없습니다.
                    </td>
                  </tr>
                )}
                {!loading &&
                  rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 text-slate-900">
                      <td className="px-3 py-2 max-w-[180px] break-words">{row.name}</td>
                      <td className="px-3 py-2 max-w-[140px] break-words">{row.manager_name || "-"}</td>
                      <td className="px-3 py-2 max-w-[160px] break-words">{row.phone || "-"}</td>
                      <td className="px-3 py-2 max-w-[260px] break-words">{row.address || "-"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.sort_order}</td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            row.is_active
                              ? "inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 ring-1 ring-emerald-200"
                              : "inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200"
                          }
                        >
                          {row.is_active ? "활성" : "비활성"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            className="rounded border border-cyan-300 bg-cyan-50 px-2 py-1 text-xs text-cyan-800"
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            onClick={() => void onToggleActive(row)}
                            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                          >
                            {row.is_active ? "비활성" : "활성"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDelete(row)}
                            className="rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-700"
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
