import { describe, expect, it } from "vitest";
import { getDailyLogAccess, getDailyLogAccessOrNew } from "./dailyLogPermissions";
import { assertDailyLogWritable, diffDailyLogHeader, withdrawDailyLogSubmission } from "@/features/daily/logWorkflow";
import type { SupabaseClient } from "@supabase/supabase-js";

const WORKER = "u-worker";
const OTHER = "u-other";
const ADMIN = "u-admin";

const log = (status: string, extra: Record<string, unknown> = {}) => ({
  status,
  author_user_id: WORKER,
  submitted_by: null as string | null,
  submitted_at: null as string | null,
  ...extra,
});

type Who = { label: string; id: string; role: string };
const worker: Who = { label: "작성자(작업자)", id: WORKER, role: "worker" };
const other: Who = { label: "다른 작업자", id: OTHER, role: "worker" };
const manager: Who = { label: "다른 매니저", id: OTHER, role: "manager" };
const admin: Who = { label: "관리자", id: ADMIN, role: "admin" };
const qm: Who = { label: "품질팀장", id: ADMIN, role: "quality_manager" };

describe("작업자·관리자별 화면 권한", () => {
  const cases: Array<[string, Record<string, unknown>, Who, Partial<Record<string, boolean>>]> = [
    ["작성 중", log("draft"), worker, { canEdit: true, canSubmit: true, canDelete: true, canWithdraw: false, canRequestCorrection: false }],
    ["작성 중", log("draft"), other, { canEdit: false, canSubmit: false, canDelete: false }],
    ["작성 중", log("draft"), manager, { canEdit: false, canDelete: false }],
    ["작성 중", log("draft"), admin, { canEdit: true, canDelete: true }],
    ["작성 중", log("draft"), qm, { canEdit: true, canDelete: true }],
    ["회수한 일지(제출 이력)", log("draft", { submitted_at: "2026-10-15T00:00:00Z", submitted_by: WORKER }), worker, { canEdit: true, canDelete: false }],
    ["제출", log("submitted", { submitted_by: WORKER, submitted_at: "x" }), worker, { canEdit: false, canWithdraw: true, canDelete: false, canApproveReject: false }],
    ["제출", log("submitted", { submitted_by: WORKER, submitted_at: "x" }), other, { canEdit: false, canWithdraw: false }],
    ["제출", log("submitted", { submitted_by: WORKER, submitted_at: "x" }), admin, { canEdit: false, canWithdraw: true, canApproveReject: true }],
    ["반려", log("rejected", { submitted_at: "x" }), worker, { canEdit: true, canSubmit: true, canDelete: false }],
    ["반려", log("rejected", { submitted_at: "x" }), other, { canEdit: false }],
    ["승인", log("approved", { submitted_at: "x" }), worker, { canEdit: false, canDelete: false, canWithdraw: false, canRequestCorrection: false }],
    ["승인", log("approved", { submitted_at: "x" }), manager, { canEdit: false, canRequestCorrection: false }],
    ["승인", log("approved", { submitted_at: "x" }), admin, { canEdit: false, canDelete: false, canRequestCorrection: true }],
    ["승인", log("approved", { submitted_at: "x" }), qm, { canEdit: false, canRequestCorrection: true }],
  ];

  for (const [state, row, who, expected] of cases) {
    it(`${state} · ${who.label}`, () => {
      const access = getDailyLogAccess(row, who.id, who.role);
      for (const [key, value] of Object.entries(expected)) {
        expect(access[key as keyof typeof access], key).toBe(value);
      }
    });
  }

  it("작성자 기록이 없으면 제출자를 작성자로 본다", () => {
    const row = { status: "rejected", author_user_id: null, submitted_by: WORKER, submitted_at: "x" };
    expect(getDailyLogAccess(row, WORKER, "worker").canEdit).toBe(true);
    expect(getDailyLogAccess(row, OTHER, "worker").canEdit).toBe(false);
  });

  it("작성자·제출자 모두 없는 기존 일지는 관리자급만", () => {
    const row = { status: "draft", author_user_id: null, submitted_by: null, submitted_at: null };
    expect(getDailyLogAccess(row, WORKER, "worker").canEdit).toBe(false);
    expect(getDailyLogAccess(row, WORKER, "worker").lockReason).toContain("작성자 기록이 없는");
    expect(getDailyLogAccess(row, ADMIN, "admin").canEdit).toBe(true);
  });

  it("작성자 컬럼이 아직 없는 표(096000 전 조도 일지)는 작성자 제한 없음", () => {
    const row = { status: "draft", submitted_by: null, submitted_at: null };
    expect(getDailyLogAccess(row, WORKER, "worker").canEdit).toBe(true);
  });

  it("잠금 안내 문구", () => {
    expect(getDailyLogAccess(log("approved"), WORKER, "worker").lockReason).toContain("정정 요청");
    expect(getDailyLogAccess(log("submitted"), WORKER, "worker").lockReason).toContain("제출 회수");
    expect(getDailyLogAccess(log("draft"), OTHER, "worker").lockReason).toContain("다른 사람");
    expect(getDailyLogAccess(log("draft"), WORKER, "worker").lockReason).toBeNull();
  });

  it("새 일지는 누구나 작성", () => {
    const access = getDailyLogAccessOrNew(null, WORKER, "worker");
    expect(access.canEdit && access.canSubmit).toBe(true);
    expect(access.canDelete || access.canWithdraw).toBe(false);
  });
});

