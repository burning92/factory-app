import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HACCP_LOGS } from "@/features/haccpExport/catalog";
import { fetchItemsForHeaders, fetchPages, PHOTO_OMITTED_MARK } from "@/features/haccpExport/load";
import { RECEIVING_ITEMS_TABLE } from "@/features/daily/receivingPhotoQuery";

type Row = Record<string, unknown>;
type Pred = (row: Row) => boolean;
type Call = { table: string; columns: string; head: boolean; preds: Pred[] };

function likeMatch(value: unknown, pattern: string) {
  if (typeof value !== "string") return false;
  return pattern.endsWith("*") ? value.startsWith(pattern.slice(0, -1)) : value === pattern;
}

function mockClient(rows: Row[]) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, columns: "", head: false, preds: [] };
      let range: [number, number] | null = null;
      const builder = {
        select(columns: string, options?: { head?: boolean }) {
          call.columns = columns;
          call.head = Boolean(options?.head);
          return builder;
        },
        in(column: string, values: string[]) {
          call.preds.push((row) => values.includes(String(row[column])));
          return builder;
        },
        eq(column: string, value: unknown) {
          call.preds.push((row) => row[column] === value);
          return builder;
        },
        like(column: string, pattern: string) {
          call.preds.push((row) => likeMatch(row[column], pattern));
          return builder;
        },
        not(column: string, op: string, value: unknown) {
          call.preds.push((row) => {
            const v = row[column];
            if (op === "is") return v !== value;
            if (v == null) return false;
            if (op === "like") return !likeMatch(v, String(value));
            if (op === "eq") return v !== value;
            throw new Error(`지원하지 않는 연산 ${op}`);
          });
          return builder;
        },
        order() {
          return builder;
        },
        range(from: number, to: number) {
          range = [from, to];
          return builder;
        },
        then(resolve: (value: unknown) => void) {
          calls.push(call);
          const matched = rows.filter((row) => call.preds.every((p) => p(row)));
          if (call.head) return resolve({ count: matched.length, error: null });
          const wanted = call.columns.split(",").map((c) => c.trim());
          const projected = matched.map((row) => Object.fromEntries(wanted.map((c) => [c, row[c] ?? null])));
          const sliced = range ? projected.slice(range[0], range[1] + 1) : projected;
          return resolve({ data: sliced, error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("입고검수 항목 사진 조회", () => {
  const spec = HACCP_LOGS.find((log) => log.itemTable === RECEIVING_ITEMS_TABLE)!;
  const photoOf = (i: number) => {
    if (i % 4 === 0) return null;
    if (i % 4 === 1) return `data:image/jpeg;base64,PHOTO${i}`;
    if (i % 4 === 2) return `https://example.com/p${i}.jpg`;
    return "";
  };
  const rows: Row[] = Array.from({ length: 12 }, (_, i) => ({
    id: `item-${String(i).padStart(2, "0")}`,
    log_id: i < 7 ? "log-a" : "log-b",
    line_index: i,
    item_name: `품목${i}`,
    label_photo_url: photoOf(i),
  }));

  it("base64 사진 본문은 어떤 조회로도 받지 않고, 표시 문구로 바꾼다", async () => {
    const { client, calls } = mockClient(rows);
    const result = await fetchItemsForHeaders(client, spec, ["log-a", "log-b"]);

    const photoColumnCalls = calls.filter((call) => !call.head && call.columns.includes("label_photo_url"));
    for (const call of photoColumnCalls) {
      const visible = rows.filter((row) => call.preds.every((p) => p(row)));
      expect(visible.every((row) => !String(row.label_photo_url ?? "").startsWith("data:"))).toBe(true);
    }
    for (const call of calls) expect(call.columns).not.toBe("*");

    expect(result.dbCount).toBe(12);
    const byId = new Map(result.rows.map((row) => [row.id, row]));
    rows.forEach((row, i) => {
      const got = byId.get(row.id)?.label_photo_url;
      if (i % 4 === 0) expect(got).toBeNull();
      if (i % 4 === 1) expect(got).toBe(PHOTO_OMITTED_MARK);
      if (i % 4 === 2) expect(got).toBe(row.label_photo_url);
      if (i % 4 === 3) expect(got).toBe("");
    });
    expect(result.photoKinds.get("item-01")).toEqual({ kind: "data" });
    expect(JSON.stringify(result.rows)).not.toContain("base64");
  });

  it("select=* 조회는 거부한다", async () => {
    const { client } = mockClient(rows);
    await expect(fetchPages(client, RECEIVING_ITEMS_TABLE, (q) => q, "*")).rejects.toThrow(/컬럼을 명시/);
  });
});
