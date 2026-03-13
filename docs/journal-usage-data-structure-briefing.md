# 생산/소비기한 관리일지 · 사용량 계산 페이지 — 데이터 구조 브리핑

현재 **관리일지 출력** (`/production/print`) 및 **사용량 계산** (`/production/history`) 페이지에서 사용 중인 데이터 구조, 타입, 상태, 가공 변수를 정리한 문서입니다. UI/UX 프롬프트 작성 시 참고용입니다.

---

## 1. 핵심 상태(State) 및 데이터 객체 이름

### 1.1 Store에서 날짜(date) 기준으로 불러오는 메인 데이터

| 객체명 | 설명 | 기준 키 |
|--------|------|----------|
| **productionLogs** | 출고(생산) 기록 배열. 생산일자·제품별·원료별 행. | `생산일자`, `제품명`, `원료명` |
| **usageCalculations** | 사용량 계산 저장 데이터 배열 (전일/당일 재고, 완제품 수량 등). | `production_date`, `product_name` |
| **doughLogsMap** | 반죽 사용량 기록. `usage_date`(사용일자) → DoughLogRecord. | `사용일자` (= 생산일자와 매칭) |
| **bomList** | 제품 BOM 목록 (원료별 g/ea, 완제품/도우 기준). | `productName`, `materialName`, `basis` |
| **materials** | 원료 마스터 (원료명, 박스중량g, 단위중량g). | `materialName` |

### 1.2 관리일지 출력 페이지 (`/production/print`)

- **date** (useState): 사용자가 선택한 대상 날짜. `productionLogs`를 이 날짜로 필터링.
- **groups**: `groupLogsByProductAndDate(productionLogs, date)` 결과. `{ 생산일자, 제품명, logs }[]` — **날짜당 제품별**로 그룹화된 배열.
- 각 그룹에 대해 **doughData** = `getDoughLogByDate(생산일자)`, **usageCalculation** = `getUsageCalculation(생산일자, 제품명)` 으로 조회.

### 1.3 사용량 계산 페이지 (`/production/history`)

- **productionDate**, **productName**: 선택한 생산일자·제품명 (URL 쿼리로 수정 모드 진입 가능).
- **materialsData**: 원료별 전일/당일 재고 (LOT별). `UsageCalculationRecord["materials_data"]` 형태.
- **productionLogs**, **usageCalculations**: Store 전체 목록에서 해당 일자·제품으로 필터/조회.

---

## 2. TypeScript 인터페이스 (Types / Interfaces)

### 2.1 Store 공통 (useMasterStore.ts)

```typescript
/** 소비기한별 출고 라인 */
export interface OutboundLine {
  소비기한: string;
  박스: number;
  낱개: number;
  g: number;
  prior_stock_g?: number;
  closing_remainder_g?: number;
  actual_usage_g?: number;
}

/** 미리 구워놓은 파베이크 사용 한 줄 (수량 + 소비기한) */
export interface ParbakeUsedLine {
  qty: number;
  expiry: string;
}

/** 도우 반죽 공정: 원료별 LOT 한 줄 */
export interface DoughProcessLine {
  사용량_g: number;
  lot: string;
}

/** 출고 기록 (생산 로그) */
export interface ProductionLog {
  id: string;
  생산일자: string;
  제품명: string;
  원료명: string;
  출고_라인?: OutboundLine[];
  출고_박스: number;
  출고_낱개: number;
  출고_g: number;
  일차사용량_g?: number;
  실사용량_g?: number;
  전일재고_g?: number;
  당일잔량_g?: number;
  소스폐기량_g?: number;
  소스폐기량_소비기한?: string;
  상태: "출고됨" | "마감완료";
  출고자?: string;
  작성자2?: string;
  승인자?: string;
  소비기한?: string;
  반죽량?: number;
  반죽폐기량?: number;
  작업자?: string;
  완제품예상수량?: number;
  완제품생산량?: number;
  파베이크사용_라인?: ParbakeUsedLine[];
  보관용파베이크?: number;
  판매용파베이크?: number;
  dough_data?: DoughProcessData;
}

/** 도우 반죽 공정 입력 데이터 */
export interface DoughProcessData {
  반죽날짜: string;
  사용일자: string;
  작성자명: string;
  반죽원료: Record<string, DoughProcessLine[]>;
  덧가루덧기름: Record<string, DoughProcessLine[]>;
}

/** Independent dough log (사용일자 기준). 관리일지에서 생산일자와 매칭 */
export interface DoughLogRecord {
  사용일자: string;
  작성자명: string;
  반죽원료: Record<string, DoughProcessLine[]>;
  덧가루덧기름: Record<string, DoughProcessLine[]>;
  반죽일자?: string;
  예상수량?: number;
  dough_id?: string;
}

/** 사용량 계산: 원료별 전일/당일 재고 다중 LOT */
export interface MaterialStockLot {
  qty_g: number;
  expiry: string;
}

export interface UsageCalculationRecord {
  id?: string;
  production_date: string;
  product_name: string;
  author_name?: string;
  dough_usage_g?: number;
  dough_usage_qty?: number;
  dough_waste_g?: number;
  dough_waste_qty?: number;
  finished_qty_expected?: number;
  finished_qty_actual?: number;
  parbake_add_qty?: number;
  parbake_woozooin_qty?: number;
  parbake_sales_qty?: number;
  status?: "draft" | "stock_entered" | "closed";
  materials_data: Record<
    string,
    { prior_stock: MaterialStockLot[]; closing_stock: MaterialStockLot[] }
  >;
}
```

