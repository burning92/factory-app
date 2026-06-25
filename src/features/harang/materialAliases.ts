/** 동일 원료인데 마스터·입고·BOM 표기가 다른 경우 */
const HARANG_MATERIAL_ALIAS_GROUPS: string[][] = [
  ["레드체다치즈", "DK슈레드체다치즈"],
];

function compactMaterialName(name: string): string {
  return name.replace(/\s/g, "").toLowerCase();
}

function aliasGroupForName(name: string): string[] | null {
  const compact = compactMaterialName(name);
  for (const group of HARANG_MATERIAL_ALIAS_GROUPS) {
    if (group.some((entry) => compactMaterialName(entry) === compact)) {
      return group;
    }
  }
  return null;
}

/** BOM·체크리스트 표시용 대표명 (그룹 첫 항목) */
export function canonicalHarangMaterialName(name: string): string {
  const group = aliasGroupForName(name);
  return group?.[0] ?? name.trim();
}

export function harangMaterialNamesEquivalent(a: string, b: string): boolean {
  if (compactMaterialName(a) === compactMaterialName(b)) return true;
  const ga = aliasGroupForName(a);
  const gb = aliasGroupForName(b);
  return ga !== null && ga === gb;
}

export function resolveEquivalentRawMaterialIds(
  materialName: string,
  materialId: string,
  rawMaterials: Array<{ id: string; item_name: string }>,
): Set<string> {
  const ids = new Set<string>([materialId]);
  for (const row of rawMaterials) {
    if (harangMaterialNamesEquivalent(materialName, row.item_name)) {
      ids.add(String(row.id));
    }
  }
  return ids;
}