function fakeClient(row: Record<string, unknown> | null, updated: unknown[] = [{ id: "L1" }]) {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "eq", "update"]) {
    chain[name] = (...args: unknown[]) => {
      calls.push({ op: name, args });
      return chain;
    };
  }
  chain.maybeSingle = async () => ({ data: row, error: null });
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: updated, error: null });
  const client = { from: () => chain } as unknown as SupabaseClient;
  return { client, calls };
}

describe("저장·제출 직전 권한 재확인", () => {
  it("승인된 일지 저장 차단", async () => {
    const { client } = fakeClient(log("approved"));
    await expect(assertDailyLogWritable(client, "t", "L1", WORKER, "worker")).rejects.toThrow("승인 완료");
  });

  it("남의 작성 중 일지 저장 차단", async () => {
    const { client } = fakeClient(log("draft"));
    await expect(assertDailyLogWritable(client, "t", "L1", OTHER, "worker")).rejects.toThrow("다른 사람");
  });

  it("본인 작성 중 일지 저장 허용", async () => {
    const { client } = fakeClient(log("draft"));
    await expect(assertDailyLogWritable(client, "t", "L1", WORKER, "worker")).resolves.toBeUndefined();
  });

  it("제출 회수는 제출 상태인 행만 바꾼다", async () => {
    const { client, calls } = fakeClient(null);
    await withdrawDailyLogSubmission(client, "t", "L1");
    expect(calls).toContainEqual({ op: "eq", args: ["status", "submitted"] });
    expect(calls.find((c) => c.op === "update")?.args[0]).toMatchObject({ status: "draft" });
  });

  it("회수 대상이 없으면(이미 승인 등) 오류", async () => {
    const { client } = fakeClient(null, []);
    await expect(withdrawDailyLogSubmission(client, "t", "L1")).rejects.toThrow("회수하지 못했습니다");
  });
});

describe("정정 전후 비교", () => {
  it("내용 차이만 보여주고 제출·승인 흐름 컬럼은 뺀다", () => {
    const before = { id: "L1", status: "approved", approved_at: "a", remarks: "전", temp: 3, updated_at: "1" };
    const current = { id: "L1", status: "submitted", approved_at: null, remarks: "후", temp: 3, updated_at: "2" };
    expect(diffDailyLogHeader(before, current)).toEqual([{ column: "remarks", before: "전", after: "후" }]);
  });

  it("정정 전 기록이 없으면 빈 목록", () => {
    expect(diffDailyLogHeader(null, { a: 1 })).toEqual([]);
  });
});
