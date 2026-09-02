"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Check, Plus } from "lucide-react";
import DateWheelPicker from "@/components/DateWheelPicker";
import { useAuth } from "@/contexts/AuthContext";
import {
  getBomMaterialNamesForAdditionalOutbound,
  getMaterialQuantityType,
  listAdditionalOutboundProducts,
  planAdditionalOutbound,
  validateAdditionalOutboundQty,
} from "@/features/production/outbound/additionalOutboundMaterials";
import {
  buildLotOptions,
  fetchInventoryLotsForMaterial,
  resolveOutboundExpiry,
  type InventoryLotOption,
} from "@/features/production/outbound/inventoryLots";
import { insertAdditionalOutboundHistory } from "@/features/production/outbound/additionalOutboundHistory";
import { useMasterStore, type OutboundLine } from "@/store/useMasterStore";

function todayLocalIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function AdditionalOutboundClient() {
  const searchParams = useSearchParams();
  const { profile, viewOrganizationCode, user } = useAuth();
  const inputterName =
    (profile?.display_name ?? "").trim() || (profile?.login_id ?? "").trim();
  const orgCode = viewOrganizationCode ?? "100";

  const {
    fetchProductionLogs,
    fetchBom,
    fetchMaterials,
    productionLogs,
    materials,
    bomList,
    productionLogsLoading,
    appendOutboundLine,
    addProductionLog,
    setLastUsedDate,
    saving,
  } = useMasterStore();

  const queryDate = (searchParams.get("date") ?? "").slice(0, 10);
  const queryProduct = (searchParams.get("product") ?? "").trim();

  const [date, setDate] = useState(queryDate || todayLocalIso());
  const [productName, setProductName] = useState(queryProduct);
  const [materialName, setMaterialName] = useState("");
  const [boxQty, setBoxQty] = useState("");
  const [bagQty, setBagQty] = useState("");
  const [gQty, setGQty] = useState("");
  const [selectedLotIso, setSelectedLotIso] = useState("");
  const [manualLotIso, setManualLotIso] = useState("");
  const [lotOptions, setLotOptions] = useState<InventoryLotOption[]>([]);
  const [inventoryHint, setInventoryHint] = useState<string | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    fetchProductionLogs();
    fetchBom();
    fetchMaterials();
  }, [fetchProductionLogs, fetchBom, fetchMaterials]);

  useEffect(() => {
    if (queryDate) setDate(queryDate);
    if (queryProduct) setProductName(queryProduct);
  }, [queryDate, queryProduct]);

  const products = useMemo(
    () => listAdditionalOutboundProducts(productionLogs, date),
    [productionLogs, date]
  );

  const selectedProduct = useMemo(
    () => products.find((p) => p.productName === productName) ?? null,
    [products, productName]
  );

  const productLogs = useMemo(
    () =>
      productionLogs.filter(
        (l) => l.생산일자.slice(0, 10) === date && l.제품명 === productName
      ),
    [productionLogs, date, productName]
  );

  const bomMaterialNamesByProduct = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const b of bomList) {
      const list = map.get(b.productName) ?? [];
      list.push(b.materialName);
      map.set(b.productName, list);
    }
    return map;
  }, [bomList]);

  const materialOptions = useMemo(() => {
    const bomNames = getBomMaterialNamesForAdditionalOutbound(productName, bomMaterialNamesByProduct);
    const names = bomNames.length > 0 ? bomNames : materials.map((m) => m.materialName);
    const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
    const already = new Set(selectedProduct?.materialNames ?? []);
    return unique.sort((a, b) => {
      const aHit = already.has(a) ? 0 : 1;
      const bHit = already.has(b) ? 0 : 1;
      if (aHit !== bHit) return aHit - bHit;
      return a.localeCompare(b, "ko-KR");
    });
  }, [productName, bomMaterialNamesByProduct, materials, selectedProduct]);

  const selectedMaterial = useMemo(
    () => materials.find((m) => m.materialName === materialName),
    [materials, materialName]
  );
  const qType = getMaterialQuantityType(selectedMaterial);
  const alreadyOutbound = Boolean(
    selectedProduct?.materialNames.includes(materialName)
  );

  useEffect(() => {
    if (!materialName.trim()) {
      setLotOptions([]);
      setInventoryHint(null);
      setSelectedLotIso("");
      return;
    }
    let cancelled = false;
    (async () => {
      setInventoryLoading(true);
      setInventoryHint(null);
      const { rows, hint } = await fetchInventoryLotsForMaterial(
        materialName,
        selectedMaterial?.inventoryItemCode
      );
      if (cancelled) return;
      const options = buildLotOptions(rows);
      setLotOptions(options);
      setInventoryHint(hint);
      setSelectedLotIso(options[0]?.iso ?? "");
      setInventoryLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [materialName, selectedMaterial?.inventoryItemCode]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const resolvedExpiry = resolveOutboundExpiry({
    manualLotIso,
    selectedLotIso,
  });

  const resetQty = () => {
    setBoxQty("");
    setBagQty("");
    setGQty("");
  };

  const handleSelectProduct = (name: string) => {
    setProductName(name);
    setMaterialName("");
    setManualLotIso("");
    resetQty();
  };

  const handleSelectMaterial = (name: string) => {
    setMaterialName(name);
    setManualLotIso("");
    resetQty();
  };

  const handleSave = useCallback(async () => {
    const cleanMaterial = materialName.trim();
    if (!productName.trim()) {
      setToast({ message: "제품을 먼저 선택해 주세요.", type: "error" });
      return;
    }
    if (!cleanMaterial) {
      setToast({ message: "원료를 선택해 주세요.", type: "error" });
      return;
    }
    const box = Math.max(0, parseInt(boxQty, 10) || 0);
    const bag = Math.max(0, parseInt(bagQty, 10) || 0);
    const g = Math.max(0, parseInt(gQty, 10) || 0);
    const qtyError = validateAdditionalOutboundQty(qType, box, bag, g);
    if (qtyError) {
      setToast({ message: qtyError, type: "error" });
      return;
    }
    const expiry = resolvedExpiry.trim();
    if (!expiry) {
      setToast({ message: "LOT(소비기한)을 확인해 주세요.", type: "error" });
      return;
    }

    const newLine: OutboundLine = { 소비기한: expiry, 박스: box, 낱개: bag, g };
    const plan = planAdditionalOutbound(productLogs, cleanMaterial);
    setPending(true);
    try {
      if (plan.action === "append") {
        await appendOutboundLine(plan.logId, newLine);
      } else {
        await addProductionLog({
          생산일자: date,
          제품명: productName,
          원료명: cleanMaterial,
          출고_라인: [newLine],
          출고_박스: 0,
          출고_낱개: 0,
          출고_g: 0,
          출고자: inputterName || undefined,
        });
      }
      await setLastUsedDate(cleanMaterial, expiry);
      await insertAdditionalOutboundHistory({
        organizationCode: orgCode,
        productionDate: date,
        productName,
        materialName: cleanMaterial,
        lotExpiry: expiry,
        boxQty: box,
        bagQty: bag,
        gQty: g,
        authorName: inputterName || undefined,
        authorUserId: user?.id,
      });
      resetQty();
      setToast({ message: `${cleanMaterial} 추가 출고가 저장되었습니다.`, type: "success" });
    } catch {
      setToast({ message: "저장에 실패했습니다. 다시 시도해 주세요.", type: "error" });
    } finally {
      setPending(false);
    }
  }, [
    addProductionLog,
    appendOutboundLine,
    bagQty,
    boxQty,
    date,
    gQty,
    inputterName,
    materialName,
    orgCode,
    productLogs,
    productName,
    qType,
    resolvedExpiry,
    setLastUsedDate,
    user?.id,
  ]);

  const busy = pending || saving === "logs";

  return (
    <div className="py-6 px-4 sm:px-6 lg:px-8 pb-28 md:pb-10">
      {toast && (
        <div
          role="alert"
          className={`app-toast ${
            toast.type === "success" ? "bg-emerald-500 text-white" : "bg-red-500 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="max-w-lg mx-auto">
        <div className="mb-5">
          <Link
            href="/materials"
            className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
          >
            <ArrowLeft className="w-4 h-4" /> 원부자재
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-100">추가 출고</h1>
          <p className="mt-1 text-sm text-slate-400 leading-relaxed">
            생산 중에 원료를 더 올렸으면, 올린 사람이 여기서 바로 입력하세요.
            저장하면 사용량에도 반영됩니다.
          </p>
          <Link
            href="/production/additional-outbound-history"
            className="mt-2 inline-block text-sm text-cyan-400 hover:text-cyan-300 underline"
          >
            추가 출고 내역 보기
          </Link>
        </div>

        <section className="mb-5 rounded-2xl border border-slate-700 bg-space-800/80 p-4">
          <label className="block text-xs font-medium text-slate-400 mb-1.5">출고 날짜</label>
          <DateWheelPicker
            value={date}
            onChange={(v) => {
              setDate(v);
              setProductName("");
              setMaterialName("");
              resetQty();
            }}
            className="w-full px-3 py-2.5 rounded-xl bg-space-900 border border-slate-600 text-slate-100"
            placeholder="날짜 선택"
          />
        </section>

        <section className="mb-5">
          <h2 className="text-sm font-semibold text-slate-200 mb-2">1. 제품 선택</h2>
          {productionLogsLoading ? (
            <p className="text-sm text-slate-500 py-6 text-center">출고 목록 불러오는 중…</p>
          ) : products.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-600 bg-space-800/50 p-5 text-center">
              <p className="text-sm text-slate-300">이 날짜에 이미 출고된 제품이 없습니다.</p>
              <p className="mt-1 text-xs text-slate-500">
                1차 출고가 끝난 제품만 추가 출고할 수 있습니다. 날짜를 확인해 주세요.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {products.map((p) => {
                const selected = p.productName === productName;
                return (
                  <li key={p.productName}>
                    <button
                      type="button"
                      onClick={() => handleSelectProduct(p.productName)}
                      className={`w-full text-left rounded-2xl border px-4 py-3.5 transition-colors ${
                        selected
                          ? "border-cyan-400/70 bg-cyan-500/15 text-slate-100"
                          : "border-slate-700 bg-space-800/80 text-slate-200 hover:border-slate-500"
                      }`}
                    >
                      <span className="block font-semibold text-base leading-snug">{p.productName}</span>
                      <span className="mt-1 block text-xs text-slate-400">
                        {p.author ? `기존 출고자 ${p.author}` : "기존 출고됨"}
                        {" · "}
                        원료 {p.materialNames.length}종
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {selectedProduct ? (
          <section className="mb-5">
            <h2 className="text-sm font-semibold text-slate-200 mb-2">2. 올린 원료</h2>
            <ul className="grid grid-cols-1 gap-2">
              {materialOptions.map((name) => {
                const selected = name === materialName;
                const existed = selectedProduct?.materialNames.includes(name);
                return (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => handleSelectMaterial(name)}
                      className={`w-full text-left rounded-2xl border px-4 py-3.5 transition-colors ${
                        selected
                          ? "border-amber-400/70 bg-amber-500/15 text-slate-100"
                          : "border-slate-700 bg-space-800/80 text-slate-200 hover:border-slate-500"
                      }`}
                    >
                      <span className="block font-medium">{name}</span>
                      {existed ? (
                        <span className="mt-0.5 block text-xs text-amber-300/90">이미 출고됨 · 수량만 더하면 됩니다</span>
                      ) : (
                        <span className="mt-0.5 block text-xs text-slate-500">이번에 처음 올리는 원료</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : productName && !productionLogsLoading ? (
          <p className="mb-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            이 날짜에 「{productName}」 출고 기록이 없습니다. 위에서 출고된 제품을 선택해 주세요.
          </p>
        ) : null}

        {selectedProduct && materialName ? (
          <section className="rounded-2xl border border-cyan-500/25 bg-space-800/90 p-4 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">3. 수량 입력</h2>
              <p className="mt-1 text-xs text-slate-400">
                {productName} · {materialName}
                {alreadyOutbound ? " (추가분)" : ""}
              </p>
            </div>

            <div className="space-y-2 rounded-xl border border-slate-700 bg-space-900/60 p-3">
              <p className="text-xs text-slate-400">LOT (소비기한)</p>
              {inventoryHint ? <p className="text-xs text-slate-500">{inventoryHint}</p> : null}
              <select
                value={selectedLotIso}
                onChange={(e) => setSelectedLotIso(e.target.value)}
                disabled={inventoryLoading}
                className="w-full px-3 py-3 rounded-xl bg-space-900 border border-slate-600 text-slate-100 text-base disabled:opacity-60"
              >
                <option value="">
                  {inventoryLoading ? "LOT 불러오는 중…" : "LOT 선택 (없으면 직접입력)"}
                </option>
                {lotOptions.map((l) => (
                  <option key={l.iso} value={l.iso}>
                    {l.lotNo} (재고 {l.qty.toLocaleString("ko-KR")})
                  </option>
                ))}
              </select>
              <DateWheelPicker
                value={manualLotIso}
                onChange={setManualLotIso}
                className="w-full px-3 py-2.5 rounded-xl bg-space-900 border border-slate-600 text-slate-100 text-sm"
                placeholder="목록에 없으면 날짜 직접 선택"
              />
              <p className="text-xs text-cyan-300">적용 LOT: {resolvedExpiry || "—"}</p>
            </div>

            <div className={`grid gap-3 ${qType === "g_only" ? "grid-cols-1" : qType === "ea_only" ? "grid-cols-2" : "grid-cols-3"}`}>
              {qType === "box_ea" ? (
                <label className="block">
                  <span className="block text-xs text-slate-400 mb-1">박스</span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={boxQty}
                    onChange={(e) => setBoxQty(e.target.value)}
                    className="w-full px-3 py-3.5 rounded-xl bg-space-900 border border-slate-600 text-slate-100 text-xl tabular-nums"
                    placeholder="0"
                  />
                </label>
              ) : null}
              {qType !== "g_only" ? (
                <label className="block">
                  <span className="block text-xs text-slate-400 mb-1">낱개</span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={bagQty}
                    onChange={(e) => setBagQty(e.target.value)}
                    className="w-full px-3 py-3.5 rounded-xl bg-space-900 border border-slate-600 text-slate-100 text-xl tabular-nums"
                    placeholder="0"
                  />
                </label>
              ) : null}
              <label className="block">
                <span className="block text-xs text-slate-400 mb-1">g</span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={gQty}
                  onChange={(e) => setGQty(e.target.value)}
                  className="w-full px-3 py-3.5 rounded-xl bg-space-900 border border-slate-600 text-slate-100 text-xl tabular-nums"
                  placeholder="0"
                />
              </label>
            </div>

            {inputterName ? (
              <p className="text-xs text-slate-500">입력자: {inputterName}</p>
            ) : null}

            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-cyan-500 text-space-900 text-base font-semibold hover:bg-cyan-400 disabled:opacity-50"
            >
              {busy ? "저장 중…" : (
                <>
                  <Check className="w-5 h-5" /> 추가 출고 저장
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setMaterialName("");
                resetQty();
              }}
              className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm text-slate-400 hover:text-slate-200"
            >
              <Plus className="w-4 h-4" /> 다른 원료 입력
            </button>
          </section>
        ) : null}
      </div>
    </div>
  );
}

export default function AdditionalOutboundPage() {
  return (
    <Suspense fallback={<p className="py-16 text-center text-slate-400 text-sm">불러오는 중…</p>}>
      <AdditionalOutboundClient />
    </Suspense>
  );
}
