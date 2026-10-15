import { describe, expect, it } from "vitest";
import { detectFloorFromColumn, detectFloorFromRecord } from "@/features/haccpExport/floor";
import { approvalConsistencyLabel, authorCompareLabel, AUDIT_MISSING_LABEL, auditTraceLabel } from "@/features/haccpExport/flags";
import { EMPTY_STRING_MARK, formatKstDisplay, kstDayEndExclusiveIso, toExcelValue } from "@/features/haccpExport/values";

describe("excel cell values", () => {
  it("keeps null and empty string apart", () => {
    expect(toExcelValue(null)).toBeNull();
    expect(toExcelValue(undefined)).toBeNull();
    expect(toExcelValue("")).toBe(EMPTY_STRING_MARK);
    expect(toExcelValue("O")).toBe("O");
  });

  it("formats timestamptz for display without replacing the source", () => {
    expect(formatKstDisplay("2026-10-14T02:14:34.000Z")).toBe("2026-10-14T11:14:34.000+09:00");
    expect(kstDayEndExclusiveIso("2026-10-14")).toBe("2026-10-15T00:00:00+09:00");
  });
});

describe("floor detection", () => {
  it("uses an explicit floor token and does not guess", () => {
    expect(detectFloorFromRecord({ category: "3층 가열실", question_text: "작동" })).toBe("3층");
    expect(detectFloorFromRecord({ category: "가열실", question_text: "터널오븐" })).toBeNull();
    expect(detectFloorFromRecord({ category: "1층과 3층" })).toBeNull();
    expect(detectFloorFromColumn("am_temp_floor3_aging_c")).toBe("3층");
    expect(detectFloorFromColumn("am_temp_blast_freezer_1_c")).toBeNull();
    expect(detectFloorFromColumn("am_temp_dough_aging_c")).toBeNull();
  });
});

describe("record flags", () => {
  it("flags author and approval mismatches without rewriting names", () => {
    expect(authorCompareLabel("홍길동", "u1", { display_name: "홍길동", login_id: "a", organization_code: "100", organization_name: "본사" })).toBe("일치");
    expect(authorCompareLabel("관리자", "u1", { display_name: "김품질", login_id: "a", organization_code: "100", organization_name: "본사" })).toBe("불일치");
    expect(authorCompareLabel(null, "u1", { display_name: "홍길동", login_id: "a", organization_code: "100", organization_name: "본사" })).toBe("기록상 이름 NULL");
    expect(authorCompareLabel("", null, undefined)).toBe("기록상 이름 빈 문자열, 작성 계정 없음");
    expect(approvalConsistencyLabel({ status: "approved", approved_at: "2026-10-14T00:00:00Z", approved_by: "u1", approved_by_name: "김품질" }, { display_name: "김품질", login_id: "c", organization_code: "100", organization_name: "본사" })).toBe("정합");
    expect(approvalConsistencyLabel({ status: "approved", approved_at: null, approved_by: null, approved_by_name: null }, undefined)).toContain("승인시각 없음");
    expect(auditTraceLabel(0)).toBe(AUDIT_MISSING_LABEL);
    expect(auditTraceLabel(2)).toBe("연결 이력 2건");
  });
});
