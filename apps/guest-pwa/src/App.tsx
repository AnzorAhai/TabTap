import { useEffect, useMemo, useState } from "react";
import type { Bill, PaymentStatus, ReceiptView, Split, SplitParticipant } from "@tabtap/shared";
import { createPayment, createSplit, getBillForTable, getItemsSplit, getReceipt, getSplit, payForItems } from "./api";

const TIP_OPTIONS = [0, 5, 10, 15];

function formatMoney(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function getTableIdFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("table") ?? "table-1";
}

function ReceiptCard({ receipt }: { receipt: ReceiptView }) {
  return (
    <div className="receipt">
      Чек · {receipt.tenantName}, {receipt.venueName} ·{" "}
      {formatMoney(receipt.amountMinor + receipt.tipMinor, receipt.currency)} · {formatTime(receipt.paidAt)}
    </div>
  );
}

function TipPicker({
  baseAmountMinor,
  currency,
  percent,
  onChange,
}: {
  baseAmountMinor: number;
  currency: string;
  percent: number;
  onChange: (percent: number) => void;
}) {
  return (
    <div className="tip-picker">
      <span className="tip-label">Чаевые:</span>
      {TIP_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          className={option === percent ? "tip-option tip-option-active" : "tip-option"}
          onClick={() => onChange(option)}
        >
          {option === 0 ? "нет" : `${option}%`}
        </button>
      ))}
      {percent > 0 && (
        <span className="tip-amount">+{formatMoney(Math.round((baseAmountMinor * percent) / 100), currency)}</span>
      )}
    </div>
  );
}

type PaymentState = Record<string, "idle" | "paying" | "paid" | "error">;

