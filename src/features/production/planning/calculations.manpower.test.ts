import { describe, expect, it } from "vitest";
import { computeProcessedRows } from "./calculations";

describe("computeProcessedRows manpower", () => {
  it("투입 인원은 총원에서 그날 연차·반차·기타를 뺀다", () => {
    const rows = computeProcessedRows({
      totalMembers: 20,
      entries: [
        {
          id: 1,
          month_id: "m",
          plan_date: "2026-09-04",
          product_name_snapshot: "마르게리따 - 일반",
          qty: 100,
          sort_order: 0,
        },
      ],
      notes: [],
      manpowerRows: [
        {
          id: 1,
          month_id: "m",
          plan_date: "2026-09-04",
          annual_leave_count: 2,
          half_day_count: 1,
          other_count: 1,
          actual_manpower: 99,
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].manpower).toBe(16.5);
  });

  it("휴무 기록이 없으면 총원을 투입 인원으로 쓴다", () => {
    const rows = computeProcessedRows({
      totalMembers: 20,
      entries: [
        {
          id: 1,
          month_id: "m",
          plan_date: "2026-09-04",
          product_name_snapshot: "마르게리따 - 일반",
          qty: 100,
          sort_order: 0,
        },
      ],
      notes: [],
      manpowerRows: [],
    });
    expect(rows[0].manpower).toBe(20);
  });
});
