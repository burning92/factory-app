import type { SupabaseClient } from "@supabase/supabase-js";
import { HACCP_LOGS, type HaccpLogSpec } from "@/features/haccpExport/catalog";
import type { AccountProfile } from "@/features/haccpExport/flags";
import { addKstDays, chunk, kstCalendarDate, kstDayEndExclusiveIso, kstDayStartIso } from "@/features/haccpExport/values";
import { RECEIVING_ITEMS_TABLE, RECEIVING_ITEM_COLUMNS_WITHOUT_PHOTO } from "@/features/daily/receivingPhotoQuery";
import { fetchColumnCatalog, type ColumnCatalog } from "@/features/haccpArchive/source";

export type Row = Record<string, unknown>;
export type { ColumnCatalog };

export class HaccpExportError extends Error {
  readonly status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

type LooseFilter = {
  gte: (column: string, value: string) => LooseFilter;
  gt: (column: string, value: string) => LooseFilter;
  lt: (column: string, value: string) => LooseFilter;
  lte: (column: string, value: string) => LooseFilter;
  in: (column: string, values: string[]) => LooseFilter;
  is: (column: string, value: null) => LooseFilter;
  eq: (column: string, value: string) => LooseFilter;
  like: (column: string, pattern: string) => LooseFilter;
  not: (column: string, operator: string, value: unknown) => LooseFilter;
  order: (column: string, options: { ascending: boolean }) => LooseFilter;
  range: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
};

type LooseCount = {
  gte: (column: string, value: string) => LooseCount;
  lt: (column: string, value: string) => LooseCount;
  lte: (column: string, value: string) => LooseCount;
  in: (column: string, values: string[]) => LooseCount;
  is: (column: string, value: null) => LooseCount;
  eq: (column: string, value: string) => LooseCount;
  then?: unknown;
};

const PAGE = 500;
const PAGE_CAP = 400;

/** 사진(base64)·변경 전후 JSON 처럼 큰 컬럼. 일반 조회 목록에서 뺀다. */
const PHOTO_COLUMN = "label_photo_url";
const AUDIT_JSON_COLUMNS = ["before_data", "after_data"];
const RECEIVING_ITEM_FIELDS = RECEIVING_ITEM_COLUMNS_WITHOUT_PHOTO.split(",").map((c) => c.trim());
export const PHOTO_OMITTED_MARK = "[사진 본문은 엑셀에 넣지 않음]";

function applyDate(filter: LooseFilter, spec: HaccpLogSpec, from: string, to: string): LooseFilter {
  if (spec.dateKind === "timestamptz") {
    return filter.gte(spec.dateColumn, kstDayStartIso(from)).lt(spec.dateColumn, kstDayEndExclusiveIso(to));
  }
  return filter.gte(spec.dateColumn, from).lte(spec.dateColumn, to);
}

function applyDateCount(filter: LooseCount, spec: HaccpLogSpec, from: string, to: string): LooseCount {
  if (spec.dateKind === "timestamptz") {
    return filter.gte(spec.dateColumn, kstDayStartIso(from)).lt(spec.dateColumn, kstDayEndExclusiveIso(to));
  }
  return filter.gte(spec.dateColumn, from).lte(spec.dateColumn, to);
}

async function countRows(
  admin: SupabaseClient,
  table: string,
  refine: (query: LooseCount) => LooseCount
): Promise<number> {
  const base = admin.from(table).select("id", { count: "exact", head: true }) as unknown as LooseCount;
  const query = refine(base) as unknown as PromiseLike<{ count: number | null; error: { message: string } | null }>;
  const { count, error } = await query;
  if (error) throw new HaccpExportError(`${table} 건수 조회 실패: ${error.message}`);
  if (count == null) throw new HaccpExportError(`${table} 건수를 확인하지 못했습니다.`);
  return count;
}

let cachedCatalog: { at: number; catalog: ColumnCatalog } | null = null;

/** 서버 환경변수로 PostgREST 스키마 정보(컬럼 이름만)를 읽는다. 행 데이터는 읽지 않는다. */
export async function loadServerColumnCatalog(): Promise<ColumnCatalog> {
  if (cachedCatalog && Date.now() - cachedCatalog.at < 10 * 60 * 1000) return cachedCatalog.catalog;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new HaccpExportError("컬럼 목록을 읽을 서버 설정이 없습니다.");
  const catalog = await fetchColumnCatalog(`${url.replace(/\/$/, "")}/rest/v1/`, key);
  cachedCatalog = { at: Date.now(), catalog };
  return catalog;
}

/** 명시 컬럼 목록. 사진·감사 JSON 같은 큰 컬럼은 exclude 로 뺀다. */
export function columnsOf(catalog: ColumnCatalog, table: string, exclude: string[] = []): string {
  const all = catalog.get(table);
  if (!all || all.length === 0) throw new HaccpExportError(`${table} 컬럼 목록이 없습니다.`);
  const skip = new Set(exclude);
  return all.filter((c) => !skip.has(c)).join(",");
}

export async function fetchPages(
  admin: SupabaseClient,
  table: string,
  refine: (query: LooseFilter) => LooseFilter,
  columns: string
): Promise<Row[]> {
  if (!columns || columns.trim() === "*") throw new HaccpExportError(`${table} 조회 컬럼을 명시해야 합니다.`);
  const rows: Row[] = [];
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const from = page * PAGE;
    const base = admin.from(table).select(columns) as unknown as LooseFilter;
    const query = refine(base).order("id", { ascending: true }).range(from, from + PAGE - 1);
    const { data, error } = await query;
    if (error) throw new HaccpExportError(`${table} 조회 실패: ${error.message}`);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
  throw new HaccpExportError(`${table} 조회가 ${PAGE_CAP}페이지를 넘겨 중단했습니다. 일부만 추출하지 않습니다.`);
}

export async function fetchFilteredHeaders(
  admin: SupabaseClient,
  spec: HaccpLogSpec,
  from: string,
  to: string,
  catalog: ColumnCatalog
): Promise<{ rows: Row[]; dbCount: number; nullDateCount: number }> {
  const dbCount = await countRows(admin, spec.headerTable, (query) => applyDateCount(query, spec, from, to));
  const nullDateCount = await countRows(admin, spec.headerTable, (query) => query.is(spec.dateColumn, null));
  const rows = await fetchPages(admin, spec.headerTable, (query) => applyDate(query, spec, from, to), columnsOf(catalog, spec.headerTable));
  if (rows.length !== dbCount) {
    throw new HaccpExportError(
      `${spec.label} 헤더 조회 ${rows.length}건과 DB 건수 ${dbCount}건이 다릅니다. 파일을 만들지 않습니다.`
    );
  }
  const ids = new Set(rows.map((row) => String(row.id)));
  if (ids.size !== rows.length) {
    throw new HaccpExportError(`${spec.label} 헤더 ID가 중복되어 추출을 중단합니다.`);
  }
  return { rows, dbCount, nullDateCount };
}

export type PhotoKind = { kind: "data" | "url" | "empty"; url?: string };

/**
 * 사진 본문(base64)은 읽지 않고 종류만 확인한다.
 * - data URL: ID만 받는다
 * - http 주소: 짧은 문자열이므로 주소를 받는다(접근 확인용)
 */
export async function loadPhotoKinds(admin: SupabaseClient, table: string, column: string, itemIds: string[]): Promise<Map<string, PhotoKind>> {
  const out = new Map<string, PhotoKind>();
  for (const ids of chunk(itemIds, 100)) {
    for (const row of await fetchPages(admin, table, (q) => q.in("id", ids).like(column, "data:*"), "id")) {
      out.set(String(row.id), { kind: "data" });
    }
    for (const row of await fetchPages(admin, table, (q) => q.in("id", ids).eq(column, ""), "id")) {
      out.set(String(row.id), { kind: "empty" });
    }
    const others = await fetchPages(
      admin,
      table,
      (q) => q.in("id", ids).not(column, "is", null).not(column, "like", "data:*").not(column, "eq", ""),
      `id,${column}`
    );
    for (const row of others) out.set(String(row.id), { kind: "url", url: String(row[column]) });
  }
  return out;
}

export function photoPlaceholder(kind: PhotoKind | undefined): string | null {
  if (!kind) return null;
  if (kind.kind === "empty") return "";
  if (kind.kind === "url") return kind.url ?? null;
  return PHOTO_OMITTED_MARK;
}

export async function fetchItemsForHeaders(
  admin: SupabaseClient,
  spec: HaccpLogSpec,
  headerIds: string[],
  catalog?: ColumnCatalog
): Promise<{ rows: Row[]; dbCount: number; photoKinds: Map<string, PhotoKind> }> {
  const photoKinds = new Map<string, PhotoKind>();
  if (!spec.itemTable) return { rows: [], dbCount: 0, photoKinds };
  if (headerIds.length === 0) return { rows: [], dbCount: 0, photoKinds };
  const isReceiving = spec.itemTable === RECEIVING_ITEMS_TABLE;
  const columns = isReceiving ? RECEIVING_ITEM_COLUMNS_WITHOUT_PHOTO : catalog ? columnsOf(catalog, spec.itemTable, [PHOTO_COLUMN]) : "";
  if (!columns) throw new HaccpExportError(`${spec.itemTable} 컬럼 목록이 없습니다.`);
  const groups = chunk(headerIds, 80);
  let dbCount = 0;
  const rows: Row[] = [];
  for (const ids of groups) {
    dbCount += await countRows(admin, spec.itemTable, (query) => query.in("log_id", ids));
    rows.push(...(await fetchPages(admin, spec.itemTable, (query) => query.in("log_id", ids), columns)));
  }
  if (isReceiving && spec.photoColumn) {
    const kinds = await loadPhotoKinds(admin, spec.itemTable, spec.photoColumn, rows.map((row) => String(row.id)));
    kinds.forEach((v, k) => photoKinds.set(k, v));
    for (const row of rows) row[spec.photoColumn] = photoPlaceholder(kinds.get(String(row.id)));
  }
  if (rows.length !== dbCount) {
    throw new HaccpExportError(
      `${spec.label} 항목 조회 ${rows.length}건과 DB 건수 ${dbCount}건이 다릅니다. 파일을 만들지 않습니다.`
    );
  }
  const itemIds = new Set(rows.map((row) => String(row.id)));
  if (itemIds.size !== rows.length) {
    throw new HaccpExportError(`${spec.label} 항목 ID가 중복되어 추출을 중단합니다.`);
  }
  return { rows, dbCount, photoKinds };
}

/**
 * 감사로그 행을 ID 로 읽는다.
 * 입고검수 항목의 변경 전후 JSON 에는 사진 base64 가 들어 있으므로, 사진을 뺀 필드만 경로로 골라 읽고
 * 사진 유무는 ID 조회로 따로 확인해 표시 문구로 바꾼다.
 */
async function fetchAuditRowsByIds(admin: SupabaseClient, ids: string[], targetTable: string, catalog: ColumnCatalog): Promise<Row[]> {
  if (ids.length === 0) return [];
  const light = columnsOf(catalog, "audit_logs", AUDIT_JSON_COLUMNS);
  const rows: Row[] = [];
  if (targetTable !== RECEIVING_ITEMS_TABLE) {
    for (const group of chunk(ids, 50)) {
      rows.push(...(await fetchPages(admin, "audit_logs", (q) => q.in("id", group), `${light},before_data,after_data`)));
    }
    return rows;
  }
  const paths = RECEIVING_ITEM_FIELDS.flatMap((f) => [`b__${f}:before_data->${f}`, `a__${f}:after_data->${f}`]).join(",");
  for (const group of chunk(ids, 50)) {
    const part = await fetchPages(admin, "audit_logs", (q) => q.in("id", group), `${light},${paths}`);
    const beforePhoto = new Set(
      (await fetchPages(admin, "audit_logs", (q) => q.in("id", group).not(`before_data->>${PHOTO_COLUMN}`, "is", null), "id")).map((r) => String(r.id))
    );
    const afterPhoto = new Set(
      (await fetchPages(admin, "audit_logs", (q) => q.in("id", group).not(`after_data->>${PHOTO_COLUMN}`, "is", null), "id")).map((r) => String(r.id))
    );
    for (const row of part) {
      const rebuild = (prefix: "b__" | "a__", hasPhoto: boolean) => {
        if (row[`${prefix}id`] == null) return null;
        const obj: Row = {};
        for (const f of RECEIVING_ITEM_FIELDS) obj[f] = row[`${prefix}${f}`] ?? null;
        obj[PHOTO_COLUMN] = hasPhoto ? PHOTO_OMITTED_MARK : null;
        return obj;
      };
      const out: Row = {};
      for (const [k, v] of Object.entries(row)) if (!k.startsWith("b__") && !k.startsWith("a__")) out[k] = v;
      out.before_data = rebuild("b__", beforePhoto.has(String(row.id)));
      out.after_data = rebuild("a__", afterPhoto.has(String(row.id)));
      rows.push(out);
    }
  }
  return rows;
}

export async function fetchAuditsForIds(
  admin: SupabaseClient,
  table: string,
  ids: string[],
  catalog: ColumnCatalog
): Promise<Row[]> {
  if (ids.length === 0) return [];
  const auditIds: string[] = [];
  for (const group of chunk(ids, 80)) {
    const part = await fetchPages(admin, "audit_logs", (query) => query.eq("target_table", table).in("target_id", group), "id");
    auditIds.push(...part.map((row) => String(row.id)));
  }
  return fetchAuditRowsByIds(admin, auditIds, table, catalog);
}

/** 기간 시작 전에 미리 만들어 둔 일지까지 잡기 위한 여유. 삭제 감사로그는 이 시각 이후만 훑는다. */
export const DELETE_AUDIT_LOOKBACK_DAYS = 7;

/**
 * 선택 기간의 일지에 해당하는 삭제 기록만 읽는다.
 * - 일지 삭제: 삭제 전 기록일이 기간 안인 것
 * - 세부항목 삭제: 삭제 전 log_id 가 기간 안 일지(현재 남은 일지 또는 기간 안에서 삭제된 일지)인 것
 * 먼저 ID·날짜만 읽고, 남길 행의 전체 내용은 소량씩 읽는다(입고 항목은 사진 본문 제외).
 */
export async function fetchPeriodDeleteAudits(
  admin: SupabaseClient,
  logs: { spec: HaccpLogSpec; headers: Row[] }[],
  from: string,
  to: string,
  catalog: ColumnCatalog
): Promise<Row[]> {
  const since = kstDayStartIso(addKstDays(from, -DELETE_AUDIT_LOOKBACK_DAYS));
  const kept: { table: string; id: string; kind: "header" | "item"; logId: string }[] = [];
  for (const log of logs) {
    const { spec } = log;
    const headerDeletes = await fetchPages(
      admin,
      "audit_logs",
      (query) => query.eq("action", "delete").eq("target_table", spec.headerTable).gte("created_at", since),
      `id,target_id,rd:before_data->>${spec.dateColumn}`
    );
    const logIds = new Set(log.headers.map((h) => String(h.id)));
    for (const audit of headerDeletes) {
      const raw = audit.rd == null ? null : String(audit.rd);
      const day = raw == null ? null : spec.dateKind === "timestamptz" ? kstCalendarDate(raw) : raw.slice(0, 10);
      if (!day || day < from || day > to) continue;
      kept.push({ table: spec.headerTable, id: String(audit.id), kind: "header", logId: String(audit.target_id ?? "") });
      logIds.add(String(audit.target_id ?? ""));
    }
    if (!spec.itemTable || logIds.size === 0) continue;
    const itemDeletes = await fetchPages(
      admin,
      "audit_logs",
      (query) => query.eq("action", "delete").eq("target_table", spec.itemTable!).gte("created_at", since),
      "id,lid:before_data->>log_id"
    );
    for (const audit of itemDeletes) {
      const logId = audit.lid == null ? "" : String(audit.lid);
      if (logIds.has(logId)) kept.push({ table: spec.itemTable, id: String(audit.id), kind: "item", logId });
    }
  }
  const rows: Row[] = [];
  const meta = new Map(kept.map((k) => [k.id, k]));
  const byTable = new Map<string, string[]>();
  for (const k of kept) byTable.set(k.table, [...(byTable.get(k.table) ?? []), k.id]);
  for (const [table, ids] of Array.from(byTable)) {
    const part = await fetchAuditRowsByIds(admin, ids, table, catalog);
    if (part.length !== ids.length) {
      throw new HaccpExportError(`삭제 감사로그 ${part.length}건이 요청 ${ids.length}건과 다릅니다. 파일을 만들지 않습니다.`);
    }
    for (const row of part) {
      const k = meta.get(String(row.id));
      rows.push({ ...row, 구분: k?.kind === "header" ? "일지 삭제" : "세부항목 삭제", 일지ID: k?.logId ?? null });
    }
  }
  return rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
}

export async function loadEquipmentMaster(admin: SupabaseClient): Promise<Row[]> {
  return fetchPages(admin, "equipment_master", (query) => query, "id,management_no,equipment_name,display_name,floor_label,organization_code");
}

export async function loadProfilesWithOrg(admin: SupabaseClient): Promise<Map<string, AccountProfile>> {
  const rows: Row[] = [];
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const from = page * PAGE;
    const query = admin
      .from("profiles")
      .select("id, display_name, login_id, organizations(organization_code, name)") as unknown as LooseFilter;
    const { data, error } = await query.order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new HaccpExportError(`프로필 조회 실패: ${error.message}`);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  const map = new Map<string, AccountProfile>();
  for (const row of rows) {
    const org = row.organizations as
      | { organization_code?: string | null; name?: string | null }
      | { organization_code?: string | null; name?: string | null }[]
      | null;
    const orgRow = Array.isArray(org) ? org[0] : org;
    map.set(String(row.id), {
      display_name: row.display_name == null ? null : String(row.display_name),
      login_id: row.login_id == null ? null : String(row.login_id),
      organization_code: orgRow?.organization_code == null ? null : String(orgRow.organization_code),
      organization_name: orgRow?.name == null ? null : String(orgRow.name),
    });
  }
  return map;
}

export function resolveLogKeys(keys: string[]): HaccpLogSpec[] {
  if (keys.length === 0) throw new HaccpExportError("일지를 한 종류 이상 선택하세요.", 400);
  const specs: HaccpLogSpec[] = [];
  for (const key of keys) {
    const spec = HACCP_LOGS.find((log) => log.key === key);
    if (!spec) throw new HaccpExportError(`알 수 없는 일지입니다: ${key}`, 400);
    specs.push(spec);
  }
  return specs;
}

export function assertDateRange(from: string, to: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new HaccpExportError("시작일과 종료일은 YYYY-MM-DD 형식이어야 합니다.", 400);
  }
  if (from > to) throw new HaccpExportError("시작일이 종료일보다 늦습니다.", 400);
}
