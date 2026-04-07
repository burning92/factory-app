"use client";

import Link from "next/link";
import {
  ClipboardCheck,
  Thermometer,
  Droplets,
  UserCheck,
  Snowflake,
  ClipboardList,
  Warehouse,
  Lightbulb,
  Wrench,
  Wind,
  Cable,
  History,
} from "lucide-react";

type HubEntry = { href: string; label: string; Icon: typeof ClipboardCheck };

const SECTIONS: { title: string; items: HubEntry[] }[] = [
  {
    title: "위생 및 공정",
    items: [
      { href: "/daily/sanitation-facility", label: "위생시설 관리 점검일지", Icon: Droplets },
      { href: "/daily/worker-hygiene", label: "작업자 위생 점검일지", Icon: UserCheck },
      { href: "/daily/hygiene", label: "영업장 환경 위생 점검일지", Icon: ClipboardCheck },
      { href: "/daily/temperature-humidity", label: "영업장 온·습도 점검일지", Icon: Thermometer },
      { href: "/daily/cold-storage-hygiene", label: "냉장·냉동 온도 및 위생 점검일지", Icon: Snowflake },
      { href: "/daily/process-control-bread", label: "공정관리 점검일지(빵류)", Icon: ClipboardList },
      { href: "/daily/illumination", label: "영업장 조도 점검일지", Icon: Lightbulb },
      { href: "/daily/material-storage-3f", label: "원부자재 창고 점검표(3F)", Icon: Warehouse },
    ],
  },
  {
    title: "제조 설비",
    items: [
      { href: "/daily/manufacturing-equipment", label: "제조설비 점검일지", Icon: Wrench },
      { href: "/daily/equipment-history", label: "설비이력기록부", Icon: History },
      { href: "/daily/air-conditioning-equipment", label: "공조설비 점검일지", Icon: Wind },
      { href: "/daily/hoist-inspection", label: "호이스트 점검기록", Icon: Cable },
    ],
  },
];

export default function DailyHubPage() {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] md:min-h-0 p-4 md:p-6 max-w-2xl mx-auto">
      <h1 className="text-lg font-semibold text-slate-100 mb-1">데일리</h1>
      <p className="text-slate-500 text-sm mb-4">일별 점검·일지</p>
      <div className="flex flex-col gap-6">
        {SECTIONS.map((section, si) => (
          <section key={section.title} aria-labelledby={`daily-hub-section-${si}`}>
            <h2
              id={`daily-hub-section-${si}`}
              className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2 px-1"
            >
              {section.title}
            </h2>
            <ul className="flex flex-col gap-2">
              {section.items.map(({ href, label, Icon }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="flex items-center justify-between w-full p-4 rounded-xl border border-slate-700/60 bg-slate-800/50 hover:bg-slate-700/50 text-slate-200 hover:text-white transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="w-5 h-5 shrink-0 text-cyan-400/90" strokeWidth={1.8} />
                      <span className="font-medium">{label}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