### 2.2 BOM / 원료 마스터 (lib/mockData.ts)

```typescript
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
```

### 2.3 관리일지 내부에서만 쓰는 로컬 타입 (print/page.tsx)

- **MainLine**: `{ 출고량_g, lot, 전일재고, 당일재고, 사용량 }`
- **MainRowGrouped**: `{ 원료명, bomG, lines: MainLine[] }`
- **LotLine**: `{ 출고량_g, lot, 전일, 당일, 사용량 }`
- **sourceUsageEntries** 항목: `{ 원료명, 최종사용량_g, 폐기량_g, lot }`

---

## 3. 현재 렌더링을 위해 가공하는 주요 변수들

### 3.1 관리일지 출력 (`/production/print`)

- **groups** = `groupLogsByProductAndDate(productionLogs, date)`  
  → 날짜별·제품별 그룹 `{ 생산일자, 제품명, logs }[]`.

- **materialsList** = `materials`를 `{ materialName, boxWeightG, unitWeightG }[]` 형태로 매핑.

**JournalSection 내부 (제품·일자 단위):**

- **productBom** = 해당 제품의 BOM 행. **도우Bom** / **메인Bom** = basis로 분리.
- **logByMaterial** = `Map<원료명, ProductionLog>` (해당 그룹의 logs 기준).
- **mainRowsGrouped** = 메인 원료 행 그룹 (원료명 기준, LOT별 출고/전일/당일/사용량). 파베이크 사용 라인 병합.
- **doughRows** = 도우 기준 BOM 원료 행 (출고량, LOT, 전일/당일재고, 사용량).
- **sourceUsageEntries** = 도우 소스 원료별 최종 사용량·폐기량 (소스 폐기 비례 배분 반영).
- **getPriorClosingByLot(원료명, lot)** = `usageCalculation.materials_data`에서 해당 LOT의 전일/당일 재고 조회.
- **buildLotLines(...)** = 한 원료의 LOT 라인 배열 (출고·소비기한·전일·당일·사용량 1:1 매칭).
- **unifiedMaterialRows** = 6열 표용 통합 원료 행 (원료명 | 출고량(BOM) | 소비기한 | 전일재고 | 당일재고 | 사용량). 메인 + 소스 + 도우 순으로 병합, `seen`으로 중복 원료명 제거.
- **완제품실수량**, **소비기한**, **작성자**, **반죽량**, **반죽폐기량**, **파베이크폐기량**, **도우사용량**, **파베이크생산량**, **완제품예상수량** 등 = first log 또는 usageCalculation 기반 표시값.

### 3.2 사용량 계산 (`/production/history`)

- **productOptions** = 선택한 생산일자에 출고된 제품명 목록 (배열).
- **outboundTotalsMap** = `getOutboundTotalsByDateProduct(productionDate, productName)` → 해당 일자·제품의 원료별 출고 총량(g).
- **stockRows** = 재고 입력 테이블용 행 배열. 출고 LOT + materialsData의 prior/closing 병합, 사용량 = 출고량 + 전일재고 - 당일재고. 정렬: 원료명 오름차순, 같은 원료 내 소비기한 빈 값은 맨 뒤.
- **stockRowsByMaterial** = stockRows를 원료명으로 그룹핑한 배열 `{ 원료명, rows: StockRow[] }[]`.
- **outboundTargetQty** = 해당 출고 건의 반죽량·완제품 예상 수량 (참고용).

---

## 4. 겹치는 원료 파악 로직 유무

**없습니다.**

- **관리일지 출력**: `groupLogsByProductAndDate`로 **생산일자 + 제품명** 단위로만 그룹화합니다. 즉, 같은 날짜에 A제품·B제품을 생산하면 **A용 관리일지 섹션**과 **B용 관리일지 섹션**이 **각각 따로** 렌더링됩니다.  
  A와 B에 공통으로 들어가는 원료(예: AG-91 치즈)를 **하나로 그룹핑하거나**, 당일 전체 원료를 **원료명 기준으로 묶어서** 보여주는 함수/로직은 없습니다.

- **사용량 계산**: **한 번에 하나의 (생산일자, 제품명)** 만 선택합니다. 해당 일자·해당 제품의 출고 원료만 재고 입력 대상이 되며, “당일 여러 제품에 걸친 공통 원료”를 묶어서 다루는 기능은 없습니다.

따라서, “당일 2개 이상 제품 생산 시 공통 원료를 그룹핑/필터링”하려면 **새로 설계·구현**이 필요합니다.

---

## 5. 참고: 데이터 흐름 요약

1. **관리일지**: `date` 선택 → `productionLogs`에서 해당 날짜 필터 → 제품별 그룹 → 각 그룹마다 `getDoughLogByDate(생산일자)`, `getUsageCalculation(생산일자, 제품명)` 으로 반죽·사용량 계산 데이터 결합 → **제품별** Part1(원료 6열 표) + Part2(도우·파베이크·반죽원료) 렌더링.
2. **사용량 계산**: `productionDate` + `productName` 선택 → 해당 일자·제품의 `productionLogs`로 출고 LOT 구성 → `materialsData`(전일/당일 재고)와 합쳐서 **stockRows** 생성 → 저장 시 `UsageCalculationRecord`로 `saveUsageCalculation` 호출.

이 문서는 위 두 페이지의 현재 구현을 기준으로 정리한 것입니다. UI/UX 개편 시 동일 타입/객체명을 참고하면 일관된 프롬프트 작성에 도움이 됩니다.
