/**
 * 공통 마스터 데이터 (출고 계산기 + 관리자 페이지 동일 소스)
 */

export interface Material {
  id: string;
  materialName: string;
  boxWeightG: number;
  unitWeightG: number;
}

export interface BomRow {
  id: string;
  productName: string;
  materialName: string;
  bomGPerEa: number;
  basis: "완제품" | "도우";
}

export const INITIAL_MATERIALS: Material[] = [
  { id: "m1", materialName: "AG-91", boxWeightG: 10000, unitWeightG: 2500 },
  { id: "m2", materialName: "레드체다치즈", boxWeightG: 10000, unitWeightG: 2500 },
  { id: "m3", materialName: "고르곤졸라", boxWeightG: 0, unitWeightG: 0 },
  { id: "m4", materialName: "토핑 토마토소스", boxWeightG: 10000, unitWeightG: 5000 },
  { id: "m5", materialName: "도우 토마토소스", boxWeightG: 10000, unitWeightG: 5000 },
];

export const INITIAL_BOM: BomRow[] = [
  { id: "b1", productName: "마르게리따", materialName: "토핑 토마토소스", bomGPerEa: 20, basis: "완제품" },
  { id: "b2", productName: "마르게리따", materialName: "도우 토마토소스", bomGPerEa: 60, basis: "도우" },
  { id: "b3", productName: "파이브치즈", materialName: "AG-91", bomGPerEa: 75, basis: "완제품" },
];
