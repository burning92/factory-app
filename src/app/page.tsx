"use client";

import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";

const HARANG_PEOPLE_ICON_SRC = "/harang/people-icon.png";

export default function DashboardPage() {
  const { uiSettings, organization } = useAuth();
  const brandName = uiSettings?.brand_name?.trim() || "생산관리";
  const logoUrl = uiSettings?.logo_url?.trim() || "/helmet-logo.png";
  const isHarang = organization?.organization_code === "200";

  if (isHarang) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] px-4 flex items-center justify-center bg-slate-50">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-sm p-7 text-center">
          <div className="mx-auto mb-5 w-24 h-24 rounded-2xl bg-slate-100 flex items-center justify-center">
            <Image
              src={HARANG_PEOPLE_ICON_SRC}
              alt="하랑 아이콘"
              width={72}
              height={72}
              className="object-contain"
              priority
            />
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold text-slate-900 mb-2">하랑 작업 페이지</h1>
          <p className="text-slate-600 text-sm mb-1">필요한 메뉴만 순차적으로 제공됩니다.</p>
          <p className="text-slate-600 text-sm">계정 메뉴에서 비밀번호 변경/로그아웃이 가능합니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col items-center justify-center px-4">
      {logoUrl.startsWith("http") ? (
        <img src={logoUrl} alt="로고" width={80} height={80} className="object-contain mb-6 opacity-95 rounded" />
      ) : (
        <Image
          src={logoUrl}
          alt="로고"
          width={80}
          height={80}
          className="object-contain mb-6 opacity-95"
        />
      )}
      <h1 className="text-xl sm:text-2xl font-medium text-slate-200 mb-2">{brandName}</h1>
      <p className="text-slate-500 text-sm">우측 상단 메뉴에서 업무를 선택하세요.</p>
    </div>
  );
}
