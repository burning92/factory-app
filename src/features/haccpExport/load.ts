import type { SupabaseClient } from "@supabase/supabase-js";
import { HACCP_LOGS, type HaccpLogSpec } from "@/features/haccpExport/catalog";
import type { AccountProfile } from "@/features/haccpExport/flags";
import { chunk, kstDayEndExclusiveIso, kstDayStartIso } from "@/features/haccpExport/values";
import { RECEIVING_ITEMS_TABLE, RECEIVING_ITEM_COLUMNS_WITHOUT_PHOTO } from "@/features/daily/receivingPhotoQuery";

export type Row = Record<string, unknown>;

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

const PAGE = 1000;
const PAGE_CAP = 200;

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

export async function fetchPages(
  admin: SupabaseClient,
  table: string,
  refine: (query: LooseFilter) => LooseFilter,
  columns = "*"
): Promise<Row[]> {
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
  to: string
): Promise<{ rows: Row[]; dbCount: number; nullDateCount: number }> {
  const dbCount = await countRows(admin, spec.headerTable, (query) => applyDateCount(query, spec, from, to));
  const nullDateCount = await countRows(admin, spec.headerTable, (query) => query.is(spec.dateColumn, null));
  const rows = await fetchPages(admin, spec.headerTable, (query) => applyDate(query, spec, from, to));
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

/** 사진 컬럼(base64, 장당 최대 약 1MB)은 한 요청에 PHOTO_BATCH 장까지만 읽는다. */
const PHOTO_BATCH = 5;

async function attachPhotosInSmallBatches(
  admin: SupabaseClient,
  table: string,
  photoColumn: string,
  rows: Row[]
): Promise<void> {
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  for (const ids of chunk(Array.from(byId.keys()), PHOTO_BATCH)) {
    const { data, error } = await admin.from(table).select(`id, ${photoColumn}`).in("id", ids);
    if (error) throw new HaccpExportError(`${table} 사진 조회 실패: ${error.message}`);
    const found = (data ?? []) as unknown as Row[];
    if (found.length !== ids.length) {
      throw new HaccpExportError(`${table} 사진 조회 ${found.length}건이 요청 ${ids.length}건과 다릅니다. 파일을 만들지 않습니다.`);
    }
    for (const photo of found) {
      const row = byId.get(String(photo.id));
      if (row) row[photoColumn] = photo[photoColumn];
    }
  }
}

export async function fetchItemsForHeaders(
  admin: SupabaseClient,
  spec: HaccpLogSpec,
  headerIds: string[]
): Promise<{ rows: Row[]; dbCount: number }> {
  if (!spec.itemTable) return { rows: [], dbCount: 0 };
  if (headerIds.length === 0) return { rows: [], dbCount: 0 };
  const groups = chunk(headerIds, 80);
  let dbCount = 0;
  const rows: Row[] = [];
  const photoColumn = spec.itemTable === RECEIVING_ITEMS_TABLE ? spec.photoColumn : null;
  for (const ids of groups) {
    dbCount += await countRows(admin, spec.itemTable, (query) => query.in("log_id", ids));
    const part = await fetchPages(
      admin,
      spec.itemTable,
      (query) => query.in("log_id", ids),
      photoColumn ? RECEIVING_ITEM_COLUMNS_WITHOUT_PHOTO : "*"
    );
    rows.push(...part);
  }
  if (photoColumn) {
    await attachPhotosInSmallBatches(admin, spec.itemTable, photoColumn, rows);
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
  return { rows, dbCount };
}

export async function fetchAuditsForIds(
  admin: SupabaseClient,
  table: string,
  ids: string[]
): Promise<Row[]> {
  if (ids.length === 0) return [];
  const rows: Row[] = [];
  const groupSize = table === RECEIVING_ITEMS_TABLE ? PHOTO_BATCH : 80;
  for (const group of chunk(ids, groupSize)) {
    const part = await fetchPages(admin, "audit_logs", (query) =>
      query.eq("target_table", table).in("target_id", group)
    );
    rows.push(...part);
  }
  return rows;
}

export async function fetchDeleteAudits(admin: SupabaseClient, tables: string[]): Promise<Row[]> {
  if (tables.length === 0) return [];
  return fetchPages(admin, "audit_logs", (query) => query.eq("action", "delete").in("target_table", tables));
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
