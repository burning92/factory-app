import MasterItemsPage from "@/features/harang/MasterItemsPage";

export default function HarangRawMaterialsPage() {
  return (
    <MasterItemsPage
      title="하랑 원재료 마스터"
      tableName="harang_raw_materials"
      description="하랑 원재료의 코드/품목명/기본단위/박스중량/낱개중량을 관리합니다."
      showWeightFields
    />
  );
}
