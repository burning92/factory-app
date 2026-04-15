import MasterItemsPage from "@/features/harang/MasterItemsPage";

export default function HarangPackagingMaterialsPage() {
  return (
    <MasterItemsPage
      title="하랑 부자재 마스터"
      tableName="harang_packaging_materials"
      description="하랑 부자재의 코드/품목명/기본단위를 관리합니다."
    />
  );
}
