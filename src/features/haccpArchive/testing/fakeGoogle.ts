import { createHash } from "node:crypto";
import { FOLDER_MIME, SPREADSHEET_MIME, type DriveApi, type DriveFile, type DrivePermission } from "@/features/haccpArchive/google/drive";
import type { SheetInfo, SheetsApi } from "@/features/haccpArchive/google/sheets";

type FakeFile = {
  id: string;
  name: string;
  parent: string;
  mimeType: string;
  data: Buffer;
  appProperties: Record<string, string>;
  locked: boolean;
  writersCanShare: boolean;
  copyRequiresWriterPermission: boolean;
};

/** 메모리 Drive. 실제 Google 호출 없음. */
export class FakeDrive implements DriveApi {
  files = new Map<string, FakeFile>();
  permissions = new Map<string, DrivePermission[]>();
  calls: string[] = [];
  corruptNextUpload = false;
  private seq = 0;
  constructor(private readonly sheets?: FakeSheets) {}

  private id(): string {
    this.seq += 1;
    return `f${String(this.seq).padStart(4, "0")}`;
  }

  private view(f: FakeFile): DriveFile {
    return {
      id: f.id,
      name: f.name,
      md5Checksum: f.mimeType === FOLDER_MIME || f.mimeType === SPREADSHEET_MIME ? undefined : createHash("md5").update(f.data).digest("hex"),
      size: String(f.data.length),
      webViewLink: `https://drive.google.com/file/d/${f.id}/view`,
      appProperties: { ...f.appProperties },
    };
  }

  private ancestors(id: string): string[] {
    const out: string[] = [];
    let cur = this.files.get(id);
    while (cur) {
      out.push(cur.id);
      cur = this.files.get(cur.parent);
    }
    out.push("root");
    return out;
  }

  async findFolder(parentId: string, name: string) {
    this.calls.push("findFolder");
    return Array.from(this.files.values()).find((f) => f.parent === parentId && f.mimeType === FOLDER_MIME && f.name === name)?.id ?? null;
  }
  async createFolder(parentId: string, name: string) {
    this.calls.push("createFolder");
    const id = this.id();
    this.files.set(id, { id, name, parent: parentId, mimeType: FOLDER_MIME, data: Buffer.alloc(0), appProperties: {}, locked: false, writersCanShare: true, copyRequiresWriterPermission: false });
    return id;
  }
  async findFiles(parentId: string, appProperties: Record<string, string>) {
    this.calls.push("findFiles");
    return Array.from(this.files.values())
      .filter((f) => f.parent === parentId && Object.entries(appProperties).every(([k, v]) => f.appProperties[k] === v))
      .map((f) => this.view(f));
  }
  async uploadFile(input: { parentId: string; name: string; mimeType: string; data: Buffer; appProperties: Record<string, string> }) {
    this.calls.push("uploadFile");
    const id = this.id();
    let data = Buffer.from(input.data);
    if (this.corruptNextUpload) {
      this.corruptNextUpload = false;
      data = Buffer.concat([data, Buffer.from("x")]);
    }
    this.files.set(id, { id, name: input.name, parent: input.parentId, mimeType: input.mimeType, data, appProperties: { ...input.appProperties }, locked: false, writersCanShare: true, copyRequiresWriterPermission: false });
    return this.view(this.files.get(id)!);
  }
  async updateFileContent(fileId: string, data: Buffer) {
    this.calls.push("updateFileContent");
    const f = this.files.get(fileId);
    if (!f) throw new Error("없는 파일");
    if (f.locked) throw new Error("잠긴 파일은 수정할 수 없음");
    f.data = Buffer.from(data);
    return this.view(f);
  }
  async createSpreadsheet(parentId: string, name: string, appProperties: Record<string, string>) {
    this.calls.push("createSpreadsheet");
    const id = this.id();
    this.files.set(id, { id, name, parent: parentId, mimeType: SPREADSHEET_MIME, data: Buffer.alloc(0), appProperties: { ...appProperties }, locked: false, writersCanShare: true, copyRequiresWriterPermission: false });
    this.sheets?.create(id);
    return id;
  }
  async lockReadOnly(fileId: string) {
    this.calls.push("lockReadOnly");
    const f = this.files.get(fileId);
    if (!f) throw new Error("없는 파일");
    f.locked = true;
  }
  async listPermissions(fileId: string) {
    this.calls.push("listPermissions");
    const perms: DrivePermission[] = [{ type: "user", role: "owner", emailAddress: "owner@example.com" }];
    for (const a of this.ancestors(fileId)) perms.push(...(this.permissions.get(a) ?? []));
    return perms;
  }
  async getFile(fileId: string) {
    this.calls.push("getFile");
    const f = this.files.get(fileId);
    if (!f) throw new Error("없는 파일");
    return this.view(f);
  }
  async restrictSharing(fileId: string, copyRequiresWriterPermission: boolean) {
    this.calls.push("restrictSharing");
    const f = this.files.get(fileId);
    if (!f) throw new Error("없는 파일");
    f.writersCanShare = false;
    f.copyRequiresWriterPermission = copyRequiresWriterPermission;
  }
  async downloadText(fileId: string) {
    this.calls.push("downloadText");
    const f = this.files.get(fileId);
    if (!f) throw new Error("없는 파일");
    return f.data.toString("utf8");
  }

