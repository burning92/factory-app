"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import {
  DEFAULT_CATALOG,
  buildGroupReadiness,
  copyProductGroup,
  newPositionId,
  setPriority,
  type GroupReadiness,
} from "@/features/production/rotation/catalog";
import { fetchRotationMaster, saveRotationMaster } from "@/features/production/rotation/clientApi";
import { PRODUCT_GROUPS } from "@/features/production/rotation/seedRoster";
import { processLabel } from "@/features/production/rotation/rotationEngine";
import type { Person, PositionCatalog, PositionDef, ProcessId, ProductGroup, SkillMatrix } from "@/features/production/rotation/types";
import { PositionEditor, ReadinessPanel, SkillMatrixEditor } from "../rotationShared";

export default function RotationSettingsClient() {
  const [roster, setRoster] = useState<Person[]>([]);
  const [catalog, setCatalog] = useState<PositionCatalog>(DEFAULT_CATALOG);
  const [skills, setSkills] = useState<SkillMatrix>({});
  const [hydrated, setHydrated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [rankError, setRankError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"positions" | "skills">("skills");
  const [skillGroup, setSkillGroup] = useState<ProductGroup>("phono_signature");
  const skipSave = useRef(true);

  const snapshot = useMemo(
    () =>
      JSON.stringify({
        workers: roster.map(({ id, name, preferred, shift, group }) => ({ id, name, preferred, shift, group })),
        catalog,
        skills,
      }),
    [roster, catalog, skills]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const master = await fetchRotationMaster();
        if (cancelled) return;
        setRoster(master.workers);
        setCatalog(master.catalog);
        setSkills(master.skills);
        skipSave.current = true;
        setHydrated(true);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "마스터를 불러오지 못했습니다.");
        setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      void saveRotationMaster({
        workers: roster.map((w) => ({ ...w, present: true })),
        catalog,
        skills,
      }).then(
        () => setSaveNote("설정 저장됨"),
        (err) => setSaveNote(err instanceof Error ? err.message : "설정 저장 실패")
      );
    }, 700);
    return () => window.clearTimeout(t);
  }, [snapshot, hydrated, roster, catalog, skills]);

  const readinessByGroup = useMemo(
    () =>
      Object.fromEntries(
        PRODUCT_GROUPS.map((pg) => [pg.id, buildGroupReadiness(catalog, pg.id, skills, roster)])
      ) as Record<ProductGroup, GroupReadiness>,
    [catalog, skills, roster]
  );

  const copyFromSignature = (to: ProductGroup) => {
    const label = PRODUCT_GROUPS.find((pg) => pg.id === to)?.label ?? to;
    if (
      !window.confirm(
        `포노 시그니처의 포지션과 우선순위를 「${label}」에 복사합니다. 기존 값은 덮어쓰이며, 이후 차이만 수정하면 됩니다.`
      )
    ) {
      return;
    }
    const next = copyProductGroup(catalog, skills, roster, "phono_signature", to);
    setCatalog(next.catalog);
    setSkills(next.skills);
    setSkillGroup(to);
  };

  const addPosition = (g: ProductGroup, process: ProcessId) => {
    const pos: PositionDef = {
      id: newPositionId(process),
      label: `${processLabel(process)} ${catalog[g].filter((p) => p.process === process).length + 1}`,
      process,
    };
    setCatalog((c) => ({ ...c, [g]: [...c[g], pos] }));
    setSkills((s) => {
      let next = s;
      for (const person of roster) next = setPriority(next, person.id, g, pos.id, 0);
      return next;
    });
  };

  const renamePosition = (g: ProductGroup, id: string, label: string) => {
    setCatalog((c) => ({ ...c, [g]: c[g].map((p) => (p.id === id ? { ...p, label } : p)) }));
  };

  const removePosition = (g: ProductGroup, id: string) => {
    setCatalog((c) => ({ ...c, [g]: c[g].filter((p) => p.id !== id) }));
  };

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem-4rem)] md:min-h-[calc(100dvh-3.5rem)] flex-col p-3 md:p-4">
      <header className="mb-3 flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/production/rotation" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-cyan-300 mb-1">
            <ArrowLeft className="w-3.5 h-3.5" /> 당일 배치표
          </Link>
          <h1 className="text-xl md:text-2xl font-semibold text-slate-100 flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-cyan-400" />
            로테이션 설정
          </h1>
          {saveNote && <p className="mt-1 text-[11px] text-slate-500">{saveNote}</p>}
        </div>
      </header>

      {loadError && (
        <p className="mb-4 rounded-xl border border-rose-700/50 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
          {loadError} 로그인 후 새로고침하거나, 관리자에게 로테이션 마스터 테이블 적용을 요청하세요.
        </p>
      )}

      {rankError && (
        <p className="mb-3 rounded-lg border border-rose-700/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-100">{rankError}</p>
      )}

      <ReadinessPanel readiness={readinessByGroup} />

      <div className="mb-3 flex shrink-0 flex-wrap gap-1.5">
        {(["skills", "positions"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setPanel(id)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              panel === id ? "border-cyan-600 bg-cyan-950/40 text-cyan-100" : "border-slate-600 text-slate-300"
            }`}
          >
            {id === "skills" ? "우선순위" : "포지션"}
          </button>
        ))}
      </div>

      {panel === "positions" && (
        <PositionEditor
          catalog={catalog}
          skillGroup={skillGroup}
          setSkillGroup={setSkillGroup}
          onAdd={addPosition}
          onRename={renamePosition}
          onRemove={removePosition}
          onCopyFromSignature={copyFromSignature}
        />
      )}

      {panel === "skills" && (
        <SkillMatrixEditor
          roster={roster}
          setRoster={setRoster}
          catalog={catalog}
          skills={skills}
          setSkills={setSkills}
          skillGroup={skillGroup}
          setSkillGroup={setSkillGroup}
          onCopyFromSignature={copyFromSignature}
          onRankError={setRankError}
        />
      )}
    </div>
  );
}
