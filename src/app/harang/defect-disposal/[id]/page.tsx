"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  deleteDefectDisposal,
  fetchDefectDisposalHeader,
  formatLotDateDot,
  type DefectDisposalHeader,
} from "@/features/harang/defectDisposal";

export default function HarangDefectDisposalDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id ?? "");
  const [row, setRow] = useState<DefectDisposalHeader | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await fetchDefectDisposalHeader(id);
      setRow(data);
    } catch (e) {
      alert(e instanceof Error ? e.message : "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async () => {
    if (!row) return;
    if (!confirm(`불량처리 ${row.disposal_no} 을(를) 삭제할까요?`)) return;
    setDeleting(true);
    try {
      await deleteDefectDisposal(row.id);
      router.push("/harang/defect-disposal");
    } catch (e) {
      alert(e instanceof Error ? e.message : "삭제 실패");
      setDeleting(false);
    }
  };

  if (loading) {
    return <div className="px-6 py-10 text-slate-600">불러오는 중…</div>;
  }

  if (!row) {
    return (
      <div className="px-6 py-10">
        <p className="text-slate-600">전표를 찾을 수 없습니다.</p>
        <Link href="/harang/defect-disposal" className="text-cyan-700 text-sm mt-2 inline-block">
          목록으로
        </Link>
      </div>
    );
  }

  const lines = [...(row.lines ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order || a.item_name.localeCompare(b.item_name, "ko"),
  );

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-5xl mx-auto space-y-5">
        <div>
          <Link href="/harang/defect-disposal" className="text-sm text-slate-600 hover:text-slate-900">
            ← 불량처리조회
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">불량처리 상세</h1>
          <p className="mt-1 font-mono text-sm text-slate-700">{row.disposal_no}</p>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-slate-500 text-xs">일자</p>
            <p className="font-medium">{row.disposal_date}</p>
          </div>
          <div>
            <p className="text-slate-500 text-xs">담당자</p>
            <p className="font-medium">{row.handler_name || "-"}</p>
          </div>
          <div>
            <p className="text-slate-500 text-xs">처리방법</p>
            <p className="font-medium">{row.processing_method}</p>
          </div>
          <div>
            <p className="text-slate-500 text-xs">등록일시</p>
            <p className="font-medium">{new Date(row.created_at).toLocaleString("ko-KR")}</p>
          </div>
          {row.note ? (
            <div className="col-span-full">
              <p className="text-slate-500 text-xs">비고</p>
              <p>{row.note}</p>
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
            <h2 className="text-sm font-semibold text-slate-800">불량 품목</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 border-b border-slate-300">
                <tr>
                  <th className="px-3 py-2 text-left">품목명</th>
                  <th className="px-3 py-2 text-left">소비기한</th>
                  <th className="px-3 py-2 text-right">수량</th>
                  <th className="px-3 py-2 text-left">불량유형/사유</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {lines.map((line) => (
                  <tr key={line.id}>
                    <td className="px-3 py-2">{line.item_name}</td>
                    <td className="px-3 py-2 tabular-nums">{formatLotDateDot(line.lot_date)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {Number(line.quantity).toLocaleString()} {line.unit}
                    </td>
                    <td className="px-3 py-2">{line.defect_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <button
          type="button"
          disabled={deleting}
          onClick={() => void handleDelete()}
          className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {deleting ? "삭제 중…" : "전표 삭제"}
        </button>
      </div>
    </div>
  );
}
