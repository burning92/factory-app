import { describe, expect, it } from "vitest";
import { isAvailableInPeriod, restStationFor } from "./planningLeave";
import { SHIFT_OPTIONS, parseWorkWindow, periodProduces, worksDuringPeriod } from "./workHours";
import { PERIODS, type PeriodId, type Person } from "./types";

function person(shift: string, extra?: Partial<Person>): Person {
  return {
    id: "p",
    name: "p",
    preferred: "inner",
    shift,
    group: "floor",
    present: true,
    ...extra,
  };
}

describe("근무조 파싱", () => {
  it("HHMM과 HH:MM을 모두 읽는다", () => {
    expect(parseWorkWindow("0800-1800")).toEqual({ startMin: 480, endMin: 1080 });
    expect(parseWorkWindow("06:00-15:30")).toEqual({ startMin: 360, endMin: 930 });
  });

  it("못 읽는 값은 08–18로 본다", () => {
    expect(parseWorkWindow(undefined)).toEqual({ startMin: 480, endMin: 1080 });
    expect(parseWorkWindow("주간")).toEqual({ startMin: 480, endMin: 1080 });
  });
});

describe("구간 근무 판정", () => {
  const day: PeriodId[] = ["early", "start", "lunch1", "lunch2", "after", "late", "evening", "closing"];

  it("08–18조는 18~19에 빠지고 09–19조는 08~09에 빠진다", () => {
    const early = parseWorkWindow("0800-1800");
    const late = parseWorkWindow("0900-1900");
    expect(day.filter((p) => worksDuringPeriod(early, p))).toEqual(day.filter((p) => p !== "closing"));
    expect(day.filter((p) => worksDuringPeriod(late, p))).toEqual(day.filter((p) => p !== "early"));
  });

  it("06–15:30조는 15:30 이후 구간에서 빠진다", () => {
    const dawn = parseWorkWindow("0600-1530");
    expect(worksDuringPeriod(dawn, "after")).toBe(true);
    expect(worksDuringPeriod(dawn, "late")).toBe(false);
  });

  it("08–17조는 15:30~17에는 남고 17시 이후에는 빠진다", () => {
    const untilFive = parseWorkWindow("0800-1700");
    expect(worksDuringPeriod(untilFive, "late")).toBe(true);
    expect(worksDuringPeriod(untilFive, "evening")).toBe(false);
    expect(worksDuringPeriod(untilFive, "closing")).toBe(false);
  });

  it("근무조 목록의 퇴근 시각은 모두 구간 경계와 맞는다", () => {
    // 경계에 없는 퇴근 시각이 있으면 그 사람이 남은 구간까지 근무하는 것처럼 보인다
    const boundaries = new Set<number>(PERIODS.flatMap((p) => [p.startMin, p.endMin]));
    for (const option of SHIFT_OPTIONS) {
      const window = parseWorkWindow(option.id);
      expect({ shift: option.id, end: boundaries.has(window.endMin) }).toEqual({ shift: option.id, end: true });
    }
  });

  it("마감 구간만 정상 생산이 아니다", () => {
    expect(day.filter((p) => !periodProduces(p))).toEqual(["closing"]);
  });
});

describe("근무조와 연차·반차", () => {
  it("반차는 근무조 안에서만 적용된다", () => {
    const halfPm = person("0800-1800", { leaveKind: "half_pm" });
    expect(isAvailableInPeriod(halfPm, "early")).toBe(false);
    expect(isAvailableInPeriod(halfPm, "after")).toBe(true);
    expect(isAvailableInPeriod(halfPm, "late")).toBe(true);
    expect(isAvailableInPeriod(halfPm, "closing")).toBe(false);
  });

  it("연차는 휴무, 근무조 밖은 근무 외로 나눈다", () => {
    expect(restStationFor(person("0800-1800", { leaveKind: "annual" }), "start")).toBe("off");
    expect(restStationFor(person("0800-1800"), "closing")).toBe("outside");
    expect(restStationFor(person("0900-1900"), "early")).toBe("outside");
    expect(restStationFor(person("0900-1900"), "closing")).toBeNull();
  });
});