  pathOf(id: string): string {
    const names: string[] = [];
    let cur = this.files.get(id);
    while (cur) {
      names.unshift(cur.name);
      cur = this.files.get(cur.parent);
    }
    return names.join("/");
  }
}

type FakeProtection = { protectedRangeId: number; warningOnly: boolean; editors: string[] };
type FakeTab = { sheetId: number; title: string; rows: number; cols: number; frozen: number; cells: Map<string, string | number>; filter: boolean; protections: FakeProtection[] };
type FakeBook = { tabs: FakeTab[] };

/** 메모리 Sheets. batchUpdate 는 복사본에 적용하고 전부 성공했을 때만 반영한다(실제 API 와 같은 원자성). */
export class FakeSheets implements SheetsApi {
  books = new Map<string, FakeBook>();
  batchCalls = 0;
  batchIds: string[] = [];
  failNextBatch: string | null = null;
  maxRequestBytes = 0;
  private nextSheetId = 100;
  private nextProtectionId = 1;

  create(id: string) {
    this.books.set(id, { tabs: [{ sheetId: 0, title: "시트1", rows: 1000, cols: 26, frozen: 0, cells: new Map(), filter: false, protections: [] }] });
  }

  async getSheets(id: string): Promise<SheetInfo[]> {
    const book = this.books.get(id);
    if (!book) throw new Error("없는 스프레드시트");
    return book.tabs.map((t) => ({ sheetId: t.sheetId, title: t.title, protections: t.protections.map((p) => ({ protectedRangeId: p.protectedRangeId, warningOnly: p.warningOnly, wholeSheet: true })) }));
  }

  async batchUpdate(id: string, requests: unknown[]) {
    this.batchCalls += 1;
    this.batchIds.push(id);
    this.maxRequestBytes = Math.max(this.maxRequestBytes, Buffer.byteLength(JSON.stringify({ requests })));
    const book = this.books.get(id);
    if (!book) throw new Error("없는 스프레드시트");
    if (this.failNextBatch) {
      const msg = this.failNextBatch;
      this.failNextBatch = null;
      throw new Error(msg);
    }
    const draft: FakeBook = { tabs: book.tabs.map((t) => ({ ...t, cells: new Map(t.cells), protections: t.protections.map((p) => ({ ...p })) })) };
    for (const raw of requests) this.apply(draft, raw as Record<string, Record<string, unknown>>);
    this.books.set(id, draft);
    return { replies: [] };
  }

  private tab(book: FakeBook, sheetId: unknown): FakeTab {
    const t = book.tabs.find((x) => x.sheetId === sheetId);
    if (!t) throw new Error(`없는 탭 ${String(sheetId)}`);
    return t;
  }

