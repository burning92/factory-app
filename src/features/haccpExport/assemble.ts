import type { SupabaseClient } from "@supabase/supabase-js";
import { HACCP_LOGS, type HaccpLogSpec } from "@/features/haccpExport/catalog";
import type { AccountProfile } from "@/features/haccpExport/flags";
import { detectFloorFromColumn, detectFloorFromRecord, isColdTempColumn, type FloorValue } from "@/features/haccpExport/floor";
import {
  columnsOf,
  fetchAuditsForIds,
  fetchFilteredHeaders,
  fetchItemsForHeaders,
  fetchPages,
  fetchPeriodDeleteAudits,
  HaccpExportError,
  loadEquipmentMaster,
  loadProfilesWithOrg,
  loadServerColumnCatalog,
  type ColumnCatalog,
  type PhotoKind,
  type Row,
} from "@/features/haccpExport/load";
import { buildEquipmentFloorIndex, type EquipmentFloorIndex, type EquipmentMasterRow } from "@/features/haccpArchive/floors";

const CORRECTION_COLUMNS = "id,created_at,kind,target_table,target_ids,target_columns,reason,requested_by_name,approved_by_name,approved_at";
import { checkPhotos, type PhotoCheck } from "@/features/haccpExport/photos";

export type LoadedLog = {
  spec: HaccpLogSpec;
  headers: Row[];
  items: Row[];
  headerDbCount: number;
  itemDbCount: number;
  nullDateCount: number;
  /** 입고검수 항목 사진 종류(본문은 읽지 않음) */
  photoKinds: Map<string, PhotoKind>;
};

export type FloorTally = Record<FloorValue | "none", number> & { units: number };

export type ExportBundle = {
  from: string;
  to: string;
  generatedAt: string;
  logs: LoadedLog[];
  profiles: Map<string, AccountProfile>;
  audits: Map<string, Row[]>;
  deleteAudits: Row[];
  corrections: Row[];
  equipment: EquipmentFloorIndex;
  org000: Row[];
  org000SameDayOrg100: Row[];
  photos: Map<string, PhotoCheck>;
};

export function auditKey(table: string, id: string): string {
  return `${table}:${id}`;
}

export function tallyFloors(log: LoadedLog): FloorTally {
  const tally: FloorTally = { "1층": 0, "2층": 0, "3층": 0, none: 0, units: 0 };
  const add = (floor: FloorValue | null) => {
    tally.units += 1;
    if (floor == null) tally.none += 1;
    else tally[floor] += 1;
  };
  for (const item of log.items) add(detectFloorFromRecord(item));
  if (log.spec.key === "cold") {
    const columns = new Set<string>();
    for (const header of log.headers) {
      for (const key of Object.keys(header)) {
        if (isColdTempColumn(key)) columns.add(key);
      }
    }
    for (const header of log.headers) {
      for (const column of Array.from(columns)) add(detectFloorFromColumn(column));
    }
  }
  return tally;
}

async function fetchOrg000(admin: SupabaseClient, from: string, to: string, catalog: ColumnCatalog): Promise<{ rows: Row[]; sameDay: Row[] }> {
  const air = HACCP_LOGS.find((log) => log.key === "air");
  if (!air) return { rows: [], sameDay: [] };
  const columns = columnsOf(catalog, air.headerTable);
  const rows = await fetchPages(admin, air.headerTable, (query) =>
    query.eq("organization_code", "000").gte(air.dateColumn, from).lte(air.dateColumn, to)
  , columns);
  const dates = Array.from(new Set(rows.map((row) => String(row.inspection_date ?? "")).filter(Boolean)));
  if (dates.length === 0) return { rows, sameDay: [] };
  const sameDay = await fetchPages(admin, air.headerTable, (query) =>
    query.eq("organization_code", "100").in("inspection_date", dates)
  , columns);
  return { rows, sameDay };
}

function photoCheckOf(kind: PhotoKind | undefined): PhotoCheck | null {
  if (!kind) return { kind: "NULL", access: "대상 없음", httpStatus: "" };
  if (kind.kind === "empty") return { kind: "빈 문자열", access: "대상 없음", httpStatus: "" };
  if (kind.kind === "data") return { kind: "인라인 data URL", access: "DB에 본문 있음(엑셀 제외)", httpStatus: "" };
  return null;
}

