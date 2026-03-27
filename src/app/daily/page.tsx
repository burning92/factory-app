"use client";

import Link from "next/link";
import { ClipboardCheck, Thermometer, Droplets, UserCheck, Snowflake, ClipboardList, Warehouse, Refrigerator, PackageSearch, Lightbulb, Wrench, Wind, Cable, FileCheck } from "lucide-react";

const HUB_ITEMS = [
  { href: "/daily/hygiene", label: "영업장 환경 위생 점검일지", Icon: ClipboardCheck },
  { href: "/daily/temperature-humidity", label: "영업장 온·습도 점검일지", Icon: Thermometer },
  { href: "/daily/sanitation-facility", label: "위생시설 관리 점검일지", Icon: Droplets },
  { href: "/daily/worker-hygiene", label: "작업자 위생 점검일지", Icon: UserCheck },
  { href: "/daily/cold-storage-hygiene", label: "냉장·냉동 온도 및 위생 점검일지", Icon: Snowflake },
  { href: "/daily/process-control-bread", label: "공정관리 점검일지(빵류)", Icon: ClipboardList },
  { href: "/daily/material-storage-3f", label: "원부자재 창고 점검표(3F)", Icon: Warehouse },
  { href: "/daily/raw-thawing", label: "원료 해동 일지", Icon: Refrigerator },
  { href: "/daily/material-receiving-inspection", label: "원료 입고 검수일지", Icon: PackageSearch },
  { href: "/daily/illumination", label: "영업장 조도 점검일지", Icon: Lightbulb },
  { href: "/daily/manufacturing-equipment", label: "제조설비 점검표", Icon: Wrench },
  { href: "/daily/air-conditioning-equipment", label: "공조설비 점검표", Icon: Wind },
  { href: "/daily/hoist-inspection", label: "호이스트 점검기록", Icon: Cable },
  { label: "기타 데일리 점검", Icon: FileCheck },
] as const;

export default function DailyHubPage() {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] md:min-h-0 p-4 md:p-6 max-w-2xl mx-auto">
      <h1 className="text-lg font-semibold text-slate-100 mb-1">데일리</h1>
      <p className="text-slate-500 text-sm mb-4">일별 점검·일지</p>
      <ul className="flex flex-col gap-2">
        {HUB_ITEMS.map((item) => (
          <li key={"href" in item ? item.href : item.label}>
            {"href" in item ? (
              <Link
                href={item.href}
                className="flex items-center justify-between w-full p-4 rounded-xl border border-slate-700/60 bg-slate-800/50 hover:bg-slate-700/50 text-slate-200 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-3">
                  <item.Icon className="w-5 h-5 shrink-0 text-cyan-400/90" strokeWidth={1.8} />
                  <span className="font-medium">{item.label}</span>
                </div>
              </Link>
            ) : (
              <div
                className="flex items-center justify-between w-full p-4 rounded-xl border border-slate-700/60 bg-slate-800/30 text-slate-400 cursor-not-allowed"
                aria-disabled
              >
                <div className="flex items-center gap-3">
                  <item.Icon className="w-5 h-5 shrink-0 text-slate-500" strokeWidth={1.8} />
                  <span className="font-medium">{item.label}</span>
                </div>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-slate-700/80 text-slate-500">
                  준비 중
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
