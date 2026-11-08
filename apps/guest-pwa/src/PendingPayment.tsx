import { minorToDecimal, type PaymentView } from "@tabtap/shared";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import { useI18n } from "./i18n";
import { CopyButton, IconHandCash, Spinner } from "./ui";

/** The demo card gateway's "bank confirmed / declined" buttons (dev builds, or when enabled for a demo). */
const DEMO_PAYMENT_CONTROLS = import.meta.env.DEV || import.meta.env.VITE_DEMO_PAYMENT_CONTROLS === "true";

type Props = {
  payment: PaymentView;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  onUpdate: (p: PaymentView) => Promise<void>;
};

/** "12:34" until the hold on the guest's items ends. */
function useCountdown(expiresAt: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (!expiresAt) return null;
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A started payment that isn't confirmed yet: what to do next depends on the method. */
export function PendingPayment(props: Props) {
  const { payment, busy, run, onUpdate } = props;
  const { t, money } = useI18n();
  const countdown = useCountdown(payment.expiresAt);
  const amount = money(payment.chargeAmountMinor, payment.chargeCurrency);

  const cancel = (
    <button
      type="button"
      className="secondary"
      disabled={busy}
      onClick={() => void run(async () => onUpdate(await api.cancelPayment(payment.id)))}
    >
      {t.cancelPayment}
    </button>
  );
  const hold = countdown && (
    <p className="hold">
      {t.reservedFor} <strong className="amount">{countdown}</strong>
    </p>
  );

  if (payment.flow === "staff") {
    return (
      <section className="pending">
        <span className="pending-icon">
          <IconHandCash size={34} />
        </span>
        <h1>{t.cashTitle}</h1>
        <p className="big-amount">{amount}</p>
        <p className="muted">{t.cashHint}</p>
        <div className="waiting">
          <Spinner />
        </div>
        {hold}
        {cancel}
      </section>
    );
  }

  if (payment.flow === "proof") {
    if (payment.proofSubmitted) {
      return (
        <section className="pending">
          <div className="waiting">
            <Spinner />
          </div>
          <h1>{t.verifyingTitle}</h1>
          <p className="big-amount">{amount}</p>
          <p className="muted">{t.verifyingHint}</p>
        </section>
      );
    }
    // Banking apps take the amount as plain digits, with a comma for bolívares.
    const copyAmount = minorToDecimal(payment.chargeAmountMinor, payment.chargeCurrency).replace(
      ".",
      payment.chargeCurrency === "VES" ? "," : ".",
    );
    return (
      <section className="pending pending-left">
        <h1>{t.method[payment.method]}</h1>
        <p className="muted">{t.sendExactly}</p>
        <div className="amount-copy">
          <p className="big-amount">{amount}</p>
          <CopyButton value={copyAmount} />
        </div>
        <h2>{t.payToTitle}</h2>
        <dl className="pay-to">
          {Object.entries(payment.payTo ?? {}).map(([key, value]) => (
            <div key={key}>
              <dt>{t.payTo[key] ?? key}</dt>
              <dd>
                <span>{value}</span>
                <CopyButton value={value} />
              </dd>
            </div>
          ))}
        </dl>
        <h2>{t.proofTitle}</h2>
        <ProofForm {...props} />
        {hold}
        {cancel}
      </section>
    );
  }

  return (
    <section className="pending">
      <div className="waiting">
        <Spinner />
      </div>
      <h1>{t.gatewayTitle}</h1>
      <p className="big-amount">{amount}</p>
      {hold}
      {DEMO_PAYMENT_CONTROLS && (
        <>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void run(async () => onUpdate(await api.mockConfirm(payment.id, "succeeded")))}
          >
            {t.demoApprove}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void run(async () => onUpdate(await api.mockConfirm(payment.id, "failed")))}
          >
            {t.demoDecline}
          </button>
        </>
      )}
      {cancel}
    </section>
  );
}

function ProofForm({ payment, busy, run, onUpdate }: Props) {
  const { t } = useI18n();
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
        {t.reference[payment.method]}
        <input
          required
          pattern="[A-Za-z0-9\-]{4,40}"
          title={t.referenceHint}
          maxLength={40}
          autoComplete="off"
          inputMode={isPagoMovil ? "numeric" : "text"}
          value={reference}
          onChange={(e) => setReference(e.target.value.trim())}
        />
      </label>
      {isPagoMovil ? (
        <>
          <label>
            <span>
              {t.payerPhone} <small>({t.optional})</small>
            </span>
            <input
              type="tel"
              pattern="[0-9+\-\s()]{7,20}"
              autoComplete="tel"
              value={payerPhone}
              onChange={(e) => setPayerPhone(e.target.value)}
            />
          </label>
          <label>
            <span>
              {t.payerBank} <small>({t.optional})</small>
            </span>
            <input maxLength={60} value={payerBank} onChange={(e) => setPayerBank(e.target.value)} />
          </label>
        </>
      ) : (
        <label>
          <span>
            {t.payerName} <small>({t.optional})</small>
          </span>
          <input maxLength={100} autoComplete="name" value={payerName} onChange={(e) => setPayerName(e.target.value)} />
        </label>
      )}
      <button type="submit" className="primary" disabled={busy}>
        {t.iPaid}
      </button>
    </form>
  );
}
