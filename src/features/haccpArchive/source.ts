import type { SupabaseClient } from "@supabase/supabase-js";
import { HACCP_LOGS, type HaccpLogSpec } from "@/features/haccpExport/catalog";
import { addKstDays, chunk, kstDayStartIso } from "@/features/haccpExport/values";
import type { EquipmentMasterRow } from "@/features/haccpArchive/floors";
import type { CorrectionRow, DeleteEvent, ProfileLite, Row } from "@/features/haccpArchive/sheetModel";
import { formatKst } from "@/features/haccpArchive/sheetModel";
import type { CreateAudit } from "@/features/haccpArchive/provenance";

/** 큰 값(base64 사진)이 들어가는 컬럼. 일반 조회에서 항상 뺀다. */
export const HEAVY_COLUMNS: Record<string, string[]> = {
  daily_material_receiving_inspection_log_items: ["label_photo_url"],
  audit_logs: ["before_data", "after_data"],
  data_corrections: ["before_snapshot"],
};

export type ColumnCatalog = Map<string, string[]>;

/** PostgREST 스키마 설명(OpenAPI)에서 테이블 컬럼 목록만 읽는다. 데이터 행은 읽지 않는다. */
export async function fetchColumnCatalog(restUrl: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<ColumnCatalog> {
  const res = await fetchImpl(restUrl.endsWith("/") ? restUrl : `${restUrl}/`, {
    headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}`, Accept: "application/openapi+json" },
  });
  if (!res.ok) throw new Error(`컬럼 목록 조회 실패: ${res.status}`);
  const spec = (await res.json()) as { definitions?: Record<string, { properties?: Record<string, unknown> }> };
  const out: ColumnCatalog = new Map();
  for (const [table, def] of Object.entries(spec.definitions ?? {})) {
    out.set(table, Object.keys(def.properties ?? {}));
  }
  return out;
}

type Query = {
  select: (columns: string, options?: { count?: "exact"; head?: boolean }) => Query;
  gte: (c: string, v: string) => Query;
  lt: (c: string, v: string) => Query;
  lte: (c: string, v: string) => Query;
  eq: (c: string, v: string) => Query;
  in: (c: string, v: string[]) => Query;
  not: (c: string, op: string, v: null) => Query;
  order: (c: string, o: { ascending: boolean; nullsFirst?: boolean }) => Query;
  range: (a: number, b: number) => Query;
  limit: (n: number) => Query;
  then: PromiseLike<{ data: Row[] | null; error: { message: string } | null; count?: number | null }>["then"];
};

export class ArchiveSource {
  constructor(
    private readonly db: SupabaseClient,
    private readonly catalog: ColumnCatalog,
    private readonly pageSize = 200
  ) {}

  private from(table: string): Query {
    return this.db.from(table) as unknown as Query;
  }

  columns(table: string, extraExclude: string[] = []): string {
    const all = this.catalog.get(table);
    if (!all || all.length === 0) throw new Error(`${table} 컬럼 목록이 없습니다`);
    const skip = new Set([...(HEAVY_COLUMNS[table] ?? []), ...extraExclude]);
    return all.filter((c) => !skip.has(c)).join(",");
  }

  private async pages(table: string, columns: string, refine: (q: Query) => Query, orderColumn = "id"): Promise<Row[]> {
    const rows: Row[] = [];
    for (let page = 0; page < 500; page += 1) {
      const from = page * this.pageSize;
      const q = refine(this.from(table).select(columns)).order(orderColumn, { ascending: true }).range(from, from + this.pageSize - 1);
      const { data, error } = await q;
      if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
      const batch = data ?? [];
      rows.push(...batch);
      if (batch.length < this.pageSize) return rows;
    }
    throw new Error(`${table} 조회가 너무 길어 중단했습니다`);
  }

  private async count(table: string, refine: (q: Query) => Query): Promise<number> {
    const { count, error } = await refine(this.from(table).select("id", { count: "exact", head: true }));
    if (error) throw new Error(`${table} 건수 조회 실패: ${error.message}`);
    return count ?? 0;
  }

  private monthFilter(spec: HaccpLogSpec, month: string): (q: Query) => Query {
    const start = `${month}-01`;
    const next = nextMonth(month);
    if (spec.dateKind === "timestamptz") {
      return (q) => q.gte(spec.dateColumn, kstDayStartIso(start)).lt(spec.dateColumn, kstDayStartIso(`${next}-01`));
    }
    return (q) => q.gte(spec.dateColumn, start).lt(spec.dateColumn, `${next}-01`);
  }

  async loadMonth(spec: HaccpLogSpec, month: string): Promise<{ headers: Row[]; items: Row[] }> {
    const filter = this.monthFilter(spec, month);
    const headers = await this.pages(spec.headerTable, this.columns(spec.headerTable), filter);
    const expected = await this.count(spec.headerTable, filter);
    if (headers.length !== expected) throw new Error(`${spec.label} ${month} 머리글 ${headers.length}건이 DB 건수 ${expected}건과 다릅니다`);
    if (!spec.itemTable || headers.length === 0) return { headers, items: [] };
    const items: Row[] = [];
    let expectedItems = 0;
    for (const ids of chunk(headers.map((h) => String(h.id)), 50)) {
      items.push(...(await this.pages(spec.itemTable, this.columns(spec.itemTable), (q) => q.in("log_id", ids))));
      expectedItems += await this.count(spec.itemTable, (q) => q.in("log_id", ids));
    }
    if (items.length !== expectedItems) throw new Error(`${spec.label} ${month} 세부항목 ${items.length}건이 DB 건수 ${expectedItems}건과 다릅니다`);
    return { headers, items };
  }

  /** 일지 생성 감사로그(가벼운 컬럼만). `${table}:${id}` → 가장 이른 생성 기록 */
  async loadCreateAudits(table: string, ids: string[]): Promise<Map<string, CreateAudit>> {
    const out = new Map<string, CreateAudit>();
    for (const group of chunk(ids, 100)) {
      const rows = await this.pages(
        "audit_logs",
        "id,target_id,created_at,actor_source,actor_user_id",
        (q) => q.eq("action", "create").eq("target_table", table).in("target_id", group),
        "created_at"
      );
      for (const row of rows) {
        const key = `${table}:${String(row.target_id)}`;
        if (!out.has(key)) out.set(key, { actor_source: row.actor_source ?? null, actor_user_id: row.actor_user_id ?? null });
      }
    }
    return out;
  }

  /** 사진 컬럼 내용은 읽지 않고, 사진이 있는 항목 ID만 받는다. */
  async photoPresentIds(table: string, photoColumn: string, itemIds: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (const ids of chunk(itemIds, 100)) {
      const rows = await this.pages(table, "id", (q) => q.in("id", ids).not(photoColumn, "is", null));
      for (const row of rows) out.add(String(row.id));
    }
    return out;
  }

  async loadProfiles(): Promise<Map<string, ProfileLite>> {
    const rows = await this.pages("profiles", "id,display_name,login_id", (q) => q);
    return new Map(rows.map((r) => [String(r.id), { display_name: (r.display_name as string) ?? null, login_id: (r.login_id as string) ?? null }]));
  }

  async loadEquipment(): Promise<EquipmentMasterRow[]> {
    const rows = await this.pages("equipment_master", "id,management_no,equipment_name,display_name,floor_label,organization_code", (q) => q);
    return rows as unknown as EquipmentMasterRow[];
  }

  async loadCorrections(): Promise<CorrectionRow[]> {
    const rows = await this.pages("data_corrections", this.columns("data_corrections"), (q) => q, "created_at");
    return rows.map((r) => ({
      id: String(r.id),
      created_at: String(r.created_at),
      kind: (r.kind as string) ?? null,
      target_table: String(r.target_table),
      target_ids: ((r.target_ids as string[]) ?? []).map(String),
      reason: (r.reason as string) ?? null,
      requested_by_name: (r.requested_by_name as string) ?? null,
      approved_by_name: (r.approved_by_name as string) ?? null,
    }));
  }

  async loadCorrectionSnapshots(ids: string[]): Promise<Row[]> {
    const out: Row[] = [];
    for (const group of chunk(ids, 3)) {
      out.push(...(await this.pages("data_corrections", "id,before_snapshot", (q) => q.in("id", group))));
    }
    return out;
  }

  /** 일지 머리글 삭제 기록. 머리글 before_data 는 작아서 날짜 값만 뽑아 읽는다. */
  async loadHeaderDeletes(): Promise<DeleteEvent[]> {
    const tables = HACCP_LOGS.map((s) => s.headerTable);
    const rows = await this.pages(
      "audit_logs",
      "id,created_at,target_table,target_id,actor_display_name,target_label,d1:before_data->>inspection_date,d2:before_data->>thawing_date,d3:before_data->>received_at",
      (q) => q.eq("action", "delete").in("target_table", tables),
      "created_at"
    );
    return rows.map((r) => ({
      auditId: String(r.id),
      created_at: String(r.created_at),
      target_table: String(r.target_table),
      target_id: String(r.target_id ?? ""),
      actor_display_name: (r.actor_display_name as string) ?? null,
      target_label: (r.target_label as string) ?? null,
      recordDate: r.d1 ? String(r.d1) : r.d2 ? String(r.d2) : r.d3 ? formatKst(String(r.d3)).slice(0, 10) : null,
    }));
  }

  /** since 이후 바뀐 일지가 속한 달. 머리글 갱신시각과 감사로그(삭제 포함)를 함께 본다. */
  async changedMonthsSince(since: string): Promise<Set<string>> {
    const months = new Set<string>();
    const addDate = (spec: HaccpLogSpec, value: unknown) => {
      if (!value) return;
      const day = spec.dateKind === "timestamptz" ? formatKst(String(value)).slice(0, 10) : String(value).slice(0, 10);
      if (day) months.add(day.slice(0, 7));
    };
    for (const spec of HACCP_LOGS) {
      if (!this.catalog.get(spec.headerTable)?.includes("updated_at")) continue;
      const rows = await this.pages(spec.headerTable, `id,${spec.dateColumn}`, (q) => q.gte("updated_at", since));
      for (const row of rows) addDate(spec, row[spec.dateColumn]);
    }
    const tables = HACCP_LOGS.flatMap((s) => (s.itemTable ? [s.headerTable, s.itemTable] : [s.headerTable]));
    const audits = await this.pages("audit_logs", "id,target_table,target_id,action", (q) => q.gte("created_at", since).in("target_table", tables), "created_at");
    const headerIds = new Map<string, Set<string>>();
    const itemIds = new Map<string, Set<string>>();
    for (const a of audits) {
      const isHeader = HACCP_LOGS.some((s) => s.headerTable === a.target_table);
      const map = isHeader ? headerIds : itemIds;
      const set = map.get(String(a.target_table)) ?? new Set<string>();
      set.add(String(a.target_id));
      map.set(String(a.target_table), set);
    }
    // 머리글: 남아 있으면 날짜 조회, 삭제됐으면 삭제 기록의 날짜를 쓴다
    const deletes = headerIds.size > 0 ? await this.loadHeaderDeletes() : [];
    for (const [table, ids] of Array.from(headerIds)) {
      const spec = HACCP_LOGS.find((s) => s.headerTable === table)!;
      for (const group of chunk(Array.from(ids), 100)) {
        const rows = await this.pages(table, `id,${spec.dateColumn}`, (q) => q.in("id", group));
        for (const row of rows) addDate(spec, row[spec.dateColumn]);
      }
      for (const d of deletes) if (d.target_table === table && ids.has(d.target_id) && d.recordDate) months.add(d.recordDate.slice(0, 7));
    }
    // 세부항목: 남아 있는 항목의 머리글 날짜로 찾는다(삭제된 항목은 같은 저장에서 다시 만든 항목이나 머리글 변경으로 잡힌다)
    for (const [table, ids] of Array.from(itemIds)) {
      const spec = HACCP_LOGS.find((s) => s.itemTable === table)!;
      const logIds = new Set<string>();
      for (const group of chunk(Array.from(ids), 100)) {
        const rows = await this.pages(table, "id,log_id", (q) => q.in("id", group));
        for (const row of rows) logIds.add(String(row.log_id));
      }
      for (const group of chunk(Array.from(logIds), 100)) {
        const rows = await this.pages(spec.headerTable, `id,${spec.dateColumn}`, (q) => q.in("id", group));
        for (const row of rows) addDate(spec, row[spec.dateColumn]);
      }
    }
    return months;
  }

  async earliestMonth(): Promise<string | null> {
    let min: string | null = null;
    for (const spec of HACCP_LOGS) {
      const rows = await this.pages(spec.headerTable, `id,${spec.dateColumn}`, (q) => q.not(spec.dateColumn, "is", null).order(spec.dateColumn, { ascending: true }).limit(1), "id");
      const first = rows[0]?.[spec.dateColumn];
      if (!first) continue;
      const day = spec.dateKind === "timestamptz" ? formatKst(String(first)).slice(0, 10) : String(first).slice(0, 10);
      if (!min || day < min) min = day;
    }
    return min ? min.slice(0, 7) : null;
  }

  async earliestAuditDay(): Promise<string | null> {
    const { data, error } = await this.from("audit_logs").select("created_at").order("created_at", { ascending: true }).limit(1);
    if (error) throw new Error(`감사로그 시작일 조회 실패: ${error.message}`);
    const first = data?.[0]?.created_at;
    return first ? formatKst(String(first)).slice(0, 10) : null;
  }

  /** 하루치 감사로그. 가벼운 컬럼을 먼저 읽고, 변경 전후 값은 소량씩 따로 읽는다(사진 행은 3건씩). */
  async loadAuditDay(day: string): Promise<Row[]> {
    const start = kstDayStartIso(day);
    const end = kstDayStartIso(addKstDays(day, 1));
    const light = await this.pages("audit_logs", this.columns("audit_logs"), (q) => q.gte("created_at", start).lt("created_at", end), "created_at");
    const byId = new Map(light.map((r) => [String(r.id), r]));
    const photoRows = light.filter((r) => r.target_table === "daily_material_receiving_inspection_log_items").map((r) => String(r.id));
    const otherRows = light.filter((r) => r.target_table !== "daily_material_receiving_inspection_log_items").map((r) => String(r.id));
    for (const group of [...chunk(otherRows, 50), ...chunk(photoRows, 3)]) {
      const full = await this.pages("audit_logs", "id,before_data,after_data", (q) => q.in("id", group));
      for (const f of full) {
        const row = byId.get(String(f.id));
        if (row) {
          row.before_data = f.before_data ?? null;
          row.after_data = f.after_data ?? null;
        }
      }
    }
    return light.sort((a, b) => Number(a.chain_seq ?? 0) - Number(b.chain_seq ?? 0) || String(a.created_at).localeCompare(String(b.created_at)));
  }

  /** 사진이 있는 입고 항목 목록(사진 내용 없이) */
  async listPhotoItems(): Promise<Row[]> {
    return this.pages("daily_material_receiving_inspection_log_items", "id,log_id,line_index,item_name,created_at", (q) => q.not("label_photo_url", "is", null));
  }

  async receivingDates(logIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const group of chunk(logIds, 100)) {
      const rows = await this.pages("daily_material_receiving_inspection_logs", "id,received_at", (q) => q.in("id", group));
      for (const row of rows) out.set(String(row.id), formatKst(String(row.received_at)).slice(0, 10));
    }
    return out;
  }

  /** 사진 한 장만 읽는다. */
  async loadPhoto(itemId: string): Promise<string | null> {
    const rows = await this.pages("daily_material_receiving_inspection_log_items", "id,label_photo_url", (q) => q.eq("id", itemId));
    const value = rows[0]?.label_photo_url;
    return typeof value === "string" && value !== "" ? value : null;
  }
}

export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = nextMonth(m)) out.push(m);
  return out;
}

export function kstToday(now = new Date()): string {
  return formatKst(now.toISOString()).slice(0, 10);
}
