import {
  convertMinor,
  formatMoney,
  percentOf,
  type ClaimState,
  type PaymentMode,
  type PaymentView,
  type ReceiptView,
  type TableBillView,
} from "@tabtap/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "./api";
import { loadReceipts, saveReceipt } from "./receipts";
import { useTableBill } from "./useTableBill";

// Functional guest flow on top of the Phase 1 API. Visual design and translations
// (es / en / ru) come in Phase 4.

const LOCALE = "ru-RU";
/** The demo gateway's "bank confirmed / declined" buttons (dev builds, or when enabled for a demo). */
const DEMO_PAYMENT_CONTROLS = import.meta.env.DEV || import.meta.env.VITE_DEMO_PAYMENT_CONTROLS === "true";

const MODE_LABEL: Record<PaymentMode, string> = { full: "Весь счёт", items: "Мои блюда", shares: "Поровну" };
const CLAIM_LABEL: Record<ClaimState, string> = { available: "", reserved: "Оплачивается", paid: "Оплачено" };
const PAYMENT_ENDED: Partial<Record<PaymentView["status"], string>> = {
  failed: "Оплата не прошла. Можно попробовать ещё раз.",
  canceled: "Оплата отменена.",
  expired: "Время на оплату истекло. Можно начать заново.",
};

const money = (minor: number, currency: string) => formatMoney(minor, currency, LOCALE);
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Random key for one "Pay" tap; crypto.randomUUID needs HTTPS, getRandomValues doesn't. */
function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function App() {
  const qrToken = useMemo(() => new URLSearchParams(window.location.search).get("table"), []);
  if (!qrToken) {
    return (
      <main className="screen">
        <h1>TabTap</h1>
        <p>Отсканируйте QR-код на столе, чтобы открыть счёт.</p>
      </main>
    );
  }
  return <TableScreen qrToken={qrToken} />;
}

