"use client";

import Link from "next/link";
import { Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { displayHarangProductName } from "@/features/harang/displayProductName";
import {
  formatYmdDot,
  harangProductExpiryFromProductionDate,
} from "@/features/harang/finishedProductExpiry";

type AvailableLot = {
  production_header_id: string;
  production_no: string;
  production_date: string;
  product_name: string;
  lot_date: string;
  expiry_date: string;
  available_qty: number;
};

type Allocation = {
  production_header_id: string;
  quantity_used: number;
};

type DraftLine = {
  key: string;
  product_name: string;
  allocations: Allocation[];
  lotSummary: string;
};

type OutboundClient = {
  id: string;
  name: string;
  manager_name: string | null;
  phone: string | null;
  address: string | null;
  is_active: boolean;
  sort_order: number;
};

const HARANG_SUPPLIER_NAME = "(주)하랑커뮤니티";
const HARANG_SUPPLIER_ADDRESS = "대전광역시 유성구 북용북로33번길 16-20";

function makeLine(): DraftLine {
  return {
    key: crypto.randomUUID(),
    product_name: "",
    allocations: [],
    lotSummary: "",
  };
}

function parseQty(v: string): number {
  const n = Number(String(v).replaceAll(",", "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function formatSummary(values: string[]): string {
  if (values.length === 0) return "-";
  if (values.length === 1) return values[0];
  return values.join(" · ");
}

export default function HarangOutboundNewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editingId = searchParams.get("id") ?? "";
  const isEditMode = !!editingId;
  const [outboundDate, setOutboundDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [lots, setLots] = useState<AvailableLot[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([makeLine()]);
  const [clients, setClients] = useState<OutboundClient[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientManagerName, setClientManagerName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [supplierName, setSupplierName] = useState(HARANG_SUPPLIER_NAME);
  const [supplierAddress, setSupplierAddress] = useState(HARANG_SUPPLIER_ADDRESS);
  const [supplierManagerName, setSupplierManagerName] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [pickerLineKey, setPickerLineKey] = useState<string | null>(null);
  const [pickerInputs, setPickerInputs] = useState<Record<string, string>>({});

  const loadLots = useCallback(async () => {
    const [prodRes, usedRes] = await Promise.all([
      supabase
        .from("harang_production_headers")
        .select("id, production_no, production_date, finished_product_lot_date, product_name, finished_qty")
        .gt("finished_qty", 0),
      supabase
        .from("harang_finished_product_outbound_line_lots")
        .select("production_header_id, quantity_used, lines:line_id(header_id)"),
    ]);
    if (prodRes.error) return alert(prodRes.error.message);
    if (usedRes.error) return alert(usedRes.error.message);

    const usedByProduction = new Map<string, number>();
    for (const row of usedRes.data ?? []) {
      const lineObj = row as { lines?: { header_id?: string } | { header_id?: string }[] | null };
      const headerId = Array.isArray(lineObj.lines) ? lineObj.lines[0]?.header_id : lineObj.lines?.header_id;
      if (editingId && headerId === editingId) continue;
      const key = String(row.production_header_id);
      usedByProduction.set(key, (usedByProduction.get(key) ?? 0) + Number(row.quantity_used ?? 0));
    }

    const next: AvailableLot[] = [];
    for (const p of prodRes.data ?? []) {
      const id = String(p.id);
      const finishedQty = Number(p.finished_qty ?? 0);
      const used = usedByProduction.get(id) ?? 0;
      const available = Math.max(0, finishedQty - used);
      if (available <= 0) continue;
      const productionDate = String(p.production_date).slice(0, 10);
      const lotDate = String((p as { finished_product_lot_date?: string | null }).finished_product_lot_date ?? productionDate).slice(0, 10);
      next.push({
        production_header_id: id,
        production_no: String(p.production_no),
        production_date: productionDate,
        product_name: String(p.product_name),
        lot_date: lotDate,
        expiry_date: harangProductExpiryFromProductionDate(productionDate),
        available_qty: available,
      });
    }

    next.sort((a, b) => b.lot_date.localeCompare(a.lot_date) || a.product_name.localeCompare(b.product_name, "ko"));
    setLots(next);
  }, [editingId]);

  useEffect(() => {
    void loadLots();
  }, [loadLots]);

  const loadParties = useCallback(async () => {
    const clientRes = await supabase
      .from("harang_outbound_clients")
      .select("id, name, manager_name, phone, address, is_active, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (clientRes.error) {
      alert(clientRes.error.message);
      return;
    }

    const nextClients = (clientRes.data ?? []) as OutboundClient[];
    setClients(nextClients);

    const defaultClient =
      nextClients.find((c) => c.name === "(주)커텍트") ?? nextClients[0] ?? null;
    if (defaultClient) {
      setSelectedClientId(defaultClient.id);
      setClientName(defaultClient.name ?? "");
      setClientManagerName(defaultClient.manager_name ?? "");
      setClientPhone(defaultClient.phone ?? "");
      setClientAddress(defaultClient.address ?? "");
    }
  }, []);

  useEffect(() => {
    void loadParties();
  }, [loadParties]);

  const loadEditingRecord = useCallback(async () => {
    if (!editingId) return;
    const [hRes, lRes] = await Promise.all([
      supabase
        .from("harang_finished_product_outbound_headers")
        .select(`
          outbound_date, note,
          client_id, client_name, client_manager_name, client_phone, client_address,
          supplier_name, supplier_manager_name, supplier_phone, supplier_address
        `)
        .eq("id", editingId)
        .single(),
      supabase
        .from("harang_finished_product_outbound_lines")
        .select("id, product_name, unit, outbound_qty, sort_order")
        .eq("header_id", editingId)
        .order("sort_order", { ascending: true }),
    ]);
    if (hRes.error) {
      alert(hRes.error.message);
      return;
    }
    if (lRes.error) {
      alert(lRes.error.message);
      return;
    }

    const lineIds = (lRes.data ?? []).map((x) => String(x.id));
    const lotRes =
      lineIds.length > 0
        ? await supabase
            .from("harang_finished_product_outbound_line_lots")
            .select("line_id, production_header_id, quantity_used, production_headers:production_header_id(finished_product_lot_date, production_date)")
            .in("line_id", lineIds)
        : { data: [], error: null };
    if (lotRes.error) {
      alert(lotRes.error.message);
      return;
    }

    const h = hRes.data as {
      outbound_date: string;
      note: string | null;
      client_id: string | null;
      client_name: string | null;
      client_manager_name: string | null;
      client_phone: string | null;
      client_address: string | null;
      supplier_name: string | null;
      supplier_manager_name: string | null;
      supplier_phone: string | null;
      supplier_address: string | null;
    };

    setOutboundDate(String(h.outbound_date).slice(0, 10));
    setNote(h.note ?? "");
    setSelectedClientId(h.client_id ?? "");
    setClientName(h.client_name ?? "");
    setClientManagerName(h.client_manager_name ?? "");
    setClientPhone(h.client_phone ?? "");
    setClientAddress(h.client_address ?? "");
    setSupplierName(h.supplier_name ?? HARANG_SUPPLIER_NAME);
    setSupplierAddress(h.supplier_address ?? HARANG_SUPPLIER_ADDRESS);
    setSupplierManagerName(h.supplier_manager_name ?? "");
    setSupplierPhone(h.supplier_phone ?? "");

    const lotsByLine = new Map<string, Array<{ production_header_id: string; quantity_used: number; lot_date: string }>>();
    for (const row of (lotRes.data ?? []) as Array<{
      line_id: string;
      production_header_id: string;
      quantity_used: number;
      production_headers:
        | { finished_product_lot_date: string | null; production_date: string | null }
        | { finished_product_lot_date: string | null; production_date: string | null }[]
        | null;
    }>) {
      const head = Array.isArray(row.production_headers) ? row.production_headers[0] : row.production_headers;
      const lotDate = String(head?.finished_product_lot_date ?? head?.production_date ?? "").slice(0, 10);
      const arr = lotsByLine.get(String(row.line_id)) ?? [];
      arr.push({
        production_header_id: String(row.production_header_id),
        quantity_used: Number(row.quantity_used ?? 0),
        lot_date: lotDate,
      });
      lotsByLine.set(String(row.line_id), arr);
    }

    const nextLines: DraftLine[] = (lRes.data ?? []).map((line) => {
      const lineLots = lotsByLine.get(String(line.id)) ?? [];
      return {
        key: crypto.randomUUID(),
        product_name: String(line.product_name ?? ""),
        allocations: lineLots.map((x) => ({
          production_header_id: x.production_header_id,
          quantity_used: x.quantity_used,
        })),
        lotSummary: formatSummary(
          lineLots
            .map((x) => (x.lot_date ? formatYmdDot(x.lot_date) : ""))
            .filter(Boolean),
        ),
      };
    });
    setLines(nextLines.length > 0 ? nextLines : [makeLine()]);
  }, [editingId]);

  useEffect(() => {
    void loadEditingRecord();
  }, [loadEditingRecord]);

  const productOptions = useMemo(() => {
    const set = new Set<string>();
    for (const lot of lots) set.add(lot.product_name);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
  }, [lots]);

  const pickerLine = useMemo(() => lines.find((line) => line.key === pickerLineKey) ?? null, [lines, pickerLineKey]);
  const pickerLots = useMemo(() => {
    if (!pickerLine?.product_name) return [];
    return lots.filter((lot) => lot.product_name === pickerLine.product_name);
  }, [lots, pickerLine]);

  const lineTotalQty = (line: DraftLine) =>
    line.allocations.reduce((s, a) => s + Number(a.quantity_used || 0), 0);

  const lineTotalAvailable = (line: DraftLine) =>
    lots
      .filter((lot) => lot.product_name === line.product_name)
      .reduce((s, lot) => s + Number(lot.available_qty || 0), 0);

  const setLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const addLine = () => setLines((prev) => [...prev, makeLine()]);
  const removeLine = (key: string) => {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((line) => line.key !== key)));
  };

  const openPicker = (lineKey: string) => {
    const line = lines.find((x) => x.key === lineKey);
    if (!line || !line.product_name) return;
    const nextInputs: Record<string, string> = {};
    for (const lot of lots.filter((lot) => lot.product_name === line.product_name)) {
      const hit = line.allocations.find((a) => a.production_header_id === lot.production_header_id);
      nextInputs[lot.production_header_id] = hit ? String(hit.quantity_used) : "";
    }
    setPickerInputs(nextInputs);
    setPickerLineKey(lineKey);
  };

  const applyPicker = () => {
    if (!pickerLine) return;
    const selectedLots = lots.filter((lot) => lot.product_name === pickerLine.product_name);
    const allocations: Allocation[] = [];
    const lotDates: string[] = [];

    for (const lot of selectedLots) {
      const q = parseQty(pickerInputs[lot.production_header_id] ?? "");
      if (q <= 0) continue;
      if (q > lot.available_qty) {
        alert(`가용재고를 초과했습니다: ${lot.production_no}`);
        return;
      }
      allocations.push({
        production_header_id: lot.production_header_id,
        quantity_used: q,
      });
      lotDates.push(formatYmdDot(lot.lot_date));
    }

    setLine(pickerLine.key, {
      allocations,
      lotSummary: formatSummary(lotDates),
    });
    setPickerLineKey(null);
  };

  const pickerRows = useMemo(() => {
    return pickerLots.map((lot) => {
      const q = parseQty(pickerInputs[lot.production_header_id] ?? "");
      const remain = Math.max(0, lot.available_qty - q);
      return { lot, qty: q, remain };
    });
  }, [pickerLots, pickerInputs]);

  const pickerSum = useMemo(() => pickerRows.reduce((s, r) => s + r.qty, 0), [pickerRows]);

  const onChangeClient = (clientId: string) => {
    setSelectedClientId(clientId);
    const hit = clients.find((c) => c.id === clientId);
    if (!hit) {
      setClientName("");
      setClientManagerName("");
      setClientPhone("");
      setClientAddress("");
      return;
    }
    setClientName(hit.name ?? "");
    setClientManagerName(hit.manager_name ?? "");
    setClientPhone(hit.phone ?? "");
    setClientAddress(hit.address ?? "");
  };

  const handleSave = async () => {
    const payload = lines
      .map((line) => {
        const total = lineTotalQty(line);
        const firstProductionHeaderId =
          line.allocations.length > 0 ? line.allocations[0].production_header_id : "";
        return {
          product_name: line.product_name,
          unit: "EA",
          outbound_qty: total,
          /**
           * 구버전 DB 함수 호환용.
           * (신버전은 allocations를 사용하고 이 필드는 무시해도 무방)
           */
          production_header_id: firstProductionHeaderId,
          allocations: line.allocations,
        };
      })
      .filter((line) => line.product_name && line.outbound_qty > 0 && line.allocations.length > 0);

    if (payload.length === 0) {
      alert("최소 1개 이상의 유효한 출고 라인이 필요합니다.");
      return;
    }
    for (const line of lines) {
      if (!line.product_name) {
        alert("각 라인에서 품목을 선택하세요.");
        return;
      }
      if (line.allocations.length === 0) {
        alert("각 라인에서 LOT를 선택하고 출고수량을 입력하세요.");
        return;
      }
    }
    if (!clientName.trim()) {
      alert("거래처 정보를 확인하세요.");
      return;
    }
    if (!supplierManagerName.trim()) {
      alert("공급자 담당자를 입력하세요.");
      return;
    }
    if (!supplierPhone.trim()) {
      alert("공급자 담당자 연락처를 입력하세요.");
      return;
    }
    if (!supplierName.trim()) {
      alert("공급자 상호를 입력하세요.");
      return;
    }
    if (!supplierAddress.trim()) {
      alert("공급자 소재지를 입력하세요.");
      return;
    }

    setSaving(true);
    const rpcPayload = {
      p_outbound_date: outboundDate,
      p_note: note.trim() || null,
      p_outbound_manager_name: null,
      p_client_id: selectedClientId || null,
      p_client_name: clientName.trim(),
      p_client_manager_name: clientManagerName.trim() || null,
      p_client_phone: clientPhone.trim() || null,
      p_client_address: clientAddress.trim() || null,
      p_supplier_name: supplierName.trim(),
      p_supplier_manager_name: supplierManagerName.trim(),
      p_supplier_phone: supplierPhone.trim(),
      p_supplier_address: supplierAddress.trim(),
      p_lines: payload,
    };
    const { data, error } = isEditMode
      ? await supabase.rpc("update_harang_finished_product_outbound", {
          p_header_id: editingId,
          ...rpcPayload,
        })
      : await supabase.rpc("create_harang_finished_product_outbound", rpcPayload);
    setSaving(false);
    if (error) {
      alert(error.message);
      return;
    }
    router.replace(`/harang/outbound/${String(data)}`);
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">하랑 완제품 출고입력</h1>
            <p className="text-sm text-slate-600 mt-1">
              {isEditMode ? "기존 출고 내역을 수정합니다." : "완제품 재고 LOT 기준으로 출고수량을 입력합니다."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/harang/outbound" className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm bg-white">
              출고내역
            </Link>
            <Link
              href="/harang/outbound/clients"
              className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm bg-white"
            >
              출고처관리
            </Link>
          </div>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold text-slate-800">출고 헤더</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-slate-600">
              출고일자
              <input
                type="date"
                value={outboundDate}
                onChange={(e) => setOutboundDate(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 text-sm"
              />
            </label>
            <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">공급자</p>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="text-xs text-slate-600">
                  상호(법인명) *
                  <input
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 text-sm bg-white"
                  />
                </label>
                <label className="text-xs text-slate-600">
                  소재지 *
                  <input
                    value={supplierAddress}
                    onChange={(e) => setSupplierAddress(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 text-sm bg-white"
                  />
                </label>
                <label className="text-xs text-slate-600">
                  담당자 *
                  <input
                    value={supplierManagerName}
                    onChange={(e) => setSupplierManagerName(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 text-sm bg-white"
                    placeholder="예: 홍길동"
                  />
                </label>
                <label className="text-xs text-slate-600">
                  담당자 연락처 *
                  <input
                    value={supplierPhone}
                    onChange={(e) => setSupplierPhone(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 text-sm bg-white"
                    placeholder="예: 010-1234-5678"
                  />
                </label>
              </div>
            </div>
            <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-semibold text-slate-700">공급받는자</p>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="text-xs text-slate-600">
                  거래처
                  <select
                    value={selectedClientId}
                    onChange={(e) => onChangeClient(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 text-sm"
                  >
                    <option value="">선택</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-600">
                  거래처 담당자
                  <input
                    value={clientManagerName}
                    onChange={(e) => setClientManagerName(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 text-sm"
                    placeholder="자동 채움 후 수정 가능"
                  />
                </label>
                <label className="text-xs text-slate-600">
                  거래처 연락처
                  <input
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 text-sm"
                    placeholder="자동 채움 후 수정 가능"
                  />
                </label>
                <label className="text-xs text-slate-600 sm:col-span-2">
                  거래처 소재지
                  <input
                    value={clientAddress}
                    onChange={(e) => setClientAddress(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 text-sm"
                    placeholder="자동 채움 후 수정 가능"
                  />
                </label>
              </div>
            </div>
            <label className="text-xs text-slate-600 sm:col-span-2">
              비고
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 text-sm"
                placeholder="선택"
              />
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">출고 라인</h2>
            <button type="button" onClick={addLine} className="text-sm text-cyan-700">+ 라인 추가</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-sm text-slate-900">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-2 py-2 text-left">품목명</th>
                  <th className="px-2 py-2 text-left">생산입고 No.</th>
                  <th className="px-2 py-2 text-left">소비기한 LOT</th>
                  <th className="px-2 py-2 text-right">가용재고</th>
                  <th className="px-2 py-2 text-right">출고수량</th>
                  <th className="px-2 py-2 text-left">선택</th>
                  <th className="px-2 py-2 text-left">삭제</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const lineLots = line.allocations
                    .map((a) => lots.find((lot) => lot.production_header_id === a.production_header_id))
                    .filter((x): x is AvailableLot => !!x);
                  const productionSummary = lineLots.length === 0
                    ? "-"
                    : lineLots.length === 1
                      ? lineLots[0].production_no
                      : `${lineLots[0].production_no} 외 ${lineLots.length - 1}건`;
                  const lotSummary = line.lotSummary || "-";
                  return (
                    <tr key={line.key} className="border-b border-slate-100 text-slate-900">
                      <td className="px-2 py-2">
                        <select
                          value={line.product_name}
                          onChange={(e) =>
                            setLine(line.key, {
                              product_name: e.target.value,
                              allocations: [],
                              lotSummary: "",
                            })
                          }
                          className="w-full rounded border border-slate-300 px-2 py-1.5 text-slate-900"
                        >
                          <option value="">선택</option>
                          {productOptions.map((name) => (
                            <option key={name} value={name}>
                              [하랑]{displayHarangProductName(name)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2 max-w-[180px] break-all font-mono text-xs text-slate-900">{productionSummary}</td>
                      <td className="px-2 py-2 max-w-[180px] break-words tabular-nums text-slate-900">{lotSummary}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-900">{lineTotalAvailable(line).toLocaleString("ko-KR")}</td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold text-slate-900">{lineTotalQty(line).toLocaleString("ko-KR")}</td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          disabled={!line.product_name}
                          onClick={() => openPicker(line.key)}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 disabled:opacity-50"
                        >
                          <Search className="w-3.5 h-3.5" />
                          선택
                        </button>
                      </td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => removeLine(line.key)}
                          className="rounded border border-red-300 px-2 py-1.5 text-xs text-red-700"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div className="flex justify-end">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="px-5 py-2.5 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700 disabled:opacity-60"
          >
            {saving ? "저장 중..." : isEditMode ? "수정 저장" : "출고 저장"}
          </button>
        </div>
      </div>

      {pickerLine && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setPickerLineKey(null)} />
          <div className="relative w-full max-w-6xl max-h-[85vh] overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-xl">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                출고 LOT 선택 · [하랑]{displayHarangProductName(pickerLine.product_name)}
              </h3>
              <button type="button" className="text-sm text-slate-600" onClick={() => setPickerLineKey(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-auto max-h-[calc(85vh-7rem)]">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="px-3 py-2 text-left">생산입고 No.</th>
                    <th className="px-3 py-2 text-left">소비기한 LOT</th>
                    <th className="px-3 py-2 text-right">가용재고</th>
                    <th className="px-3 py-2 text-right">출고수량</th>
                    <th className="px-3 py-2 text-right">반영재고</th>
                  </tr>
                </thead>
                <tbody>
                  {pickerRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-slate-500">가용 재고가 없습니다.</td>
                    </tr>
                  )}
                  {pickerRows.map(({ lot, qty, remain }) => (
                    <tr key={lot.production_header_id} className="border-b border-slate-100 text-slate-900">
                      <td className="px-3 py-2 font-mono text-xs text-slate-900">{lot.production_no}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-900">{formatYmdDot(lot.lot_date)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-900">{lot.available_qty.toLocaleString("ko-KR")}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={pickerInputs[lot.production_header_id] ?? ""}
                          onChange={(e) =>
                            setPickerInputs((prev) => ({ ...prev, [lot.production_header_id]: e.target.value }))
                          }
                          className="w-28 rounded border border-slate-300 px-2 py-1.5 text-right text-slate-900"
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-900">{remain.toLocaleString("ko-KR")}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-semibold text-slate-900">
                    <td colSpan={3} className="px-3 py-2 text-right">합계(출고)</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pickerSum.toLocaleString("ko-KR")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {pickerRows.reduce((s, r) => s + r.remain, 0).toLocaleString("ko-KR")}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="border-t border-slate-200 px-4 py-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPickerLineKey(null)}
                className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm bg-white hover:bg-slate-50"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={applyPicker}
                className="px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700"
              >
                적용
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
