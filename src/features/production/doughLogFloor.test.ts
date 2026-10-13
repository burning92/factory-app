import { describe, expect, it } from "vitest";
import { mergeDoughFloor, readDoughFloors, removeDoughFloor } from "./doughLogFloor";

const floor2 = {
  author_name: "김동호",
  dough_date: "2026-10-13",
  target_quantity: 3840,
  dough_id: "1",
  hydration_percent: 58,
  dough_ingredients: { 밀가루: [{ 사용량_g: 500000, lot: "2027-04-07" }] },
  dust_oil: { "덧가루-밀가루": [{ 사용량_g: 25000, lot: "2027-04-07" }] },
};

const floor3 = {
  author_name: "조선영",
  dough_date: "2026-10-13",
  target_quantity: 3000,
  dough_id: "3",
  hydration_percent: 58,
  dough_ingredients: { 밀가루: [{ 사용량_g: 320000, lot: "2027-04-07" }] },
  dust_oil: { "덧가루-세몰리나": [{ 사용량_g: 50000, lot: "2027-04-23" }] },
};

describe("dough log floors", () => {
  it("keeps the other floor when one floor is saved again", () => {
    const with2 = mergeDoughFloor({ dough_id: "old" }, "2F", floor2);
    const withBoth = mergeDoughFloor(with2, "3F", floor3);
    const replaced2 = mergeDoughFloor(withBoth, "2F", { ...floor2, target_quantity: 3900 });
    const floors = readDoughFloors(replaced2);

    expect(floors?.["2F"]?.target_quantity).toBe(3900);
    expect(floors?.["2F"]?.dough_ingredients["밀가루"]?.[0]?.사용량_g).toBe(500000);
    expect(floors?.["3F"]?.dough_ingredients["밀가루"]?.[0]?.사용량_g).toBe(320000);
    expect(floors?.["3F"]?.author_name).toBe("조선영");
    expect(replaced2.dough_id).toBeUndefined();
  });

  it("drops only the deleted floor", () => {
    const both = mergeDoughFloor(mergeDoughFloor(null, "2F", floor2), "3F", floor3);
    const removed = removeDoughFloor(both, "3F");
    expect(removed.empty).toBe(false);
    expect(readDoughFloors(removed.meta)?.["2F"]?.target_quantity).toBe(3840);
    expect(readDoughFloors(removed.meta)?.["3F"]).toBeUndefined();

    const cleared = removeDoughFloor(removed.meta, "2F");
    expect(cleared.empty).toBe(true);
    expect(readDoughFloors(cleared.meta)).toBeNull();
  });

  it("treats a row without floors as one combined record", () => {
    expect(readDoughFloors({ dough_id: "1", target_quantity: 6800 })).toBeNull();
    expect(readDoughFloors(null)).toBeNull();
  });
});
