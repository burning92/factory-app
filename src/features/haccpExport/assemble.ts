import type { SupabaseClient } from "@supabase/supabase-js";
import { HACCP_LOGS, type HaccpLogSpec } from "@/features/haccpExport/catalog";
import type { AccountProfile } from "@/features/haccpExport/flags";
import { detectFloorFromColumn, detectFloorFromRecord, isColdTempColumn, type FloorValue } from "@/features/haccpExport/floor";
import {
  fetchDeleteAudits,
  fetchAuditsForIds,
  fetchFilteredHeaders,
  fetchItemsForHeaders,
  fetchPages,
  HaccpExportError,
  loadProfilesWithOrg,
  type Row,
} from "@/features/haccpExport/load";
import { checkPhotos, type PhotoCheck } from "@/features/haccpExport/photos";

export type LoadedLog = {
  spec: HaccpLogSpec;
  headers: Row[];
  items: Row[];
  headerDbCount: number;
  itemDbCount: number;
  nullDateCount: number;
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

async function fetchOrg000(admin: SupabaseClient, from: string, to: string): Promise<{ rows: Row[]; sameDay: Row[] }> {
  const air = HACCP_LOGS.find((log) => log.key === "air");
  if (!air) return { rows: [], sameDay: [] };
  const rows = await fetchPages(admin, air.headerTable, (query) =>
    query.eq("organization_code", "000").gte(air.dateColumn, from).lte(air.dateColumn, to)
  );
  const dates = Array.from(new Set(rows.map((row) => String(row.inspection_date ?? "")).filter(Boolean)));
  if (dates.length === 0) return { rows, sameDay: [] };
  const sameDay = await fetchPages(admin, air.headerTable, (query) =>
    query.eq("organization_code", "100").in("inspection_date", dates)
  );
  return { rows, sameDay };
}

export async function assembleExport(
  admin: SupabaseClient,
  specs: HaccpLogSpec[],
  from: string,
  to: string,
  options: { checkPhotos: boolean }
): Promise<ExportBundle> {
  const logs: LoadedLog[] = [];
  for (const spec of specs) {
    const headers = await fetchFilteredHeaders(admin, spec, from, to);
    const items = await fetchItemsForHeaders(
      admin,
      spec,
      headers.rows.map((row) => String(row.id))
    );
    logs.push({
      spec,
      headers: headers.rows,
      items: items.rows,
      headerDbCount: headers.dbCount,
      itemDbCount: items.dbCount,
      nullDateCount: headers.nullDateCount,
    });
  }

  const profiles = await loadProfilesWithOrg(admin);
  const audits = new Map<string, Row[]>();
  const tables: string[] = [];
  for (const log of logs) {
    tables.push(log.spec.headerTable);
    const headerAudits = await fetchAuditsForIds(
      admin,
      log.spec.headerTable,
      log.headers.map((row) => String(row.id))
    );
    for (const audit of headerAudits) {
      const key = auditKey(log.spec.headerTable, String(audit.target_id ?? ""));
      const list = audits.get(key) ?? [];
      list.push(audit);
      audits.set(key, list);
    }
    if (log.spec.itemTable) {
      tables.push(log.spec.itemTable);
      const itemAudits = await fetchAuditsForIds(
        admin,
        log.spec.itemTable,
        log.items.map((row) => String(row.id))
      );
      for (const audit of itemAudits) {
        const key = auditKey(log.spec.itemTable, String(audit.target_id ?? ""));
        const list = audits.get(key) ?? [];
        list.push(audit);
        audits.set(key, list);
      }
    }
  }

  const deleteAudits = await fetchDeleteAudits(admin, Array.from(new Set(tables)));
  const org = await fetchOrg000(admin, from, to);

  const photos = new Map<string, PhotoCheck>();
  if (options.checkPhotos) {
    const receiving = logs.find((log) => log.spec.photoColumn);
    if (receiving?.spec.photoColumn) {
      const column = receiving.spec.photoColumn;
      const checked = await checkPhotos(
        receiving.items.map((row) => ({ id: String(row.id), url: row[column] }))
      );
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
