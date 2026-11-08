import {
  percentOf,
  type PaymentMethod,
  type PaymentMethodOption,
  type PaymentMode,
  type TableBillView,
} from "@tabtap/shared";
import type { ReactNode } from "react";
import { chargeFor } from "./BillFlow";
import { useI18n } from "./i18n";
import { BackButton, Spinner, TopBar } from "./ui";

export function Checkout(props: {
  view: TableBillView;
  mode: PaymentMode;
  itemCount: number;
  shareCount: number;
  amountMinor: number;
  tipMinor: number;
  tipPercent: number;
  onTip: (percent: number) => void;
  method: PaymentMethodOption | null;
  onMethod: (method: PaymentMethod) => void;
  busy: boolean;
  onPay: () => void;
  onBack: () => void;
  banner: ReactNode;
}) {
  const { t, money, number, dateTime } = useI18n();
  const { view, amountMinor, tipMinor, method } = props;
  const { bill } = view;
  const subject = amountMinor + tipMinor;
  const charge = method ? chargeFor(method, subject, bill.currency) : null;
  const payCurrency = method?.currency ?? bill.currency;
  const percentText = method ? `${number(method.surchargeBps / 100)}%` : "";
  const surchargeLabel = payCurrency === "USD" ? t.igtf(percentText) : t.surcharge(percentText);
  const what =
    props.mode === "full"
      ? t.payingAll
      : props.mode === "items"
        ? t.payingItems(props.itemCount)
        : t.payingShares(props.shareCount);

  return (
    <div className="app with-paybar">
      <TopBar />
      <main>
        <BackButton onClick={props.onBack} />
        <h1>{t.yourPayment}</h1>
        {props.banner}

        <section>
          <h2>{t.tip}</h2>
          <div className="tips">
            {view.tipPercentOptions.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={option === props.tipPercent}
                className={option === props.tipPercent ? "tip tip-on" : "tip"}
                onClick={() => props.onTip(option)}
              >
                {option === 0 ? (
                  t.noTip
                ) : (
                  <>
                    <strong>{option}%</strong>
                    <small className="amount">{money(percentOf(amountMinor, option), bill.currency)}</small>
                  </>
                )}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>{t.paymentMethod}</h2>
          {view.paymentMethods.length === 0 && <p className="muted">{t.noMethods}</p>}
          <div className="methods" role="radiogroup" aria-label={t.paymentMethod}>
            {view.paymentMethods.map((option) => {
              const on = option.method === method?.method;
              return (
                <label key={option.method} className={on ? "method method-on" : "method"}>
                  <input type="radio" name="method" checked={on} onChange={() => props.onMethod(option.method)} />
                  <span className="radio" aria-hidden="true" />
                  <span className="method-text">
                    <strong>{t.method[option.method]}</strong>
                    <small>{t.methodHint[option.method]}</small>
                  </span>
                  <span className="amount">
                    {money(chargeFor(option, subject, bill.currency).chargeMinor, option.currency)}
                  </span>
                </label>
              );
            })}
          </div>
          {method?.rate && (
            <p className="muted small">
              {t.rateLine(bill.currency, number(method.rate, 4), method.currency)}
              {method.rateEffectiveAt && ` · ${dateTime(method.rateEffectiveAt)}`}
            </p>
          )}
        </section>

        <section>
          <dl className="rows">
            <div>
              <dt>
                {t.billAmount} · {what}
              </dt>
              <dd>{money(amountMinor, bill.currency)}</dd>
            </div>
            {tipMinor > 0 && (
              <div>
                <dt>{t.tip}</dt>
                <dd>{money(tipMinor, bill.currency)}</dd>
              </div>
            )}
            {charge && charge.surchargeMinor > 0 && (
              <div>
                <dt>{surchargeLabel}</dt>
                <dd>{money(charge.surchargeMinor, payCurrency)}</dd>
              </div>
            )}
          </dl>
          <div className="grand-total">
            <span>{t.totalToPay}</span>
            <strong>{money(charge?.chargeMinor ?? subject, payCurrency)}</strong>
          </div>
          {method && <p className="muted small">{t.holdNote(method.holdMinutes)}</p>}
        </section>
      </main>

      <div className="paybar">
        <button
          type="button"
          className="primary"
          disabled={!method || amountMinor <= 0 || props.busy}
          onClick={props.onPay}
        >
          {props.busy ? (
            <>
              <Spinner /> <span>{t.paying}</span>
            </>
          ) : (
            <span>{t.payAction(money(charge?.chargeMinor ?? subject, payCurrency))}</span>
          )}
        </button>
      </div>
    </div>
  );
}