export async function assembleExport(
  admin: SupabaseClient,
  specs: HaccpLogSpec[],
  from: string,
  to: string,
  options: { checkPhotos: boolean; catalog?: ColumnCatalog }
): Promise<ExportBundle> {
  const catalog = options.catalog ?? (await loadServerColumnCatalog());
  const logs: LoadedLog[] = [];
  for (const spec of specs) {
    const headers = await fetchFilteredHeaders(admin, spec, from, to, catalog);
    const items = await fetchItemsForHeaders(
      admin,
      spec,
      headers.rows.map((row) => String(row.id)),
      catalog
    );
    logs.push({
      spec,
      headers: headers.rows,
      items: items.rows,
      headerDbCount: headers.dbCount,
      itemDbCount: items.dbCount,
      nullDateCount: headers.nullDateCount,
      photoKinds: items.photoKinds,
    });
  }

  const profiles = await loadProfilesWithOrg(admin);
  const audits = new Map<string, Row[]>();
  for (const log of logs) {
    const headerAudits = await fetchAuditsForIds(
      admin,
      log.spec.headerTable,
      log.headers.map((row) => String(row.id)),
      catalog
    );
    for (const audit of headerAudits) {
      const key = auditKey(log.spec.headerTable, String(audit.target_id ?? ""));
      const list = audits.get(key) ?? [];
      list.push(audit);
      audits.set(key, list);
    }
    if (log.spec.itemTable) {
      const itemAudits = await fetchAuditsForIds(
        admin,
        log.spec.itemTable,
        log.items.map((row) => String(row.id)),
        catalog
      );
      for (const audit of itemAudits) {
        const key = auditKey(log.spec.itemTable, String(audit.target_id ?? ""));
        const list = audits.get(key) ?? [];
        list.push(audit);
        audits.set(key, list);
      }
    }
  }

  const deleteAudits = await fetchPeriodDeleteAudits(admin, logs, from, to, catalog);
  const org = await fetchOrg000(admin, from, to, catalog);
  const equipment = buildEquipmentFloorIndex((await loadEquipmentMaster(admin)) as unknown as EquipmentMasterRow[]);
  const periodIds = new Set<string>([
    ...logs.flatMap((log) => log.headers.map((row) => String(row.id))),
    ...deleteAudits.map((row) => String(row.일지ID ?? "")),
  ]);
  const corrections = (await fetchPages(admin, "data_corrections", (query) => query, CORRECTION_COLUMNS)).filter((row) =>
    ((row.target_ids as string[] | null) ?? []).some((id) => periodIds.has(String(id)))
  );

  const photos = new Map<string, PhotoCheck>();
  if (options.checkPhotos) {
    const receiving = logs.find((log) => log.spec.photoColumn);
    if (receiving) {
      const urls: { id: string; url: unknown }[] = [];
      for (const row of receiving.items) {
        const id = String(row.id);
        const kind = receiving.photoKinds.get(id);
        const fixed = photoCheckOf(kind);
        if (fixed) photos.set(id, fixed);
        else urls.push({ id, url: kind?.url });
      }
      const checked = await checkPhotos(urls);
      checked.forEach((photo, id) => photos.set(id, photo));
    }
  }

  return {
    from,
    to,
    generatedAt: new Date().toISOString(),
    logs,
    profiles,
    audits,
    deleteAudits,
    corrections,
    equipment,
    org000: org.rows,
    org000SameDayOrg100: org.sameDay,
    photos,
  };
}

export function headerAuditCount(log: LoadedLog, headerId: string, audits: Map<string, Row[]>): number {
  let count = audits.get(auditKey(log.spec.headerTable, headerId))?.length ?? 0;
  if (!log.spec.itemTable) return count;
  for (const item of log.items) {
    if (String(item.log_id) !== headerId) continue;
    count += audits.get(auditKey(log.spec.itemTable, String(item.id)))?.length ?? 0;
  }
  return count;
}

export function assertBundleCounts(bundle: ExportBundle): { headerTotal: number; itemTotal: number } {
  let headerTotal = 0;
  let itemTotal = 0;
  for (const log of bundle.logs) {
    if (log.headers.length !== log.headerDbCount || log.items.length !== log.itemDbCount) {
      throw new HaccpExportError(`${log.spec.label} 메모리 건수와 DB 건수가 다릅니다.`);
    }
    headerTotal += log.headers.length;
    itemTotal += log.items.length;
  }
  return { headerTotal, itemTotal };
}
