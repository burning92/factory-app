"use client";

import { useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

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
  const router = useRouter();
  const { viewOrganizationCode } = useAuth();
  const isHarang = viewOrganizationCode === "200";

  useEffect(() => {
    if (isHarang) router.replace("/harang");
  }, [isHarang, router]);

  if (isHarang) {
    return (
      <div className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center bg-slate-50 text-sm text-slate-600">
        하랑 운영 화면으로 이동 중…
      </div>
    );
  }

  const homeSeason = homeSeasonForKorea(new Date());
  const homeHero = HOME_SEASON_ASSETS[homeSeason];

  return (
    <div className={`relative -mt-14 w-full overflow-hidden bg-black ${homeHeroHeightClass()}`}>
      {/* 모션 줄이기: 영상 대신 포스터만 (데이터·배터리 부담 완화) */}
      <div className="motion-reduce:flex hidden absolute inset-0 items-center justify-center">
        <Image
          key={homeSeason}
          src={homeHero.poster}
          alt=""
          fill
          className={HOME_MEDIA_MOBILE}
          sizes="100vw"
          priority
        />
      </div>
      <video
        key={homeSeason}
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
