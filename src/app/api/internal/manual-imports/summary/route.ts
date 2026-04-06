import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

type DateQtyMap = Record<string, number>;

function toDateQtyMap(filePath: string): DateQtyMap {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return {};
  const out: DateQtyMap = {};
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const row = JSON.parse(s) as { date?: string; qty?: unknown };
      const date = String(row.date ?? "").slice(0, 10);
      const qty = Number(row.qty);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(qty)) continue;
      out[date] = (out[date] ?? 0) + qty;
    } catch {
      // malformed line is ignored intentionally
    }
  }
  return out;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "invalid year" }, { status: 400 });
  }

  const dir = path.join(process.cwd(), "data", "manual-imports");
  const doughProductionByDate = toDateQtyMap(path.join(dir, `${year}-dough-production.jsonl`));
  const doughWasteByDate = toDateQtyMap(path.join(dir, `${year}-waste-dough.jsonl`));
  const parbakeWasteByDate = toDateQtyMap(path.join(dir, `${year}-waste-parbake.jsonl`));

  return NextResponse.json({
    year,
    doughProductionByDate,
    doughWasteByDate,
    parbakeWasteByDate,
  });
}
