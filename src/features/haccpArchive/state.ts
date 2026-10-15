import type { DriveApi } from "@/features/haccpArchive/google/drive";
import type { PhotoRecord } from "@/features/haccpArchive/sheetModel";

export const STATE_FILE_NAME = "sync-state.json";
const STATE_PROPS = { kind: "haccp-archive-state" };

export type MonthState = {
  spreadsheetId: string;
  builtAt: string;
  headerCount: number;
  itemCount: number;
  rowCount: number;
  backupFileId?: string;
  backupSha256?: string;
};

export type RunRecord = {
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  months: string[];
  photosUploaded: number;
  auditDays: string[];
  message: string;
};

export type ArchiveState = {
  version: 1;
  lastSuccessAt: string | null;
  /** 아직 시트를 만들지 않은 과거 달(오래된 달부터). */
  pendingMonths: string[] | null;
  months: Record<string, MonthState>;
  photos: Record<string, PhotoRecord>;
  photoSeq: Record<string, number>;
  photoFailures: Record<string, string>;
  audit: {
    doneThrough: string | null;
    lastSeq: number | null;
    lastHash: string | null;
    days: Record<string, { fileId: string; sha256: string; rows: number; chainOk: boolean }>;
  };
  corrections: { fileId: string; sha256: string; count: number } | null;
  runs: RunRecord[];
};

export function emptyState(): ArchiveState {
  return {
    version: 1,
    lastSuccessAt: null,
    pendingMonths: null,
    months: {},
    photos: {},
    photoSeq: {},
    photoFailures: {},
    audit: { doneThrough: null, lastSeq: null, lastHash: null, days: {} },
    corrections: null,
    runs: [],
  };
}

export class StateStore {
  private fileId: string | null = null;
  constructor(private readonly drive: DriveApi, private readonly folderId: string) {}

  async load(): Promise<ArchiveState> {
    const files = await this.drive.findFiles(this.folderId, STATE_PROPS);
    if (files.length === 0) return emptyState();
    if (files.length > 1) throw new Error("동기화 상태 파일이 여러 개입니다. 00_동기화 상태 폴더를 확인하세요.");
    this.fileId = files[0].id;
    const parsed = JSON.parse(await this.drive.downloadText(this.fileId)) as ArchiveState;
    return { ...emptyState(), ...parsed, audit: { ...emptyState().audit, ...parsed.audit } };
  }

  async save(state: ArchiveState): Promise<void> {
    const data = Buffer.from(JSON.stringify({ ...state, runs: state.runs.slice(-60) }, null, 1));
    if (this.fileId) {
      await this.drive.updateFileContent(this.fileId, data, "application/json");
      return;
    }
    const file = await this.drive.uploadFile({ parentId: this.folderId, name: STATE_FILE_NAME, mimeType: "application/json", data, appProperties: STATE_PROPS });
    this.fileId = file.id;
    await this.drive.restrictSharing(file.id, true);
  }
}
