"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Pencil, Save, SlidersHorizontal, X } from "lucide-react";
import { DEFAULT_CATALOG, buildGroupReadiness, copyProductGroup, newPositionId, setPriority, type GroupReadiness } from "@/features/production/rotation/catalog";
import { fetchRotationMaster, saveRotationMaster } from "@/features/production/rotation/clientApi";
import { buildQualificationCoverage } from "@/features/production/rotation/qualifications";
import { PRODUCT_GROUPS } from "@/features/production/rotation/seedRoster";
import { processLabel } from "@/features/production/rotation/rotationEngine";
import { patchPositionStaffing, processNeedsStaffing, withDefaultStaffing } from "@/features/production/rotation/staffing";
import type { DoughSettings, PeriodId, Person, PositionCatalog, PositionDef, ProcessId, ProductGroup, SkillMatrix } from "@/features/production/rotation/types";
import { DoughSettingsEditor, PositionEditor, ReadinessPanel, SkillMatrixEditor } from "../rotationShared";

type MasterDraft = {
  roster: Person[];
  catalog: PositionCatalog;
  skills: SkillMatrix;
  dough: DoughSettings;
};

function cloneDraft(draft: MasterDraft): MasterDraft {
  return structuredClone(draft);
}

export default function RotationSettingsClient() {
  const [roster, setRoster] = useState<Person[]>([]);
  const [catalog, setCatalog] = useState<PositionCatalog>(DEFAULT_CATALOG);
  const [skills, setSkills] = useState<SkillMatrix>({});
  const [dough, setDough] = useState<DoughSettings>({ rotationPolicy: "CURRENT_LUNCH_BACKUP" });
  const [hydrated, setHydrated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [rankError, setRankError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"positions" | "skills">("skills");
  const [skillGroup, setSkillGroup] = useState<ProductGroup>("phono_signature");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const savedRef = useRef<MasterDraft | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const master = await fetchRotationMaster();
        if (cancelled) return;
        const draft: MasterDraft = {
          roster: master.workers,
          catalog: master.catalog,
          skills: master.skills,
          dough: master.ops?.dough ?? { rotationPolicy: "CURRENT_LUNCH_BACKUP" },
        };
        savedRef.current = cloneDraft(draft);
        setRoster(draft.roster);
        setCatalog(draft.catalog);
        setSkills(draft.skills);
        setDough(draft.dough);
        setEditing(false);
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

  const qualificationCoverage = useMemo(() => buildQualificationCoverage(roster), [roster]);
  const readinessByGroup = useMemo(
    () =>
      Object.fromEntries(
        PRODUCT_GROUPS.map((pg) => [pg.id, buildGroupReadiness(catalog, pg.id, skills, roster)])
      ) as Record<ProductGroup, GroupReadiness>,
    [catalog, skills, roster]
  );

  const startEdit = () => {
    setSaveNote(null);
    setRankError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    const saved = savedRef.current;
    if (saved) {
      const restored = cloneDraft(saved);
      setRoster(restored.roster);
      setCatalog(restored.catalog);
      setSkills(restored.skills);
      setDough(restored.dough);
    }
    setRankError(null);
    setSaveNote(null);
    setEditing(false);
  };

  const saveEdit = async () => {
    setSaving(true);
    setSaveNote(null);
    try {
      await saveRotationMaster({
        workers: roster.map((w) => ({ ...w, present: true })),
        catalog,
        skills,
        ops: { dough },
      });
      const master = await fetchRotationMaster();
      const draft: MasterDraft = {
        roster: master.workers,
        catalog: master.catalog,
        skills: master.skills,
        dough: master.ops?.dough ?? dough,
      };
      savedRef.current = cloneDraft(draft);
      setRoster(draft.roster);
      setCatalog(draft.catalog);
      setSkills(draft.skills);
      setDough(draft.dough);
      setEditing(false);
      setSaveNote("저장되었습니다. 바꾸려면 수정을 누르세요.");
    } catch (err) {
      setSaveNote(err instanceof Error ? err.message : "설정 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const copyFromSignature = (to: ProductGroup) => {
    if (!editing) return;
    const label = PRODUCT_GROUPS.find((pg) => pg.id === to)?.label ?? to;
    if (
      !window.confirm(
        `포노 시그니처의 포지션과 숙련도를 「${label}」에 복사합니다. 기존 값은 덮어쓰이며, 이후 차이만 수정하면 됩니다.`
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
    if (!editing) return;
    const pos: PositionDef = withDefaultStaffing({
      id: newPositionId(process),
      label: `${processLabel(process)} ${catalog[g].filter((p) => p.process === process).length + 1}`,
      process,
    });
    setCatalog((c) => ({ ...c, [g]: [...c[g], pos] }));
    setSkills((s) => {
      let next = s;
      for (const person of roster) next = setPriority(next, person.id, g, pos.id, 0);
      return next;
    });
  };

  const changeStaffing = (g: ProductGroup, id: string, period: PeriodId, field: "min" | "max", value: number) => {
    if (!editing) return;
    setCatalog((c) => ({
      ...c,
      [g]: c[g].map((p) => {
        if (p.id !== id || !processNeedsStaffing(p.process)) return p;
        return { ...p, staffing: patchPositionStaffing(p.process, p.staffing, period, field, value) };
      }),
    }));
  };

  const renamePosition = (g: ProductGroup, id: string, label: string) => {
    if (!editing) return;
    setCatalog((c) => ({ ...c, [g]: c[g].map((p) => (p.id === id ? { ...p, label } : p)) }));
  };

  const removePosition = (g: ProductGroup, id: string) => {
    if (!editing) return;
    setCatalog((c) => ({ ...c, [g]: c[g].filter((p) => p.id !== id) }));
  };

  const locked = !editing;

  return (
    <div className="flex h-[calc(100dvh-3.5rem-4rem)] md:h-[calc(100dvh-3.5rem)] flex-col overflow-hidden p-3 md:p-4">
      <header className="mb-3 flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/production/rotation" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-cyan-300 mb-1">
            <ArrowLeft className="w-3.5 h-3.5" /> 당일 배치표
          </Link>
          <h1 className="text-xl md:text-2xl font-semibold text-slate-100 flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-cyan-400" />
            로테이션 설정
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {editing ? "수정 중입니다. 끝나면 저장하세요." : "잠겨 있습니다. 바꾸려면 수정을 누르세요."}
          </p>
          {saveNote && <p className="mt-1 text-[11px] text-slate-500">{saveNote}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={startEdit}
            disabled={!hydrated || editing || Boolean(loadError)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Pencil className="w-4 h-4" />
            수정
          </button>
          {editing && (
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-40"
            >
              <X className="w-4 h-4" />
              취소
            </button>
          )}
          <button
            type="button"
            onClick={() => void saveEdit()}
            disabled={!editing || saving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-700/60 bg-cyan-950/40 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save className="w-4 h-4" />
            {saving ? "저장 중…" : "저장"}
          </button>
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

      <ReadinessPanel readiness={readinessByGroup} qualificationCoverage={qualificationCoverage} />

      <DoughSettingsEditor
        catalog={catalog}
        skillGroup={skillGroup}
        dough={dough}
        onChange={setDough}
        locked={locked}
      />

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
            {id === "skills" ? "숙련도" : "포지션"}
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
          onStaffingChange={changeStaffing}
          onCopyFromSignature={copyFromSignature}
          locked={locked}
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
          locked={locked}
        />
      )}
    </div>
  );
}
