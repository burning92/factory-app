import { createHash } from "node:crypto";
import type { LogBundle, Row } from "@/features/haccpArchive/sheetModel";
import { provenanceLabel, STORAGE_LABEL, type CreateAudit } from "@/features/haccpArchive/provenance";

/** 키 순서를 고정한 JSON. 같은 내용이면 항상 같은 SHA-256 이 나온다. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function md5Hex(data: Buffer): string {
  return createHash("md5").update(data).digest("hex");
}

function byId(a: Row, b: Row): number {
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
}

/** 월별 원본백업. content 는 생성시각을 넣지 않아 내용이 같으면 해시가 같다. */
export function buildMonthBackup(month: string, logs: LogBundle[], photoItemIds: Set<string>, createAudits: Map<string, CreateAudit> = new Map()) {
  const content = {
    kind: "haccp-daily-log-month",
    month,
    storage: STORAGE_LABEL,
    provenance_note: "작성 경로는 일지 생성 감사로그가 있을 때만 적는다. 없으면 출처 미확인이며 AppSheet 원본과 대조한다.",
    note: "사진 원본(base64)은 이 파일에 넣지 않는다. has_label_photo=true 인 항목의 사진은 라벨사진 폴더에 따로 보관한다.",
    logs: logs.map((log) => ({
      key: log.spec.key,
      label: log.spec.label,
      header_table: log.spec.headerTable,
      item_table: log.spec.itemTable,
      headers: [...log.headers].sort(byId),
      provenance: Object.fromEntries(
        [...log.headers].sort(byId).map((h) => [String(h.id), provenanceLabel(createAudits.get(`${log.spec.headerTable}:${String(h.id)}`))])
      ),
      items: [...log.items]
        .sort(byId)
        .map((item) => (log.spec.photoColumn ? { ...item, has_label_photo: photoItemIds.has(String(item.id)) } : item)),
    })),
  };
  const body = canonicalJson(content);
  return { body, sha256: sha256Hex(body), headerCount: logs.reduce((s, l) => s + l.headers.length, 0), itemCount: logs.reduce((s, l) => s + l.items.length, 0) };
}

export type ChainCheck = { ok: boolean; firstSeq: number | null; lastSeq: number | null; lastHash: string | null; problems: string[] };

/**
 * 감사로그 해시 체인 연결 확인(순번 연속, prev_hash = 직전 row_hash).
 * row_hash 재계산은 DB 의 텍스트 표현에 의존하므로 하지 않는다.
 */
export function checkAuditChain(rows: Row[], previous: { seq: number | null; hash: string | null }): ChainCheck {
  const problems: string[] = [];
  const chained = rows.filter((r) => r.chain_seq !== null && r.chain_seq !== undefined);
  let seq = previous.seq;
  let hash = previous.hash;
  for (const row of chained) {
    const current = Number(row.chain_seq);
    if (seq !== null && current !== seq + 1) problems.push(`순번 ${seq} 다음이 ${current}`);
    if (seq !== null && hash !== null && current === seq + 1 && (row.prev_hash ?? null) !== hash) problems.push(`순번 ${current} 의 prev_hash 불일치`);
    seq = current;
    hash = (row.row_hash as string) ?? null;
  }
  return {
    ok: problems.length === 0,
    firstSeq: chained.length ? Number(chained[0].chain_seq) : null,
    lastSeq: seq,
    lastHash: hash,
    problems,
  };
}

export function buildAuditDayBackup(day: string, rows: Row[], chain: ChainCheck) {
  const content = {
    kind: "haccp-audit-log-day",
    day,
    timezone: "Asia/Seoul",
    storage: STORAGE_LABEL,
    row_count: rows.length,
    chain: { ok: chain.ok, first_seq: chain.firstSeq, last_seq: chain.lastSeq, problems: chain.problems },
    rows,
  };
  const body = canonicalJson(content);
  return { body, sha256: sha256Hex(body) };
}