export default function App() {
  const tableId = useMemo(() => getTableIdFromUrl(), []);
  const [bill, setBill] = useState<Bill | null>(null);
  const [mode, setMode] = useState<"items" | "equal">("items");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Equal-split mode
  const [split, setSplit] = useState<Split | null>(null);
  const [participantsCount, setParticipantsCount] = useState(1);
  const [paymentState, setPaymentState] = useState<PaymentState>({});
  const [tipPercentByParticipant, setTipPercentByParticipant] = useState<Record<string, number>>({});
  const [receipts, setReceipts] = useState<Record<string, ReceiptView>>({});

  // By-items mode
  const [itemsSplit, setItemsSplit] = useState<Split | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [itemsTipPercent, setItemsTipPercent] = useState(0);
  const [payingItems, setPayingItems] = useState(false);
  const [itemsReceipts, setItemsReceipts] = useState<ReceiptView[]>([]);

  useEffect(() => {
    getBillForTable(tableId)
      .then((b) => {
        setBill(b);
        return getItemsSplit(b.id);
      })
      .then((s) => setItemsSplit(s.participants.length > 0 ? s : null))
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [tableId]);

  async function refreshBillAndItemsSplit(billId: string) {
    const [b, s] = await Promise.all([getBillForTable(tableId), getItemsSplit(billId)]);
    setBill(b);
    setItemsSplit(s.participants.length > 0 ? s : null);
  }

  async function handleCreateEqualSplit() {
    if (!bill) return;
    setError(null);
    try {
      const newSplit = await createSplit(bill.id, participantsCount);
      setSplit(newSplit);
    } catch (e: unknown) {
      setError(errorMessage(e));
    }
  }

  async function handlePayEqual(participant: SplitParticipant) {
    if (!bill || !split) return;
    setPaymentState((s) => ({ ...s, [participant.id]: "paying" }));
    try {
      const dueMinor = participant.amountDueMinor - participant.amountPaidMinor;
      const tipPercent = tipPercentByParticipant[participant.id] ?? 0;
      const tipMinor = Math.round((dueMinor * tipPercent) / 100);
      const payment = await createPayment({
        billId: bill.id,
        splitId: split.id,
        participantId: participant.id,
        amountMinor: dueMinor,
        currency: bill.currency,
        tipMinor,
      });
      const status: PaymentStatus = payment.status;
      setPaymentState((s) => ({ ...s, [participant.id]: status === "succeeded" ? "paid" : "error" }));

      if (status === "succeeded") {
        const receipt = await getReceipt(payment.id);
        setReceipts((r) => ({ ...r, [participant.id]: receipt }));
      }

      const refreshedSplit = await getSplit(split.id);
      setSplit(refreshedSplit);
      await refreshBillAndItemsSplit(bill.id);
    } catch (e: unknown) {
      setError(errorMessage(e));
      setPaymentState((s) => ({ ...s, [participant.id]: "error" }));
    }
  }

  function toggleItem(itemId: string) {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  async function handlePayItems() {
    if (!bill || selectedItemIds.size === 0) return;
    setError(null);
    setPayingItems(true);
    try {
      const itemIds = [...selectedItemIds];
      const { split: updatedSplit, participantId } = await payForItems(bill.id, itemIds);
      const participant = updatedSplit.participants.find((p) => p.id === participantId);
      if (!participant) throw new Error("Participant not found after items split");

      const tipMinor = Math.round((participant.amountDueMinor * itemsTipPercent) / 100);
      const payment = await createPayment({
        billId: bill.id,
        splitId: updatedSplit.id,
        participantId,
        amountMinor: participant.amountDueMinor,
        currency: bill.currency,
        tipMinor,
      });

      if (payment.status === "succeeded") {
        const receipt = await getReceipt(payment.id);
        setItemsReceipts((r) => [...r, receipt]);
      }

      setSelectedItemIds(new Set());
      setItemsTipPercent(0);
      await refreshBillAndItemsSplit(bill.id);
    } catch (e: unknown) {
      setError(errorMessage(e));
      // someone may have claimed an item in the meantime — resync the claimed list
      if (bill) await refreshBillAndItemsSplit(bill.id).catch(() => {});
    } finally {
      setPayingItems(false);
    }
  }

  if (loading) return <main className="screen">Загружаем счёт…</main>;
  if (error && !bill) return <main className="screen">Ошибка: {error}</main>;
  if (!bill) return <main className="screen">Счёт не найден</main>;

  // Mirrors the backend conflict check: an item becomes unavailable as soon as
  // someone starts paying for it, not only once that payment succeeds.
  const claimedItemIds = new Set((itemsSplit?.participants ?? []).flatMap((p) => p.itemIds ?? []));
  const paidItemIds = new Set(
    (itemsSplit?.participants ?? [])
      .filter((p) => p.amountPaidMinor >= p.amountDueMinor)
      .flatMap((p) => p.itemIds ?? []),
  );
  const selectedTotalMinor = bill.items
    .filter((item) => selectedItemIds.has(item.id))
    .reduce((sum, item) => sum + item.unitPriceMinor * item.quantity + item.taxMinor - item.discountMinor, 0);

  const equalAllPaid = split?.participants.every((p) => p.amountPaidMinor >= p.amountDueMinor) ?? false;
  const billFullyPaid = bill.paidMinor >= bill.totalMinor;

  return (
    <main className="screen">
      <h1>Стол {tableId}</h1>

      <section className="bill">
        <h2>Ваш счёт</h2>
        <ul>
          {bill.items.map((item) => (
            <li key={item.id}>
              <span>
                {item.name} × {item.quantity}
              </span>
              <span>{formatMoney(item.unitPriceMinor * item.quantity, bill.currency)}</span>
            </li>
          ))}
        </ul>
        <div className="total">
          <strong>Итого</strong>
          <strong>{formatMoney(bill.totalMinor, bill.currency)}</strong>
        </div>
        <div className="progress">
          Оплачено {formatMoney(bill.paidMinor, bill.currency)} из {formatMoney(bill.totalMinor, bill.currency)}
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}

      {!billFullyPaid && (
        <div className="mode-tabs">
          <button className={mode === "items" ? "tab tab-active" : "tab"} onClick={() => setMode("items")}>
            Оплатить свои блюда
          </button>
          <button className={mode === "equal" ? "tab tab-active" : "tab"} onClick={() => setMode("equal")}>
            Разделить поровну
          </button>
        </div>
      )}

      {!billFullyPaid && mode === "items" && (
        <section className="items-pay">
          <h2>Выберите, что оплачиваете</h2>
          {bill.items.map((item) => {
            const claimed = claimedItemIds.has(item.id);
            return (
              <label key={item.id} className={claimed ? "item-row item-row-claimed" : "item-row"}>
                <input
                  type="checkbox"
                  disabled={claimed || payingItems}
                  checked={selectedItemIds.has(item.id)}
                  onChange={() => toggleItem(item.id)}
                />
                <span className="item-name">
                  {item.name} × {item.quantity}
                </span>
                <span>{formatMoney(item.unitPriceMinor * item.quantity, bill.currency)}</span>
                {claimed && (
                  <span className="paid-badge">{paidItemIds.has(item.id) ? "Оплачено" : "Оплачивается"}</span>
                )}
              </label>
            );
          })}

          {selectedItemIds.size > 0 && (
            <>
              <TipPicker
                baseAmountMinor={selectedTotalMinor}
                currency={bill.currency}
                percent={itemsTipPercent}
                onChange={setItemsTipPercent}
              />
              <div className="pay-bar">
                <span>
                  К оплате:{" "}
                  {formatMoney(
                    selectedTotalMinor + Math.round((selectedTotalMinor * itemsTipPercent) / 100),
                    bill.currency,
                  )}
                </span>
                <button disabled={payingItems} onClick={() => void handlePayItems()}>
                  {payingItems ? "Оплачиваем…" : "Оплатить выбранное"}
                </button>
              </div>
            </>
          )}

          {itemsReceipts.map((receipt) => (
            <ReceiptCard key={receipt.receiptId} receipt={receipt} />
          ))}
        </section>
      )}

      {!billFullyPaid && mode === "equal" && !split && (
        <section className="split-setup">
          <h2>Разделить счёт</h2>
          <label>
            Сколько гостей платит?
            <input
              type="number"
              min={1}
              value={participantsCount}
              onChange={(e) => setParticipantsCount(Math.max(1, Number(e.target.value)))}
            />
          </label>
          <button onClick={() => void handleCreateEqualSplit()}>Разделить поровну</button>
        </section>
      )}

      {!billFullyPaid && mode === "equal" && split && !equalAllPaid && (
        <section className="participants">
          <h2>Оплата по гостям</h2>
          {split.participants.map((p) => {
            const remaining = p.amountDueMinor - p.amountPaidMinor;
            const state = paymentState[p.id] ?? "idle";
            const isPaid = remaining <= 0;
            const receipt = receipts[p.id];
            return (
              <div key={p.id} className="participant-block">
                <div className="participant">
                  <span>{p.label}</span>
                  <span>{formatMoney(p.amountDueMinor, bill.currency)}</span>
                  {isPaid && <span className="paid-badge">Оплачено</span>}
                </div>
                {!isPaid && (
                  <>
                    <TipPicker
                      baseAmountMinor={remaining}
                      currency={bill.currency}
                      percent={tipPercentByParticipant[p.id] ?? 0}
                      onChange={(percent) => setTipPercentByParticipant((t) => ({ ...t, [p.id]: percent }))}
                    />
                    <button disabled={state === "paying"} onClick={() => void handlePayEqual(p)}>
                      {state === "paying" ? "Оплачиваем…" : "Оплатить"}
                    </button>
                  </>
                )}
                {receipt && <ReceiptCard receipt={receipt} />}
              </div>
            );
          })}
        </section>
      )}

      {billFullyPaid && (
        <section className="done">
          <h2>Счёт полностью оплачен. Спасибо!</h2>
          {Object.values(receipts).map((receipt) => (
            <ReceiptCard key={receipt.receiptId} receipt={receipt} />
          ))}
          {itemsReceipts.map((receipt) => (
            <ReceiptCard key={receipt.receiptId} receipt={receipt} />
          ))}
        </section>
      )}
    </main>
  );
}
