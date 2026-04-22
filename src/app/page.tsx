"use client";

import Image from "next/image";
import Link from "next/link";
import { Factory, Inbox, Layers, ListOrdered, Settings, User } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

const HARANG_PEOPLE_ICON_SRC = "/harang/people-icon.png";

type HomeSeason = "spring" | "summer" | "fall" | "winter";

/** 한국(Asia/Seoul) 달력 월 기준 기상철후: 3–5 봄, 6–8 여름, 9–11 가을, 12–2 겨울 */
function homeSeasonForKorea(now: Date): HomeSeason {
  const m = Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      month: "numeric",
    }).format(now),
  );
  if (m >= 3 && m <= 5) return "spring";
  if (m >= 6 && m <= 8) return "summer";
  if (m >= 9 && m <= 11) return "fall";
  return "winter";
}

const HOME_SEASON_ASSETS: Record<
  HomeSeason,
  { poster: string; video: string }
> = {
  spring: {
    poster: "/brand/armoredfresh-home-spring-poster.png",
    video: "/brand/armoredfresh-home-spring.mp4",
  },
  summer: {
    poster: "/brand/armoredfresh-home-summer-poster.png",
    video: "/brand/armoredfresh-home-summer.mp4",
  },
  fall: {
    poster: "/brand/armoredfresh-home-fall-poster.jpg",
    video: "/brand/armoredfresh-home-fall.mp4",
  },
  winter: {
    poster: "/brand/armoredfresh-home-winter-poster.jpg",
    video: "/brand/armoredfresh-home-winter.mp4",
  },
};

/** 헤더(h-14) + 하단 탭(md 미만 pb-16)을 제외한 뷰포트 기준 높이 */
function homeHeroHeightClass() {
  return "h-[calc(100dvh-4rem)] md:h-[calc(100dvh)]";
}

/** 모바일은 object-contain으로 원본 프레임(하단 문구 포함)을 보존 */
const HOME_MEDIA_MOBILE = "object-contain object-center";

export default function DashboardPage() {
  const { viewOrganizationCode, profile } = useAuth();
  const isHarang = viewOrganizationCode === "200";
  const isHarangAdmin = profile?.role === "admin";
  const [homeSeason, setHomeSeason] = useState<HomeSeason>("spring");

  useEffect(() => {
    setHomeSeason(homeSeasonForKorea(new Date()));
  }, []);

  const homeHero = HOME_SEASON_ASSETS[homeSeason];

  if (isHarang) {
    const quickLinks: {
      href: string;
      title: string;
      hint: string;
      Icon: typeof Inbox;
    }[] = [
      { href: "/harang/inbound", title: "입고관리", hint: "입고 등록·목록", Icon: Inbox },
      { href: "/harang/outbound", title: "출고관리", hint: "완제품 출고 등록·목록", Icon: Inbox },
      { href: "/harang/outbound/clients", title: "출고처관리", hint: "출고처 등록·수정", Icon: Inbox },
      { href: "/harang/inventory", title: "원부자재 재고현황", hint: "LOT별 재고 조회", Icon: Layers },
      {
        href: "/harang/inventory/finished-products",
        title: "완제품 재고현황",
        hint: "완제품 LOT 기준 재고 조회",
        Icon: Layers,
      },
      {
        href: "/harang/production-requests",
        title: "생산요청",
        hint: "요청 조회·생산 반영",
        Icon: ListOrdered,
      },
      { href: "/harang/production-input", title: "생산입력", hint: "생산·소모 등록", Icon: Factory },
      { href: "/account", title: "계정", hint: "비밀번호·로그아웃", Icon: User },
    ];
    if (isHarangAdmin) {
      quickLinks.push({
        href: "/harang/admin",
        title: "마스터관리",
        hint: "원료·BOM 등",
        Icon: Settings,
      });
    }

    return (
      <div className="min-h-[calc(100dvh-3.5rem-4rem)] md:min-h-[calc(100dvh-3.5rem)] bg-gradient-to-b from-slate-50 via-slate-50 to-slate-100/90 pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
        <div className="mx-auto max-w-5xl px-4 py-10 md:py-14 lg:py-16">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto mb-6 flex h-28 w-28 items-center justify-center rounded-3xl bg-white shadow-sm ring-1 ring-slate-200/80 md:h-32 md:w-32">
              <Image
                src={HARANG_PEOPLE_ICON_SRC}
                alt=""
                width={88}
                height={88}
                className="object-contain"
                priority
              />
            </div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-cyan-700/80">Harang</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">하랑 작업 홈</h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 md:text-base">
              상단 메뉴와 아래 바로가기에서 주요 업무로 이동할 수 있습니다.
            </p>
          </div>

          <ul className="mt-10 grid list-none gap-4 sm:grid-cols-2 lg:mt-12 xl:grid-cols-3">
            {quickLinks.map(({ href, title, hint, Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="group flex h-full flex-col rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm transition hover:border-cyan-500/35 hover:shadow-md hover:shadow-cyan-900/[0.06]"
                >
                  <span className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700 transition group-hover:bg-cyan-100/90">
                    <Icon className="h-5 w-5" strokeWidth={1.9} aria-hidden />
                  </span>
                  <span className="text-base font-semibold text-slate-900">{title}</span>
                  <span className="mt-1 text-sm text-slate-500">{hint}</span>
                </Link>
              </li>
            ))}
          </ul>

          <p className="mt-10 text-center text-xs text-slate-500 md:mt-12">
            계정에서는 비밀번호 변경과 로그아웃만 제공됩니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative -mt-14 w-full overflow-hidden bg-black ${homeHeroHeightClass()}`}>
      {/* 모션 줄이기: 영상 대신 포스터만 (데이터·배터리 부담 완화) */}
      <div className="motion-reduce:flex hidden absolute inset-0 items-center justify-center">
        <Image
          src={homeHero.poster}
          alt=""
          fill
          className={HOME_MEDIA_MOBILE}
          sizes="100vw"
          priority
        />
      </div>
      <video
        className={`motion-reduce:hidden absolute inset-0 h-full w-full ${HOME_MEDIA_MOBILE}`}
        poster={homeHero.poster}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-label="아머드프레시 홈 비주얼"
      >
        <source src={homeHero.video} type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-black/30" aria-hidden />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/70 to-transparent"
        aria-hidden
      />
    </div>
  );
}
