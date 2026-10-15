import { NextResponse } from "next/server";
import { assembleExport, assertBundleCounts } from "@/features/haccpExport/assemble";
import { isFloorValue, type FloorValue } from "@/features/haccpExport/floor";
import { HaccpExportError, assertDateRange, resolveLogKeys } from "@/features/haccpExport/load";
import { buildFloorWorkbook, buildFullWorkbook } from "@/features/haccpExport/workbook";
import { requireHaccpExportAdmin } from "@/app/api/admin/haccp-export/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

type Body = {
  from?: string;
  to?: string;
  logKeys?: string[];
  mode?: "full" | "floor";
  floors?: string[];
};

export async function POST(request: Request) {
  const auth = await requireHaccpExportAdmin(request);
  if (!auth.ok) return auth.response;
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문", verified: false }, { status: 400 });
  }

  try {
    const from = String(body.from ?? "");
    const to = String(body.to ?? "");
    assertDateRange(from, to);
    const specs = resolveLogKeys(body.logKeys ?? []);
    const mode = body.mode === "floor" ? "floor" : "full";
    const floors = (body.floors ?? []).filter(isFloorValue) as FloorValue[];
    const bundle = await assembleExport(auth.supabase, specs, from, to, { checkPhotos: mode === "full" });
    const counts = assertBundleCounts(bundle);
    const built =
      mode === "floor" ? await buildFloorWorkbook(bundle, floors) : await buildFullWorkbook(bundle);
    if (built.headerTotal !== counts.headerTotal || built.itemTotal !== counts.itemTotal) {
      return NextResponse.json(
        { error: "DB 건수와 파일 건수가 일치하지 않습니다.", verified: false },
        { status: 500 }
      );
    }
    const filename = mode === "floor" ? `HACCP-floor-${from}-${to}.xlsx` : `HACCP-original-${from}-${to}.xlsx`;
    return new NextResponse(new Uint8Array(built.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Haccp-Db-Headers": String(counts.headerTotal),
        "X-Haccp-Excel-Headers": String(built.headerTotal),
        "X-Haccp-Db-Items": String(counts.itemTotal),
        "X-Haccp-Excel-Items": String(built.itemTotal),
        "X-Haccp-Verified": "1",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "엑셀 추출 실패";
    const status = error instanceof HaccpExportError ? error.status : 500;
    return NextResponse.json({ error: message, verified: false }, { status });
  }
}
