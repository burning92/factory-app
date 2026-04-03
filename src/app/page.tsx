"use client";

import Image from "next/image";
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
  const { viewOrganizationCode } = useAuth();
  const isHarang = viewOrganizationCode === "200";
  const [homeSeason, setHomeSeason] = useState<HomeSeason>("spring");

  useEffect(() => {
    setHomeSeason(homeSeasonForKorea(new Date()));
  }, []);

  const homeHero = HOME_SEASON_ASSETS[homeSeason];

  if (isHarang) {
    return (
      <div
        className="min-h-[calc(100dvh-3.5rem-4rem)] md:min-h-[calc(100dvh-3.5rem)] px-4 flex items-center justify-center bg-slate-50 pb-[max(1rem,env(safe-area-inset-bottom,0px))]"
      >
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-sm p-6 sm:p-7 text-center">
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
          <p className="text-slate-600 text-sm mb-1 leading-relaxed">필요한 메뉴만 순차적으로 제공됩니다.</p>
          <p className="text-slate-600 text-sm leading-relaxed">계정 메뉴에서 비밀번호 변경/로그아웃이 가능합니다.</p>
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
