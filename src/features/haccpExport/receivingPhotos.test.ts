import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HACCP_LOGS } from "@/features/haccpExport/catalog";
import { fetchItemsForHeaders } from "@/features/haccpExport/load";
import { RECEIVING_ITEMS_TABLE } from "@/features/daily/receivingPhotoQuery";

type Row = Record<string, unknown>;
type Call = { table: string; columns: string; head: boolean; inColumn?: string; inValues?: string[] };

function mockClient(rows: Row[]) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, columns: "", head: false };
      let range: [number, number] | null = null;
      const builder = {
        select(columns: string, options?: { head?: boolean }) {
          call.columns = columns;
          call.head = Boolean(options?.head);
          return builder;
        },
        in(column: string, values: string[]) {
          call.inColumn = column;
          call.inValues = values;
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
          const matched = rows.filter((row) => call.inValues?.includes(String(row[call.inColumn ?? ""])));
          if (call.head) return resolve({ count: matched.length, error: null });
          const wanted = call.columns === "*" ? null : call.columns.split(",").map((c) => c.trim());
          const projected = matched.map((row) =>
            wanted ? Object.fromEntries(wanted.map((c) => [c, row[c] ?? null])) : { ...row }
          );
          const sliced = range ? projected.slice(range[0], range[1] + 1) : projected;
          return resolve({ data: sliced, error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("입고검수 항목 사진 분할 조회", () => {
  const spec = HACCP_LOGS.find((log) => log.itemTable === RECEIVING_ITEMS_TABLE)!;
  const rows: Row[] = Array.from({ length: 12 }, (_, i) => ({
    id: `item-${String(i).padStart(2, "0")}`,
    log_id: i < 7 ? "log-a" : "log-b",
    line_index: i,
    item_name: `품목${i}`,
    label_photo_url: i % 3 === 0 ? null : `data:image/jpeg;base64,PHOTO${i}`,
  }));

  it("항목 본문 조회에는 사진 컬럼을 넣지 않고, 사진은 5건 이하로 나눠 읽는다", async () => {
    const { client, calls } = mockClient(rows);
    const result = await fetchItemsForHeaders(client, spec, ["log-a", "log-b"]);

    const dataCalls = calls.filter((call) => !call.head);
    const bodyCalls = dataCalls.filter((call) => call.inColumn === "log_id");
    const photoCalls = dataCalls.filter((call) => call.inColumn === "id");
    expect(bodyCalls.length).toBeGreaterThan(0);
    for (const call of bodyCalls) {
      expect(call.columns).not.toBe("*");
      expect(call.columns).not.toContain("label_photo_url");
    }
    expect(photoCalls.length).toBe(3);
    for (const call of photoCalls) expect(call.inValues!.length).toBeLessThanOrEqual(5);

    expect(result.dbCount).toBe(12);
    const byId = new Map(result.rows.map((row) => [row.id, row]));
    for (const row of rows) expect(byId.get(row.id)?.label_photo_url).toBe(row.label_photo_url);
  });
});
