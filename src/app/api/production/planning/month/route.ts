import { NextRequest, NextResponse } from "next/server";
import { getPlanningMonthData } from "@/features/production/planning/getPlanningMonthData";
import type { PlanningVersionType } from "@/features/production/planning/types";

function toVersion(v: string | null): PlanningVersionType {
  if (v === "draft") return "draft";
  if (v === "end") return "end";
  return "master";
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const year = Number(sp.get("year"));
  const month = Number(sp.get("month"));
  const version = toVersion(sp.get("version"));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "year/month query is required" }, { status: 400 });
  }
  try {
    const data = await getPlanningMonthData(year, month, version);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "failed_to_load_month", message }, { status: 500 });
  }
}
