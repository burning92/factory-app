"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { RECEIVING_STORAGE_OPTIONS } from "@/features/daily/materialReceivingInspection";
import { canShowDailyApproveReject } from "@/app/daily/dailyLogPermissions";

type LogHeader = {
  id: string;
  received_at: string;
  author_name: string | null;
  status: string;
  approved_at: string | null;
  approved_by_name: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  corrective_datetime: string | null;
  corrective_deviation: string | null;
  corrective_detail: string | null;
  corrective_remarks: string | null;
  corrective_actor: string | null;
  created_at: string;
};

type LogItem = {
  id: string;
  line_index: number;
  storage_category: string;
  item_name: string;
  box_qty: number | null;
  unit_qty: number | null;
  remainder_g: number | null;
  box_weight_g: number | null;
  unit_weight_g: number | null;
  total_weight_g: number | null;
  expiry_or_lot: string | null;
  label_photo_url: string | null;
  conformity: string;
  remarks: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatDt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function categoryLabel(key: string): string {
  return RECEIVING_STORAGE_OPTIONS.find((o) => o.value === key)?.label ?? key;
}

function conformityLabel(v: string): string {
  if (v === "O") return "적합";
  if (v === "X") return "부적합";
  return "—";
}

/** 포대형 원료 판정(현재 코드에 전용 플래그가 없어 item_name 기반으로만 임시 판정) */
function isPouchLikeMaterial(name: string): boolean {
  return (name ?? "").includes("밀가루");
}

export default function DailyMaterialReceivingInspectionViewPage() {
  const router = useRouter();
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";
  const { user, profile } = useAuth();
  const [header, setHeader] = useState<LogHeader | null>(null);
  const [items, setItems] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReasonInput, setRejectReasonInput] = useState("");

  const canApproveReject = canShowDailyApproveReject(profile?.role, header?.status);
  const approverName = (profile?.display_name ?? "").trim() || (profile?.login_id ?? "").trim();

  const load = useCallback(async () => {
    if (!id) {
      setError("일지 ID가 없습니다.");
      setLoading(false);
      return;
    }
    if (id.toLowerCase() === "new") {
      router.replace("/daily/material-receiving-inspection/new");
      setLoading(false);
      return;
    }
    if (!UUID_RE.test(id)) {
      setError("잘못된 일지 ID입니다.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data: logData, error: logErr } = await supabase
      .from("daily_material_receiving_inspection_logs")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (logErr) {
      setError(logErr.message);
      setHeader(null);
      setItems([]);
      setLoading(false);
      return;
    }
    if (!logData) {
      setError("해당 일지를 찾을 수 없습니다.");
      setHeader(null);
      setItems([]);
      setLoading(false);
      return;
    }
    setHeader(logData as LogHeader);
    const { data: itemsData, error: itemsErr } = await supabase
      .from("daily_material_receiving_inspection_log_items")
      .select("*")
      .eq("log_id", id)
      .order("line_index", { ascending: true });
    if (itemsErr) setItems([]);
    else setItems((itemsData ?? []) as LogItem[]);
    setLoading(false);
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-3xl mx-auto">
        <p className="text-slate-500 text-sm">불러오는 중…</p>
      </div>
    );
  }
  if (error || !header) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-3xl mx-auto">
        <p className="text-red-400 text-sm mb-4">{error ?? "데이터 없음"}</p>
        <Link href="/daily/material-receiving-inspection" className="text-cyan-400 hover:text-cyan-300 text-sm">
          목록으로
        </Link>
      </div>
    );
  }

  const hasCorrective =
    header.corrective_datetime ||
    header.corrective_deviation ||
    header.corrective_detail ||
    header.corrective_remarks ||
    header.corrective_actor;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-3xl mx-auto pb-20 md:pb-6">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/daily" className="text-slate-400 hover:text-slate-200 text-sm">
          데일리
        </Link>
        <span className="text-slate-600">/</span>
        <Link href="/daily/material-receiving-inspection" className="text-cyan-400 hover:text-cyan-300 text-sm">
          원료 입고 검수일지
        </Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">{formatDt(header.received_at)}</span>
      </div>
      <h1 className="text-lg font-semibold text-slate-100 mb-1">원료 입고 검수일지</h1>
      <p className="text-slate-500 text-sm mb-4">
        반입일시: {formatDt(header.received_at)}
        {header.author_name ? ` · 반입자: ${header.author_name}` : ""}
      </p>

      <div className="space-y-4 mb-8">
        {items.length === 0 ? (
          <p className="text-slate-500 text-sm">등록된 품목이 없습니다.</p>
        ) : (
          items.map((row) => (
            <section
              key={row.id}
              className="rounded-xl border border-slate-700/60 bg-slate-800/50 p-4 space-y-2 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-cyan-300">품목 {row.line_index}</span>
                <span className="text-slate-400">{categoryLabel(row.storage_category)}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded font-medium ${
                    row.conformity === "O"
                      ? "bg-emerald-900/50 text-emerald-300"
                      : row.conformity === "X"
                        ? "bg-amber-900/50 text-amber-300"
                        : "bg-slate-700/50 text-slate-500"
                  }`}
                >
                  {conformityLabel(row.conformity)}
                </span>
              </div>
              <p className="text-slate-200 font-medium">{row.item_name}</p>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                <dt className="text-slate-500">박스</dt>
                <dd className="text-slate-300 col-span-1">{row.box_qty ?? "—"}</dd>
                <dt className="text-slate-500">
                  {isPouchLikeMaterial(row.item_name) ? "낱개(포대)" : "낱개"}
                </dt>
                <dd className="text-slate-300 col-span-1">{row.unit_qty ?? "—"}</dd>
                <dt className="text-slate-500">잔량(g)</dt>
                <dd className="text-slate-300 col-span-1">{row.remainder_g ?? "—"}</dd>
                <dt className="text-slate-500">총중량(g)</dt>
                <dd className="text-slate-300 col-span-1">
                  {row.total_weight_g != null
                    ? row.total_weight_g.toLocaleString("ko-KR", { maximumFractionDigits: 1 })
                    : "—"}
                </dd>
                <dt className="text-slate-500 col-span-2 sm:col-span-1">소비기한/LOT/제조일자</dt>
                <dd className="text-slate-300 col-span-2 sm:col-span-2">{row.expiry_or_lot ?? "—"}</dd>
              </dl>
              {row.remarks && (
                <p className="text-slate-400 text-xs whitespace-pre-wrap">비고: {row.remarks}</p>
              )}
              {row.label_photo_url && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">표시사항 사진</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={row.label_photo_url}
                    alt="표시사항"
                    className="max-h-40 rounded border border-slate-600"
                  />
                </div>
              )}
            </section>
          ))
        )}
      </div>

      {hasCorrective && (
        <section className="rounded-xl border border-amber-700/50 bg-slate-800/50 p-4 mb-8">
          <h2 className="text-sm font-semibold text-amber-300 mb-4">개선조치</h2>
          <dl className="grid gap-3 text-sm">
            {header.corrective_datetime && (
              <>
                <dt className="text-slate-500">일시</dt>
                <dd className="text-slate-200">{formatDt(header.corrective_datetime)}</dd>
              </>
            )}
            {header.corrective_deviation && (
              <>
                <dt className="text-slate-500">이탈내용</dt>
                <dd className="text-slate-200 whitespace-pre-wrap">{header.corrective_deviation}</dd>
              </>
            )}
            {header.corrective_detail && (
              <>
                <dt className="text-slate-500">개선조치내용</dt>
                <dd className="text-slate-200 whitespace-pre-wrap">{header.corrective_detail}</dd>
              </>
            )}
            {header.corrective_remarks && (
              <>
                <dt className="text-slate-500">비고</dt>
                <dd className="text-slate-200 whitespace-pre-wrap">{header.corrective_remarks}</dd>
              </>
            )}
            {header.corrective_actor && (
              <>
                <dt className="text-slate-500">개선조치자</dt>
                <dd className="text-slate-200">{header.corrective_actor}</dd>
              </>
            )}
          </dl>
        </section>
      )}

      {canApproveReject && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            type="button"
            onClick={async () => {
              setActionLoading(true);
              const { error: err } = await supabase
                .from("daily_material_receiving_inspection_logs")
                .update({
                  status: "approved",
                  approved_at: new Date().toISOString(),
                  approved_by: user?.id ?? null,
                  approved_by_name: approverName || null,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", id);
              setActionLoading(false);
              if (err) setError(err.message);
              else load();
            }}
            disabled={actionLoading}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium"
          >
            {actionLoading ? "처리 중…" : "승인"}
          </button>
          <button
            type="button"
            onClick={() => {
              setRejectReasonInput("");
              setRejectModalOpen(true);
            }}
            disabled={actionLoading}
            className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium"
          >
            반려
          </button>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 mb-6">
        <Link
          href={`/daily/material-receiving-inspection/${id}/edit`}
          className="px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 text-white text-sm font-medium"
        >
          수정
        </Link>
        <button
          type="button"
          onClick={async () => {
            if (!window.confirm("이 일지를 삭제할까요?")) return;
            setActionLoading(true);
            const { error: err } = await supabase
              .from("daily_material_receiving_inspection_logs")
              .delete()
              .eq("id", id);
            setActionLoading(false);
            if (err) setError(err.message);
            else router.push("/daily/material-receiving-inspection");
          }}
          disabled={actionLoading}
          className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium"
        >
          삭제
        </button>
      </div>

      {rejectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-slate-800 rounded-xl border border-slate-600 shadow-xl max-w-md w-full p-4">
            <h3 className="text-sm font-semibold text-slate-200 mb-2">반려 사유 (선택)</h3>
            <textarea
              value={rejectReasonInput}
              onChange={(e) => setRejectReasonInput(e.target.value)}
              rows={3}
              placeholder="반려 사유를 입력하세요."
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-slate-100 text-sm resize-none mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm"
              >
                취소
              </button>
              <button
                type="button"
                onClick={async () => {
                  setActionLoading(true);
                  const { error: err } = await supabase
                    .from("daily_material_receiving_inspection_logs")
                    .update({
                      status: "rejected",
                      rejected_at: new Date().toISOString(),
                      rejected_by: user?.id ?? null,
                      reject_reason: rejectReasonInput.trim() || null,
                      updated_at: new Date().toISOString(),
                    })
                    .eq("id", id);
                  setActionLoading(false);
                  setRejectModalOpen(false);
                  if (err) setError(err.message);
                  else load();
                }}
                disabled={actionLoading}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium"
              >
                반려하기
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Link
          href="/daily/material-receiving-inspection"
          className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm"
        >
          목록으로
        </Link>
      </div>
    </div>
  );
}
