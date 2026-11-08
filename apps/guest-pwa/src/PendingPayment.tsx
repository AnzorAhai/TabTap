import { formatMoney, type PaymentView } from "@tabtap/shared";
import { useState, type FormEvent } from "react";
import { api } from "./api";
import { METHOD_LABEL, PAY_TO_LABEL } from "./methods";

const LOCALE = "ru-RU";
/** The demo card gateway's "bank confirmed / declined" buttons (dev builds, or when enabled for a demo). */
const DEMO_PAYMENT_CONTROLS = import.meta.env.DEV || import.meta.env.VITE_DEMO_PAYMENT_CONTROLS === "true";

const money = (minor: number, currency: string) => formatMoney(minor, currency, LOCALE);

/** A started payment that isn't confirmed yet: what to do next depends on the method. */
export function PendingPayment({
  payment,
  busy,
  run,
  onUpdate,
}: {
  payment: PaymentView;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  onUpdate: (p: PaymentView) => Promise<void>;
}) {
  const amount = money(payment.chargeAmountMinor, payment.chargeCurrency);
  const holdUntil = payment.expiresAt
    ? new Date(payment.expiresAt).toLocaleTimeString(LOCALE, { timeStyle: "short" })
    : null;
  const cancel = (
    <button
      className="secondary"
      disabled={busy}
      onClick={() => void run(async () => onUpdate(await api.cancelPayment(payment.id)))}
    >
      Отменить
    </button>
  );

  if (payment.flow === "staff") {
    return (
      <section className="pending">
        <h2>Оплата наличными</h2>
        <p>
          Передайте официанту <strong>{amount}</strong>. Он подтвердит получение, и счёт обновится сам.
        </p>
        <p className="muted small">Выбранное закреплено за вами до {holdUntil}.</p>
        <div className="actions">{cancel}</div>
      </section>
    );
  }

  if (payment.flow === "proof") {
    return (
      <section className="pending">
        <h2>{METHOD_LABEL[payment.method]}</h2>
        {payment.proofSubmitted ? (
          <>
            <p>Проверяем перевод…</p>
            <p className="muted small">Обычно это занимает до минуты. Страница обновится сама.</p>
          </>
        ) : (
          <>
            <p>
              Переведите ровно <strong>{amount}</strong>:
            </p>
            <dl className="pay-to">
              {Object.entries(payment.payTo ?? {}).map(([key, value]) => (
                <div key={key}>
                  <dt>{PAY_TO_LABEL[key] ?? key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <ProofForm payment={payment} busy={busy} run={run} onUpdate={onUpdate} />
            <p className="muted small">Выбранное закреплено за вами до {holdUntil}.</p>
            <div className="actions">{cancel}</div>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="pending">
      <h2>Ждём подтверждения оплаты…</h2>
      <p className="muted">
        {amount} · резерв до {holdUntil}
      </p>
      <div className="actions">
        {DEMO_PAYMENT_CONTROLS && (
          <>
            <button
              disabled={busy}
              onClick={() => void run(async () => onUpdate(await api.mockConfirm(payment.id, "succeeded")))}
            >
              Банк подтвердил (демо)
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void run(async () => onUpdate(await api.mockConfirm(payment.id, "failed")))}
            >
              Банк отклонил (демо)
            </button>
          </>
        )}
        {cancel}
      </div>
    </section>
  );
}

function ProofForm({
  payment,
  busy,
  run,
  onUpdate,
}: {
  payment: PaymentView;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  onUpdate: (p: PaymentView) => Promise<void>;
}) {
  const [reference, setReference] = useState("");
  const [payerPhone, setPayerPhone] = useState("");
  const [payerBank, setPayerBank] = useState("");
  const [payerName, setPayerName] = useState("");
  const isPagoMovil = payment.method === "pago_movil";

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () =>
      onUpdate(
        await api.submitProof(payment.id, {
          reference,
          payerPhone: payerPhone || undefined,
          payerBank: payerBank || undefined,
          payerName: payerName || undefined,
        }),
      ),
    );
  }

  return (
    <form className="proof-form" onSubmit={submit}>
      <label>
        {isPagoMovil
          ? "Номер операции (referencia)"
          : payment.method === "zelle"
            ? "Код подтверждения Zelle"
            : "ID ордера Binance"}
        <input
          required
          minLength={4}
          maxLength={40}
          value={reference}
          onChange={(e) => setReference(e.target.value.trim())}
        />
      </label>
      {isPagoMovil ? (
        <>
          <label>
            Ваш телефон
            <input inputMode="tel" value={payerPhone} onChange={(e) => setPayerPhone(e.target.value)} />
          </label>
          <label>
            Ваш банк
            <input value={payerBank} onChange={(e) => setPayerBank(e.target.value)} />
          </label>
        </>
      ) : (
        <label>
          Имя отправителя
          <input value={payerName} onChange={(e) => setPayerName(e.target.value)} />
        </label>
      )}
      <button disabled={busy}>Я оплатил(а)</button>
    </form>
  );
}
