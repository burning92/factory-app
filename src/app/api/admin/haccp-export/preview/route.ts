import { NextResponse } from "next/server";
import { HACCP_LOGS } from "@/features/haccpExport/catalog";
import { assembleExport, headerAuditCount, tallyFloors } from "@/features/haccpExport/assemble";
import { approvalConsistencyLabel, AUDIT_MISSING_LABEL, auditTraceLabel, authorCompareLabel } from "@/features/haccpExport/flags";
import { assertDateRange, HaccpExportError, resolveLogKeys } from "@/features/haccpExport/load";
import { requireHaccpExportAdmin } from "@/app/api/admin/haccp-export/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

type Body = { from?: string; to?: string; logKeys?: string[] };

export async function POST(request: Request) {
  const auth = await requireHaccpExportAdmin(request);
  if (!auth.ok) return auth.response;
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문" }, { status: 400 });
  }
  try {
    const from = String(body.from ?? "");
    const to = String(body.to ?? "");
    assertDateRange(from, to);
    const specs = resolveLogKeys(body.logKeys ?? []);
    const bundle = await assembleExport(auth.supabase, specs, from, to, { checkPhotos: false });
    let authorException = 0;
    let approvalException = 0;
    let auditMissing = 0;
    const logs = bundle.logs.map((log) => {
      for (const row of log.headers) {
        const userId = row[log.spec.authorUserColumn];
        const profile = userId ? bundle.profiles.get(String(userId)) : undefined;
        const approver = row.approved_by ? bundle.profiles.get(String(row.approved_by)) : undefined;
        if (authorCompareLabel(row[log.spec.authorNameColumn], userId, profile) !== "일치") authorException += 1;
        const approval = approvalConsistencyLabel(row, approver);
        if (approval !== "정합" && approval !== "해당 없음") approvalException += 1;
        if (auditTraceLabel(headerAuditCount(log, String(row.id), bundle.audits)) === AUDIT_MISSING_LABEL) auditMissing += 1;
      }
      const floors = tallyFloors(log);
      return {
        key: log.spec.key,
        label: log.spec.label,
        headers: log.headers.length,
        items: log.items.length,
        nullRecordDates: log.nullDateCount,
        floors,
      };
    });
    const headerTotal = logs.reduce((sum, log) => sum + log.headers, 0);
    const itemTotal = logs.reduce((sum, log) => sum + log.items, 0);
    return NextResponse.json({
      from,
      to,
      generatedAt: bundle.generatedAt,
      availableLogs: HACCP_LOGS.map((log) => ({ key: log.key, label: log.label })),
      headerTotal,
      itemTotal,
      authorException,
      approvalException,
      auditMissing,
      org000Count: bundle.org000.length,
      logs,
      verified: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "건수 조회 실패";
    const status = error instanceof HaccpExportError ? error.status : 500;
    return NextResponse.json({ error: message, verified: false }, { status });
  }
}
