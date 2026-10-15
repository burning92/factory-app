import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { HACCP_LOGS } from "@/features/haccpExport/catalog";
import { addKstDays } from "@/features/haccpExport/values";
import { buildAuditDayBackup, buildMonthBackup, canonicalJson, checkAuditChain, md5Hex, sha256Hex } from "@/features/haccpArchive/backup";
import { buildEquipmentFloorIndex } from "@/features/haccpArchive/floors";
import { checkPermissions, ensureFolders, ensureSubfolder, verifyFolderPermissions, type ArchiveFolders, type FolderConfig } from "@/features/haccpArchive/folders";
import type { DriveApi } from "@/features/haccpArchive/google/drive";
import type { SheetsApi } from "@/features/haccpArchive/google/sheets";
import { migratePhotos, type PhotoRunResult } from "@/features/haccpArchive/photos";
import type { CreateAudit } from "@/features/haccpArchive/provenance";
import { buildMonthTabs, formatKst, type LogBundle, type Tab } from "@/features/haccpArchive/sheetModel";
import { writeTabs } from "@/features/haccpArchive/sheetWriter";
import { kstToday, monthsBetween, type ArchiveSource } from "@/features/haccpArchive/source";
import { StateStore, type ArchiveState, type RunRecord } from "@/features/haccpArchive/state";

export type RunnerLimits = { monthsPerRun: number; photosPerRun: number; auditDaysPerRun: number };
export const DEFAULT_LIMITS: RunnerLimits = { monthsPerRun: 2, photosPerRun: 10, auditDaysPerRun: 7 };

export type RunSummary = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  months: { month: string; ok: boolean; rows?: number; headers?: number; items?: number; backup?: "new" | "same"; error?: string }[];
  pendingMonths: string[];
  photos: PhotoRunResult | null;
  auditDays: { day: string; rows: number; chainOk: boolean; reused: boolean }[];
  corrections: "new" | "same" | "skipped";
  warnings: string[];
  error?: string;
};

const JSON_MIME = "application/json";
const LOCK_STALE_MS = 2 * 60 * 60 * 1000;

export async function withFileLock<T>(name: string, fn: () => Promise<T>): Promise<T | "locked"> {
  const file = path.join(os.tmpdir(), name);
  try {
    const stat = await fs.stat(file);
    if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) await fs.rm(file, { force: true });
  } catch {
    // 잠금 파일 없음
  }
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(file, "wx");
  } catch {
    return "locked";
  }
  try {
    await handle.writeFile(`${process.pid} ${new Date().toISOString()}`);
    await handle.close();
    return await fn();
  } finally {
    await fs.rm(file, { force: true });
  }
}

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

async function uploadVerifiedJson(
  drive: DriveApi,
  parentId: string,
  name: string,
  body: string,
  appProperties: Record<string, string>,
  lockReason: string
): Promise<string> {
  const data = Buffer.from(body, "utf8");
  const uploaded = await drive.uploadFile({ parentId, name, mimeType: JSON_MIME, data, appProperties });
  const file = await drive.getFile(uploaded.id);
  if (file.md5Checksum !== md5Hex(data) || Number(file.size) !== data.length) {
    throw new Error(`${name} 업로드 검증 실패`);
  }
  await drive.restrictSharing(file.id, true);
  await drive.lockReadOnly(file.id, lockReason);
  return file.id;
}

