import type { Person, ProcessId, ProductGroup, ProductLine } from "./types";

function p(
  name: string,
  preferred: ProcessId,
  opts?: Partial<Pick<Person, "shift" | "group" | "present">>
): Person {
  const group = opts?.group ?? "floor";
  return {
    id: name,
    name,
    preferred,
    shift: opts?.shift ?? "0800-1800",
    group,
    present: opts?.present ?? true,
  };
}

export const SEED_ROSTER: Person[] = [
  p("조선영", "dough"),
  p("이진화", "dough"),
  p("이병일", "dough"),
  p("임정우", "heating"),
  p("김다슬", "heating"),
  p("김옥", "heating"),
  p("정미경", "heating"),
  p("손학모", "heating"),
  p("최대열", "heating"),
  p("송문광", "heating"),
  p("홍수정", "heating"),
  p("한진", "heating"),
  p("김동호", "heating"),
  p("김소영", "inner"),
  p("김성아", "inner"),
  p("심수덕", "inner"),
  p("이두승", "inner"),
  p("신미경", "inner"),
  p("곽민정", "outer"),
  p("한상수", "outer"),
  p("한상혁", "outer"),
  p("김순이", "topping"),
  p("고은주", "topping"),
  p("장야핑", "topping"),
  p("신민아", "heating", { present: false }),
  p("홍수빈", "heating", { present: false }),
  p("박서은", "topping", { present: false }),
  p("최민권", "office", { group: "office", present: false }),
];

/** 주공정 외, 예전 배치 이력에서 본 대체 가능 공정. 가열 세부포지션은 넣지 않음. */
export const LEGACY_EXTRA_PROCESSES: Record<string, ProcessId[]> = {
  조선영: ["inner"],
  이진화: ["inner"],
  이병일: ["inner"],
  임정우: ["dough"],
  홍수정: ["topping"],
  한진: ["outer"],
  김동호: ["rnd"],
  김성아: ["topping"],
  심수덕: ["outer"],
  신미경: ["office"],
  고은주: ["inner"],
  장야핑: ["inner"],
};

export const DOUGH_CORE_IDS = ["조선영", "이진화", "이병일"] as const;

export const PRODUCT_LINES: { id: ProductLine; label: string; group: ProductGroup }[] = [
  { id: "phono_signature", label: "포노부오노 시그니처 화덕 브레드", group: "phono_signature" },
  { id: "phono_basil", label: "포노부오노 바질&허니 화덕 브레드", group: "phono_basil_corn" },
  { id: "phono_corn", label: "포노부오노 초당옥수수 화덕 브레드", group: "phono_basil_corn" },
  { id: "phono_ricotta", label: "포노부오노 리코타&허니 화덕 브레드", group: "phono_ricotta" },
  { id: "parbake", label: "파베이크", group: "parbake" },
];

export const PRODUCT_GROUPS: { id: ProductGroup; label: string }[] = [
  { id: "phono_signature", label: "포노 시그니처" },
  { id: "phono_basil_corn", label: "포노 바질&허니 · 초당옥수수" },
  { id: "phono_ricotta", label: "포노 리코타&허니" },
  { id: "parbake", label: "파베이크" },
];

export function productGroup(line: ProductLine): ProductGroup {
  return PRODUCT_LINES.find((p) => p.id === line)?.group ?? "phono_signature";
}

export const HOURLY_QTY: Record<ProductGroup, number> = {
  parbake: 400,
  phono_signature: 500,
  phono_basil_corn: 500,
  phono_ricotta: 500,
};

export const STORAGE_KEY = "production-rotation-v2";