  private apply(book: FakeBook, req: Record<string, Record<string, unknown>>) {
    const [kind] = Object.keys(req);
    const body = req[kind] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    switch (kind) {
      case "addSheet": {
        const title = body.properties.title as string;
        if (book.tabs.some((t) => t.title === title)) throw new Error(`탭 이름 중복 ${title}`);
        book.tabs.push({ sheetId: this.nextSheetId++, title, rows: 1000, cols: 26, frozen: 0, cells: new Map(), filter: false, protections: [] });
        return;
      }
      case "deleteSheet":
        if (book.tabs.length <= 1) throw new Error("마지막 탭은 지울 수 없음");
        book.tabs = book.tabs.filter((t) => t.sheetId !== body.sheetId);
        return;
      case "addProtectedRange":
        this.tab(book, body.protectedRange.range.sheetId).protections.push({
          protectedRangeId: this.nextProtectionId++,
          warningOnly: Boolean(body.protectedRange.warningOnly),
          editors: body.protectedRange.editors?.users ?? [],
        });
        return;
      case "deleteProtectedRange": {
        const t = book.tabs.find((x) => x.protections.some((p) => p.protectedRangeId === body.protectedRangeId));
        if (!t) throw new Error("없는 보호 범위");
        t.protections = t.protections.filter((p) => p.protectedRangeId !== body.protectedRangeId);
        return;
      }
      case "updateSheetProperties": {
        const t = this.tab(book, body.properties.sheetId);
        const g = body.properties.gridProperties;
        t.rows = g.rowCount;
        t.cols = g.columnCount;
        t.frozen = g.frozenRowCount;
        for (const key of Array.from(t.cells.keys())) {
          const [r, c] = key.split(":").map(Number);
          if (r >= t.rows || c >= t.cols) t.cells.delete(key);
        }
        const index = body.properties.index as number;
        book.tabs = book.tabs.filter((x) => x !== t);
        book.tabs.splice(index, 0, t);
        return;
      }
      case "updateCells": {
        const t = this.tab(book, body.range.sheetId);
        const rows = body.rows as { values: { userEnteredValue?: Record<string, string | number> }[] }[];
        if (body.range.endRowIndex > t.rows || body.range.endColumnIndex > t.cols) throw new Error("범위가 격자를 넘음");
        rows.forEach((row, r) =>
          row.values.forEach((cell, c) => {
            const key = `${body.range.startRowIndex + r}:${c}`;
            const v = cell.userEnteredValue;
            if (!v) {
              t.cells.delete(key);
              return;
            }
            const value = v.stringValue ?? v.numberValue ?? v.formulaValue;
            if (typeof value === "string" && value.length > 50000) throw new Error("셀 50,000자 초과");
            t.cells.set(key, value);
          })
        );
        return;
      }
      case "setBasicFilter":
        this.tab(book, body.filter.range.sheetId).filter = true;
        return;
      case "repeatCell":
      case "updateDimensionProperties":
        this.tab(book, body.range.sheetId);
        return;
      default:
        throw new Error(`모르는 요청 ${kind}`);
    }
  }

  /** 탭 내용을 2차원 배열로 */
  read(id: string, title: string): (string | number | null)[][] {
    const t = this.books.get(id)?.tabs.find((x) => x.title === title);
    if (!t) throw new Error(`없는 탭 ${title}`);
    const out: (string | number | null)[][] = [];
    for (let r = 0; r < t.rows; r += 1) {
      const row: (string | number | null)[] = [];
      for (let c = 0; c < t.cols; c += 1) row.push(t.cells.get(`${r}:${c}`) ?? null);
      out.push(row);
    }
    return out;
  }

  tabInfo(id: string) {
    return this.books.get(id)?.tabs.map((t) => ({ title: t.title, rows: t.rows, cols: t.cols, frozen: t.frozen, filter: t.filter, protections: t.protections.map((p) => ({ ...p })) })) ?? [];
  }
}
