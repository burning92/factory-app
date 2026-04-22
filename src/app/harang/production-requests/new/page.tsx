"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { canManageHqHarangProductionRequests } from "@/features/harang/productionRequests";
import { displayHarangProductName } from "@/features/harang/displayProductName";
import { supabase } from "@/lib/supabase";

type LineForm = { product_name: string; requested_qty: string; note: string };

export default function NewHarangProductionRequestPage() {
  const router = useRouter();
  const { organization, profile } = useAuth();
  const canRegister = canManageHqHarangProductionRequests(organization?.organization_code, profile?.role);
  const [products, setProducts] = useState<string[]>([]);
  const [requestDate, setRequestDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [priority, setPriority] = useState("0");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineForm[]>([{ product_name: "", requested_qty: "", note: "" }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canRegister) return;
    void (async () => {
      const res = await supabase.from("harang_product_bom").select("product_name").eq("is_active", true);
      if (res.error) return;
      const set = new Set<string>();
      for (const r of res.data ?? []) {
        if (r.product_name) set.add(r.product_name);
      }
      setProducts(Array.from(set).sort((a, b) => a.localeCompare(b, "ko")));
    })();
  }, [canRegister]);

  const addLine = () => setLines((prev) => [...prev, { product_name: "", requested_qty: "", note: "" }]);

  const submit = useCallback(async () => {
    if (!canRegister) return;
    const payload = lines
      .filter((l) => l.product_name.trim() && Number(l.requested_qty) > 0)
      .map((l) => ({
        product_name: l.product_name.trim(),
        requested_qty: Number(l.requested_qty),
        note: l.note.trim() || null,
      }));
    if (payload.length === 0) {
      alert("최소 1개 이상의 유효한 요청 라인이 필요합니다.");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc("create_harang_production_request", {
      p_request_date: requestDate,
      p_due_date: dueDate,
      p_priority: Number(priority) || 0,
      p_note: note.trim() || null,
      p_lines: payload,
    });
    setSaving(false);
    if (error) {
      alert(error.message);
      return;
    }
    const id = data as string;
    router.replace(`/harang/production-requests/${id}`);
  }, [canRegister, lines, requestDate, dueDate, priority, note, router]);

  if (!canRegister) {
    return (
      <div className="px-4 py-8 max-w-lg mx-auto">
        <p className="text-slate-700">
          생산요청 등록은 본사(조직 코드 100)의 매니저·관리자 계정만 사용할 수 있습니다.
        </p>
        <Link href="/harang/production-requests" className="mt-4 inline-block text-cyan-700 underline">
          목록으로
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-slate-900">생산요청 등록</h1>
          <Link href="/harang/production-requests" className="text-sm text-slate-600 hover:text-slate-900">
            목록
          </Link>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="text-slate-500">요청일</span>
              <input
                type="date"
                value={requestDate}
                onChange={(e) => setRequestDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              />
            </label>
            <label className="text-sm">
              <span className="text-slate-500">납기일</span>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              />
            </label>
            <label className="text-sm">
              <span className="text-slate-500">우선순위 (숫자 클수록 우선)</span>
              <input
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="text-slate-500">비고</span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              />
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">요청 라인</h2>
            <button type="button" onClick={addLine} className="text-sm text-cyan-700">
              + 라인 추가
            </button>
          </div>
          {lines.map((line, idx) => (
            <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2 border-b border-slate-100 pb-3">
              <label className="md:col-span-5 text-sm">
                <span className="text-slate-500">제품 (BOM 등록명)</span>
                <select
                  value={line.product_name}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, product_name: v } : x)));
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                >
                  <option value="">선택</option>
                  {products.map((p) => (
                    <option key={p} value={p}>
                      {displayHarangProductName(p)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="md:col-span-3 text-sm">
                <span className="text-slate-500">요청수량</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={line.requested_qty}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, requested_qty: v } : x)));
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 tabular-nums"
                />
              </label>
              <label className="md:col-span-4 text-sm">
                <span className="text-slate-500">라인 비고</span>
                <input
                  value={line.note}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, note: v } : x)));
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                />
              </label>
            </div>
          ))}
        </section>

        <div className="flex gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="px-4 py-2 rounded-lg bg-cyan-600 text-white font-medium disabled:opacity-50"
          >
            {saving ? "저장 중…" : "요청 저장"}
          </button>
          <Link href="/harang/production-requests" className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700">
            취소
          </Link>
        </div>
      </div>
    </div>
  );
}