function TableScreen({ qrToken }: { qrToken: string }) {
  const { view, setView, error: loadError, loading, refresh } = useTableBill(qrToken);

  const [mode, setMode] = useState<PaymentMode>("full");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [shareCount, setShareCount] = useState(1);
  const [tipPercent, setTipPercent] = useState(0);
  const [currency, setCurrency] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentView | null>(null);
  const [retryKey, setRetryKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptsVersion, setReceiptsVersion] = useState(0);

  const billId = view?.bill.id;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- receiptsVersion re-reads storage after a save
  const receipts = useMemo(() => (billId ? loadReceipts(billId) : []), [billId, receiptsVersion]);

  const onPaymentUpdate = useCallback(
    async (p: PaymentView) => {
      setPayment(p);
      if (p.status === "succeeded" && billId) {
        try {
          saveReceipt(billId, await api.receipt(p.id));
          setReceiptsVersion((v) => v + 1);
        } catch (e) {
          setError(messageOf(e));
        }
      }
      if (p.status !== "pending") void refresh();
    },
    [billId, refresh],
  );

  // Fallback for when the push update is missed: poll the payment while it is pending.
  const pendingPaymentId = payment?.status === "pending" ? payment.id : null;
  useEffect(() => {
    if (!pendingPaymentId) return;
    const timer = window.setInterval(() => {
      api
        .payment(pendingPaymentId)
        .then((p) => (p.status !== "pending" ? onPaymentUpdate(p) : undefined))
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [pendingPaymentId, onPaymentUpdate]);

  if (loading) return <main className="screen">Загружаем счёт…</main>;
  if (!view) return <main className="screen">Ошибка: {loadError}</main>;

  const { bill } = view;
  const payCurrency = currency ?? bill.currency;
  const currencyOption = view.paymentCurrencies.find((c) => c.currency === payCurrency) ?? view.paymentCurrencies[0];
  const availableShares = view.equalSplit?.shares.filter((s) => s.state === "available") ?? [];

  const amountMinor =
    mode === "full"
      ? bill.remainingMinor
      : mode === "items"
        ? bill.items
            .filter((i) => selectedItems.has(i.id) && i.state === "available")
            .reduce((sum, i) => sum + i.lineTotalMinor, 0)
        : Math.min(
            availableShares.slice(0, shareCount).reduce((sum, s) => sum + s.amountMinor, 0),
            bill.remainingMinor,
          );
  const tipMinor = percentOf(amountMinor, tipPercent);
  const chargeMinor = currencyOption.rate
    ? convertMinor(amountMinor + tipMinor, bill.currency, currencyOption.currency, currencyOption.rate)
    : amountMinor + tipMinor;
  const paymentInProgress = payment?.status === "pending";
  const canPay = view.modes[mode] && amountMinor > 0 && !busy && !paymentInProgress;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(messageOf(e));
      void refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handlePay() {
    const key = retryKey ?? newIdempotencyKey();
    setRetryKey(key);
    setBusy(true);
    setError(null);
    try {
      const created = await api.createPayment(
        bill.id,
        {
          mode,
          itemIds: mode === "items" ? [...selectedItems] : undefined,
          shareCount: mode === "shares" ? shareCount : undefined,
          tipPercent,
          currency: payCurrency,
        },
        key,
      );
      setRetryKey(null);
      setSelectedItems(new Set());
      setShareCount(1);
      await onPaymentUpdate(created);
    } catch (e) {
      // Network failure: the payment may exist already, so a retry must reuse the key.
      if (!(e instanceof ApiError && e.status === 0)) setRetryKey(null);
      setError(messageOf(e));
      void refresh();
    } finally {
      setBusy(false);
    }
  }

  function toggleItem(id: string) {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <main className="screen">
      <h1>
        {bill.venueName} · {bill.tableLabel}
      </h1>

      <section className="bill">
        <h2>Ваш счёт</h2>
        <ul>
          {bill.items.map((item) => (
            <li key={item.id}>
              <span>
                {item.name} × {item.quantity}
                {item.state !== "available" && <span className="badge">{CLAIM_LABEL[item.state]}</span>}
              </span>
              <span>{money(item.lineTotalMinor, bill.currency)}</span>
            </li>
          ))}
        </ul>
        <div className="breakdown">
          <Row label="Подытог" value={money(bill.subtotalMinor, bill.currency)} />
          <Row label="IVA" value={money(bill.taxMinor, bill.currency)} />
          {bill.serviceChargeMinor > 0 && <Row label="Сервис" value={money(bill.serviceChargeMinor, bill.currency)} />}
        </div>
        <div className="total">
          <strong>Итого</strong>
          <strong>{money(bill.totalMinor, bill.currency)}</strong>
        </div>
        <div className="progress">
          Оплачено {money(bill.paidMinor, bill.currency)}
          {bill.reservedMinor > 0 && <> · оплачивается {money(bill.reservedMinor, bill.currency)}</>} · осталось{" "}
          {money(bill.remainingMinor, bill.currency)}
        </div>
      </section>

      {(error ?? loadError) && <div className="error-banner">{error ?? loadError}</div>}

      {payment && payment.status === "pending" && (
        <section className="pending">
          <h2>Ждём подтверждения оплаты…</h2>
          <p className="muted">
            {money(payment.chargeAmountMinor, payment.chargeCurrency)} · резерв до{" "}
            {payment.expiresAt && new Date(payment.expiresAt).toLocaleTimeString(LOCALE, { timeStyle: "short" })}
          </p>
          <div className="actions">
            {DEMO_PAYMENT_CONTROLS && (
              <>
                <button
                  disabled={busy}
                  onClick={() => void run(async () => onPaymentUpdate(await api.mockConfirm(payment.id, "succeeded")))}
                >
                  Банк подтвердил (демо)
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void run(async () => onPaymentUpdate(await api.mockConfirm(payment.id, "failed")))}
                >
                  Банк отклонил (демо)
                </button>
              </>
            )}
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void run(async () => onPaymentUpdate(await api.cancelPayment(payment.id)))}
            >
              Отменить
            </button>
          </div>
        </section>
      )}

      {payment && PAYMENT_ENDED[payment.status] && <div className="notice">{PAYMENT_ENDED[payment.status]}</div>}

      {bill.status === "paid" ? (
        <section className="done">
          <h2>Счёт полностью оплачен. Спасибо!</h2>
        </section>
      ) : (
        !paymentInProgress && (
          <>
            <div className="mode-tabs">
              {(Object.keys(MODE_LABEL) as PaymentMode[]).map((m) => (
                <button key={m} className={mode === m ? "tab tab-active" : "tab"} onClick={() => setMode(m)}>
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>

            {mode === "full" && (
              <section>
                <h2>Оплатить весь остаток</h2>
                {view.modes.full ? (
                  <p className="muted">Оплачивается всё, что ещё не оплачено и не оплачивается другими.</p>
                ) : (
                  <p className="muted">Сейчас нечего оплачивать: остаток оплачивают другие гости.</p>
                )}
              </section>
            )}

            {mode === "items" && (
              <section className="items-pay">
                <h2>Выберите свои блюда</h2>
                {view.equalSplit?.frozen && <p className="muted">Счёт уже делят поровну — оплатите долю.</p>}
                {bill.items.map((item) => (
                  <label
                    key={item.id}
                    className={item.state === "available" ? "item-row" : "item-row item-row-claimed"}
                  >
                    <input
                      type="checkbox"
                      disabled={item.state !== "available" || !view.modes.items || busy}
                      checked={selectedItems.has(item.id) && item.state === "available"}
                      onChange={() => toggleItem(item.id)}
                    />
                    <span className="item-name">
                      {item.name} × {item.quantity}
                    </span>
                    <span>{money(item.lineTotalMinor, bill.currency)}</span>
                    {item.state !== "available" && <span className="badge">{CLAIM_LABEL[item.state]}</span>}
                  </label>
                ))}
              </section>
            )}

            {mode === "shares" && (
              <EqualSplitSection
                view={view}
                busy={busy}
                shareCount={shareCount}
                onShareCount={setShareCount}
                onSplit={(n) => void run(async () => setView(await api.setEqualSplit(bill.id, n)))}
                onRemove={() => void run(async () => setView(await api.removeEqualSplit(bill.id)))}
              />
            )}

            <section className="pay-panel">
              <div className="tip-picker">
                <span className="tip-label">Чаевые:</span>
                {view.tipPercentOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={option === tipPercent ? "tip-option tip-option-active" : "tip-option"}
                    onClick={() => setTipPercent(option)}
                  >
                    {option === 0 ? "нет" : `${option}%`}
                  </button>
                ))}
              </div>

              {view.paymentCurrencies.length > 1 && (
                <div className="tip-picker">
                  <span className="tip-label">Валюта:</span>
                  {view.paymentCurrencies.map((c) => (
                    <button
                      key={c.currency}
                      type="button"
                      className={c.currency === payCurrency ? "tip-option tip-option-active" : "tip-option"}
                      onClick={() => setCurrency(c.currency)}
                    >
                      {c.currency}
                    </button>
                  ))}
                  {currencyOption.rate && (
                    <span className="tip-amount">
                      1 {bill.currency} = {currencyOption.rate} {currencyOption.currency}
                    </span>
                  )}
                </div>
              )}

              <div className="pay-bar">
                <span>
                  К оплате: <strong>{money(chargeMinor, payCurrency)}</strong>
                  {tipMinor > 0 && <span className="muted"> (чаевые {money(tipMinor, bill.currency)})</span>}
                </span>
                <button disabled={!canPay} onClick={() => void handlePay()}>
                  {busy ? "Оплачиваем…" : "Оплатить"}
                </button>
              </div>
              <p className="muted small">После нажатия выбранное резервируется за вами на {view.holdMinutes} мин.</p>
            </section>
          </>
        )
      )}

      {receipts.length > 0 && (
        <section>
          <h2>Ваши чеки</h2>
          {receipts.map((r) => (
            <ReceiptCard key={r.receiptId} receipt={r} />
          ))}
        </section>
      )}
    </main>
  );
}

function EqualSplitSection(props: {
  view: TableBillView;
  busy: boolean;
  shareCount: number;
  onShareCount: (n: number) => void;
  onSplit: (shareCount: number) => void;
  onRemove: () => void;
}) {
  const { view, busy, shareCount, onShareCount, onSplit, onRemove } = props;
  const split = view.equalSplit;
  const [parts, setParts] = useState(split?.shareCount ?? 2);
  const currency = view.bill.currency;

  if (!split || !split.frozen) {
    const setup = (
      <div className="split-setup">
        <label>
          На сколько частей делим?
          <input
            type="number"
            min={2}
            max={30}
            value={parts}
            onChange={(e) => setParts(Math.min(30, Math.max(2, Number(e.target.value) || 2)))}
          />
        </label>
        <button disabled={busy} onClick={() => onSplit(parts)}>
          {split ? "Изменить" : "Разделить"}
        </button>
        {split && (
          <button className="secondary" disabled={busy} onClick={onRemove}>
            Не делить
          </button>
        )}
      </div>
    );
    if (!split) {
      return (
        <section>
          <h2>Разделить поровну</h2>
          <p className="muted">Деление общее для всего стола: каждый гость увидит доли и оплатит свои.</p>
          {setup}
        </section>
      );
    }
    return (
      <section>
        <h2>Счёт делится на {split.shareCount}</h2>
        {setup}
        <SharesList view={view} shareCount={shareCount} onShareCount={onShareCount} currency={currency} />
      </section>
    );
  }

  return (
    <section>
      <h2>Счёт делится на {split.shareCount}</h2>
      <SharesList view={view} shareCount={shareCount} onShareCount={onShareCount} currency={currency} />
    </section>
  );
}

function SharesList({
  view,
  shareCount,
  onShareCount,
  currency,
}: {
  view: TableBillView;
  shareCount: number;
  onShareCount: (n: number) => void;
  currency: string;
}) {
  const shares = view.equalSplit?.shares ?? [];
  const available = shares.filter((s) => s.state === "available").length;
  return (
    <>
      <ul className="shares">
        {shares.map((s) => (
          <li key={s.index}>
            <span>Доля {s.index + 1}</span>
            <span>
              {money(s.amountMinor, currency)}
              {s.state !== "available" && <span className="badge">{CLAIM_LABEL[s.state]}</span>}
            </span>
          </li>
        ))}
      </ul>
      {available > 0 && (
        <label className="split-setup">
          Оплачиваю долей:
          <input
            type="number"
            min={1}
            max={available}
            value={Math.min(shareCount, available)}
            onChange={(e) => onShareCount(Math.min(available, Math.max(1, Number(e.target.value) || 1)))}
          />
        </label>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row muted">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function ReceiptCard({ receipt }: { receipt: ReceiptView }) {
  const charged =
    receipt.chargeCurrency !== receipt.currency ? ` (${money(receipt.chargeAmountMinor, receipt.chargeCurrency)})` : "";
  const what =
    receipt.mode === "items"
      ? (receipt.items ?? []).map((i) => i.name).join(", ")
      : receipt.mode === "shares"
        ? `долей: ${receipt.shareCount}`
        : "весь остаток";
  return (
    <div className="receipt">
      {new Date(receipt.paidAt).toLocaleString(LOCALE, { dateStyle: "short", timeStyle: "short" })} · {what} ·{" "}
      {money(receipt.amountMinor + receipt.tipMinor, receipt.currency)}
      {charged}
    </div>
  );
}
