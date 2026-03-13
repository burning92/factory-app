"use client";

import Image from "next/image";

export default function DashboardPage() {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col items-center justify-center px-4">
      <Image
        src="/helmet-logo.png"
        alt="로고"
        width={80}
        height={80}
        className="object-contain mb-6 opacity-95"
      />
      <h1 className="text-xl sm:text-2xl font-medium text-slate-200 mb-2">
        생산관리 시스템
      </h1>
      <p className="text-slate-500 text-sm">
        우측 상단 메뉴에서 업무를 선택하세요.
      </p>
    </div>
  );
}