export class ArchiveRunner {
  constructor(
    private readonly deps: {
      source: ArchiveSource;
      drive: DriveApi;
      sheets: SheetsApi;
      folders: FolderConfig;
      limits?: Partial<RunnerLimits>;
      now?: () => Date;
    }
  ) {}

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  async run(): Promise<RunSummary> {
    const { source, drive, sheets } = this.deps;
    const limits = { ...DEFAULT_LIMITS, ...this.deps.limits };
    const startedAt = this.now().toISOString();
    const summary: RunSummary = { ok: false, startedAt, finishedAt: "", months: [], pendingMonths: [], photos: null, auditDays: [], corrections: "skipped", warnings: [] };

    const folders = await ensureFolders(drive, this.deps.folders);
    const perms = await verifyFolderPermissions(drive, folders);
    if (!perms.ok) {
      summary.error = `공개·공유 설정 때문에 중단했습니다: ${perms.problems.join("; ")}`;
      summary.finishedAt = this.now().toISOString();
      return summary;
    }
    summary.warnings.push(...perms.warnings);
    const store = new StateStore(drive, folders.status);
    const state = await store.load();
    let failed = false;

    try {
      // 사진을 먼저 옮겨야 이번 실행에서 만드는 시트에 링크가 들어간다
      summary.photos = await migratePhotos({
        source,
        drive,
        photosFolderId: folders.photos,
        state,
        limit: limits.photosPerRun,
        now: () => this.now().toISOString(),
      });
      if (summary.photos.failed.length > 0) summary.warnings.push(`사진 ${summary.photos.failed.length}건 보관 실패(다음 실행에서 재시도)`);
      await store.save(state);

      const today = kstToday(this.now());
      const current = today.slice(0, 7);
      const target = new Set<string>([current]);
      if (Number(today.slice(8, 10)) <= 5) target.add(prevMonth(current));

      if (state.pendingMonths === null) {
        const earliest = await source.earliestMonth();
        state.pendingMonths = earliest && earliest < current ? monthsBetween(earliest, prevMonth(current)) : [];
      }
      if (state.lastSuccessAt) {
        const since = new Date(new Date(state.lastSuccessAt).getTime() - 10 * 60 * 1000).toISOString();
        for (const m of Array.from(await source.changedMonthsSince(since))) if (m <= current) target.add(m);
      }
      for (const m of state.pendingMonths.filter((m) => !target.has(m)).slice(0, limits.monthsPerRun)) target.add(m);

      const profiles = await source.loadProfiles();
      const equipment = buildEquipmentFloorIndex(await source.loadEquipment());
      const corrections = await source.loadCorrections();
      const deletes = await source.loadHeaderDeletes();
      const photoMap = new Map(Object.entries(state.photos));

      for (const month of Array.from(target).sort()) {
        try {
          const logs: LogBundle[] = [];
          const createAudits = new Map<string, CreateAudit>();
          for (const spec of HACCP_LOGS) {
            const { headers, items } = await source.loadMonth(spec, month);
            logs.push({ spec, headers, items });
            const found = await source.loadCreateAudits(spec.headerTable, headers.map((h) => String(h.id)));
            found.forEach((v, k) => createAudits.set(k, v));
          }
          const receiving = logs.find((l) => l.spec.photoColumn && l.spec.itemTable);
          const photoPresent = receiving
            ? await source.photoPresentIds(receiving.spec.itemTable!, receiving.spec.photoColumn!, receiving.items.map((i) => String(i.id)))
            : new Set<string>();
          const ids = new Set(logs.flatMap((l) => l.headers.map((h) => String(h.id))));
          const monthDeletes = deletes.filter((d) => d.recordDate?.slice(0, 7) === month);
          for (const d of monthDeletes) ids.add(d.target_id);
          const monthCorrections = corrections.filter((c) => c.target_ids.some((id) => ids.has(id)));
          const built = buildMonthTabs({
            month,
            generatedAt: this.now().toISOString(),
            logs,
            profiles,
            equipment,
            photos: photoMap,
            photoPresent,
            corrections: monthCorrections,
            deletes: monthDeletes,
            createAudits,
          });
          const spreadsheetId = await this.monthSpreadsheet(folders, state, month);
          const sheetPerms = checkPermissions(await drive.listPermissions(spreadsheetId), "view");
          if (!sheetPerms.ok) throw new Error(`시트 공개 설정 때문에 쓰지 않았습니다: ${sheetPerms.problems.join("; ")}`);
          for (const w of sheetPerms.warnings) if (!summary.warnings.some((x) => x.endsWith(w))) summary.warnings.push(`${month} 시트: ${w}`);
          await writeTabs(sheets, spreadsheetId, built.tabs);

          const backup = buildMonthBackup(month, logs, photoPresent, createAudits);
          const prev = state.months[month];
          let backupState: "new" | "same" = "same";
          let backupFileId = prev?.backupFileId;
          if (prev?.backupSha256 !== backup.sha256) {
            const folder = await ensureSubfolder(drive, folders.monthlyBackups, month);
            backupFileId = await uploadVerifiedJson(
              drive,
              folder,
              `전자일지원본_${month}_${today}_${backup.sha256.slice(0, 8)}.json`,
              backup.body,
              { kind: "month-backup", month, sha256: backup.sha256 },
              "HACCP 전자일지 월별 원본백업"
            );
            backupState = "new";
          }
          state.months[month] = {
            spreadsheetId,
            builtAt: this.now().toISOString(),
            headerCount: built.headerCount,
            itemCount: built.itemCount,
            rowCount: built.rowCount,
            backupFileId,
            backupSha256: backup.sha256,
          };
          state.pendingMonths = state.pendingMonths.filter((m) => m !== month);
          await store.save(state);
          summary.months.push({ month, ok: true, rows: built.rowCount, headers: built.headerCount, items: built.itemCount, backup: backupState });
        } catch (error) {
          failed = true;
          summary.months.push({ month, ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }

      summary.corrections = await this.archiveCorrections(folders, state, corrections, today);
      await store.save(state);

      await this.archiveAuditDays(folders, state, store, today, limits.auditDaysPerRun, summary);
    } catch (error) {
      failed = true;
      summary.error = error instanceof Error ? error.message : String(error);
    }

    summary.ok = !failed;
    summary.pendingMonths = state.pendingMonths ?? [];
    summary.finishedAt = this.now().toISOString();
    if (summary.ok) state.lastSuccessAt = startedAt;
    const record: RunRecord = {
      startedAt,
      finishedAt: summary.finishedAt,
      ok: summary.ok,
      months: summary.months.map((m) => `${m.month}${m.ok ? "" : "(실패)"}`),
      photosUploaded: summary.photos?.uploaded ?? 0,
      auditDays: summary.auditDays.map((d) => d.day),
      message: [summary.error, ...summary.months.filter((m) => !m.ok).map((m) => `${m.month}: ${m.error}`), ...summary.warnings].filter(Boolean).join(" / "),
    };
    state.runs.push(record);
    await store.save(state);
    await this.writeStatusSheet(folders, state).catch((error) => {
      summary.warnings.push(`동기화 기록 시트 갱신 실패: ${error instanceof Error ? error.message : String(error)}`);
    });
    return summary;
  }

  private async monthSpreadsheet(folders: ArchiveFolders, state: ArchiveState, month: string): Promise<string> {
    const known = state.months[month]?.spreadsheetId;
    if (known) return known;
    const props = { kind: "month-sheet", month };
    const found = await this.deps.drive.findFiles(folders.monthlySheets, props);
    if (found[0]) return found[0].id;
    const id = await this.deps.drive.createSpreadsheet(folders.monthlySheets, `HACCP 전자일지 ${month} (열람용)`, props);
    await this.deps.drive.restrictSharing(id, false);
    return id;
  }

  private async archiveCorrections(
    folders: ArchiveFolders,
    state: ArchiveState,
    corrections: Awaited<ReturnType<ArchiveSource["loadCorrections"]>>,
    today: string
  ): Promise<"new" | "same"> {
    const lightHash = sha256Hex(canonicalJson(corrections));
    if (state.corrections?.sha256 === lightHash) return "same";
    const snapshots = await this.deps.source.loadCorrectionSnapshots(corrections.map((c) => c.id));
    const snapMap = new Map(snapshots.map((s) => [String(s.id), s.before_snapshot]));
    const body = canonicalJson({
      kind: "haccp-data-corrections",
      note: "정정 요청서(data_corrections) 전체. before_snapshot 은 정정 전 원본이다.",
      count: corrections.length,
      rows: corrections.map((c) => ({ ...c, before_snapshot: snapMap.get(c.id) ?? null })),
    });
    const fileId = await uploadVerifiedJson(
      this.deps.drive,
      folders.corrections,
      `정정이력_${today}_${lightHash.slice(0, 8)}.json`,
      body,
      { kind: "corrections", sha256: lightHash },
      "HACCP 데이터 정정·보완 이력"
    );
    state.corrections = { fileId, sha256: lightHash, count: corrections.length };
    return "new";
  }

  private async archiveAuditDays(
    folders: ArchiveFolders,
    state: ArchiveState,
    store: StateStore,
    today: string,
    limit: number,
    summary: RunSummary
  ): Promise<void> {
    const { source, drive } = this.deps;
    const yesterday = addKstDays(today, -1);
    let day = state.audit.doneThrough ? addKstDays(state.audit.doneThrough, 1) : await source.earliestAuditDay();
    for (let n = 0; day && day <= yesterday && n < limit; n += 1, day = addKstDays(day, 1)) {
      const rows = await source.loadAuditDay(day);
      const chain = checkAuditChain(rows, { seq: state.audit.lastSeq, hash: state.audit.lastHash });
      const backup = buildAuditDayBackup(day, rows, chain);
      const folder = await ensureSubfolder(drive, folders.auditLogs, day.slice(0, 7));
      const existing = (await drive.findFiles(folder, { kind: "audit-day", day })).find((f) => f.appProperties?.sha256 === backup.sha256);
      const fileId =
        existing?.id ??
        (await uploadVerifiedJson(drive, folder, `감사로그_${day}.json`, backup.body, { kind: "audit-day", day, sha256: backup.sha256 }, "HACCP 감사로그 장기보관 원본"));
      state.audit.days[day] = { fileId, sha256: backup.sha256, rows: rows.length, chainOk: chain.ok };
      state.audit.doneThrough = day;
      if (chain.lastSeq !== null) {
        state.audit.lastSeq = chain.lastSeq;
        state.audit.lastHash = chain.lastHash;
      }
      if (!chain.ok) summary.warnings.push(`감사로그 ${day} 해시 체인 확인 필요: ${chain.problems.slice(0, 3).join(", ")}`);
      summary.auditDays.push({ day, rows: rows.length, chainOk: chain.ok, reused: Boolean(existing) });
      await store.save(state);
    }
  }

  private async writeStatusSheet(folders: ArchiveFolders, state: ArchiveState): Promise<void> {
    const props = { kind: "status-sheet" };
    const found = await this.deps.drive.findFiles(folders.status, props);
    let id = found[0]?.id;
    if (!id) {
      id = await this.deps.drive.createSpreadsheet(folders.status, "동기화 기록", props);
      await this.deps.drive.restrictSharing(id, true);
    }
    const runs: Tab = {
      title: "실행기록",
      columns: ["시작(KST)", "종료(KST)", "결과", "갱신한 달", "사진 보관", "감사로그 보관일", "메시지"],
      widths: [150, 150, 60, 200, 80, 220, 500],
      rows: [...state.runs].reverse().map((r) => [
        formatKst(r.startedAt, true), formatKst(r.finishedAt, true), r.ok ? "성공" : "실패", r.months.join(", "), r.photosUploaded, r.auditDays.join(", "), r.message,
      ]),
    };
    const months: Tab = {
      title: "월별 현황",
      columns: ["월", "시트 ID", "갱신(KST)", "일지", "세부항목", "원본백업 SHA-256"],
      widths: [80, 300, 150, 60, 80, 480],
      rows: Object.entries(state.months).sort().map(([m, s]) => [m, s.spreadsheetId, formatKst(s.builtAt, true), s.headerCount, s.itemCount, s.backupSha256 ?? ""]),
    };
    const summaryTab: Tab = {
      title: "요약",
      columns: ["항목", "값"],
      widths: [200, 500],
      rows: [
        ["마지막 성공(KST)", formatKst(state.lastSuccessAt, true)],
        ["남은 과거 달", (state.pendingMonths ?? []).join(", ")],
        ["보관한 사진", Object.keys(state.photos).length],
        ["사진 보관 실패", Object.keys(state.photoFailures).length],
        ["감사로그 보관 완료일", state.audit.doneThrough ?? ""],
        ["해시 체인 확인 필요한 날", Object.entries(state.audit.days).filter(([, d]) => !d.chainOk).map(([d]) => d).join(", ")],
      ],
    };
    await writeTabs(this.deps.sheets, id, [summaryTab, runs, months]);
  }
}
