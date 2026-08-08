import { useEffect, useMemo, useState } from "react";
import type { Bill, PaymentStatus, Split, SplitParticipant } from "@tabtap/shared";
import { createPayment, createSplit, getBillForTable, getSplit } from "./api";

function formatMoney(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

function getTableIdFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("table") ?? "table-1";
}

type PaymentState = Record<string, "idle" | "paying" | "paid" | "error">;

export default function App() {
  const tableId = useMemo(getTableIdFromUrl, []);
  const [bill, setBill] = useState<Bill | null>(null);
  const [split, setSplit] = useState<Split | null>(null);
  const [participantsCount, setParticipantsCount] = useState(1);
  const [paymentState, setPaymentState] = useState<PaymentState>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getBillForTable(tableId)
      .then(setBill)
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [tableId]);

  async function handleSplit() {
    if (!bill) return;
    setError(null);
    try {
      const newSplit = await createSplit(bill.id, participantsCount);
      setSplit(newSplit);
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  }

  async function handlePay(participant: SplitParticipant) {
    if (!bill || !split) return;
    setPaymentState((s) => ({ ...s, [participant.id]: "paying" }));
    try {
      const payment = await createPayment({
        billId: bill.id,
        splitId: split.id,
        participantId: participant.id,
        amountMinor: participant.amountDueMinor - participant.amountPaidMinor,
        currency: bill.currency,
      });
      const status: PaymentStatus = payment.status;
      setPaymentState((s) => ({ ...s, [participant.id]: status === "succeeded" ? "paid" : "error" }));
      const refreshed = await getSplit(split.id);
      setSplit(refreshed);
    } catch (e: any) {
      setError(String(e.message ?? e));
      setPaymentState((s) => ({ ...s, [participant.id]: "error" }));
    }
  }

  if (loading) return <main className="screen">Загружаем счёт…</main>;
  if (error) return <main className="screen">Ошибка: {error}</main>;
  if (!bill) return <main className="screen">Счёт не найден</main>;

  const allPaid = split?.participants.every((p) => p.amountPaidMinor >= p.amountDueMinor) ?? false;

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
      </section>

      {!split && (
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
          <button onClick={handleSplit}>Разделить поровну</button>
        </section>
      )}

      {split && !allPaid && (
        <section className="participants">
          <h2>Оплата по гостям</h2>
          {split.participants.map((p) => {
            const remaining = p.amountDueMinor - p.amountPaidMinor;
            const state = paymentState[p.id] ?? "idle";
            const isPaid = remaining <= 0;
            return (
              <div key={p.id} className="participant">
                <span>{p.label}</span>
                <span>{formatMoney(p.amountDueMinor, bill.currency)}</span>
                {isPaid ? (
                  <span className="paid-badge">Оплачено</span>
                ) : (
                  <button disabled={state === "paying"} onClick={() => handlePay(p)}>
                    {state === "paying" ? "Оплачиваем…" : "Оплатить"}
                  </button>
                )}
              </div>
            );
          })}
        </section>
      )}

      {split && allPaid && (
        <section className="done">
          <h2>Счёт полностью оплачен. Спасибо!</h2>
        </section>
      )}
    </main>
  );
}
