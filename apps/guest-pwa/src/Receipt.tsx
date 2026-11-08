import type { ReceiptView } from "@tabtap/shared";
import { useI18n } from "./i18n";
import { useInstallPrompt } from "./pwa";
import { IconCheck, IconWhatsapp, TopBar } from "./ui";

type I18n = ReturnType<typeof useI18n>;

function whatWasPaid(receipt: ReceiptView, t: I18n["t"]): string {
  if (receipt.mode === "items") return (receipt.items ?? []).map((i) => `${i.quantity}× ${i.name}`).join(", ");
  return receipt.mode === "shares" ? t.payingShares(receipt.shareCount ?? 1) : t.payingAll;
}

function surchargeLabel(receipt: ReceiptView, { t, number }: I18n): string {
  const percent = `${number(receipt.surchargeBps / 100)}%`;
  return receipt.chargeCurrency === "USD" ? t.igtf(percent) : t.surcharge(percent);
}

/** Plain text of the receipt for sending to someone. */
function receiptText(receipt: ReceiptView, i18n: I18n): string {
  const { t, money, dateTime } = i18n;
  const lines = [
    `🧾 ${t.receiptHeading} — ${receipt.tenantName}`,
    `${receipt.tableLabel} · ${dateTime(receipt.paidAt)}`,
    whatWasPaid(receipt, t),
    `${t.billAmount}: ${money(receipt.amountMinor, receipt.currency)}`,
  ];
  if (receipt.tipMinor > 0) lines.push(`${t.tip}: ${money(receipt.tipMinor, receipt.currency)}`);
  if (receipt.surchargeMinor > 0) {
    lines.push(`${surchargeLabel(receipt, i18n)}: ${money(receipt.surchargeMinor, receipt.chargeCurrency)}`);
  }
  lines.push(
    `${t.receiptCharged}: ${money(receipt.chargeAmountMinor, receipt.chargeCurrency)} (${t.method[receipt.method]})`,
    t.receiptNotFiscal,
  );
  return lines.join("\n");
}

function ReceiptDetails({ receipt }: { receipt: ReceiptView }) {
  const i18n = useI18n();
  const { t, money, number, dateTime } = i18n;
  return (
    <>
      <p className="receipt-place">
        <strong>{receipt.venueName}</strong>
        <span className="muted">
          {receipt.tableLabel} · {dateTime(receipt.paidAt)}
        </span>
      </p>
      <p className="receipt-what">{whatWasPaid(receipt, t)}</p>
      <dl className="rows">
        <div>
          <dt>{t.billAmount}</dt>
          <dd>{money(receipt.amountMinor, receipt.currency)}</dd>
        </div>
        {receipt.tipMinor > 0 && (
          <div>
            <dt>{t.tip}</dt>
            <dd>{money(receipt.tipMinor, receipt.currency)}</dd>
          </div>
        )}
        {receipt.surchargeMinor > 0 && (
          <div>
            <dt>{surchargeLabel(receipt, i18n)}</dt>
            <dd>{money(receipt.surchargeMinor, receipt.chargeCurrency)}</dd>
          </div>
        )}
        {receipt.exchangeRate && (
          <div>
            <dt>{t.receiptRate}</dt>
            <dd>
              1 {receipt.currency} = {number(receipt.exchangeRate, 4)} {receipt.chargeCurrency}
            </dd>
          </div>
        )}
        {receipt.method && (
          <div>
            <dt>{t.receiptPaidWith}</dt>
            <dd>{t.method[receipt.method]}</dd>
          </div>
        )}
      </dl>
      <div className="grand-total">
        <span>{t.receiptCharged}</span>
        <strong>{money(receipt.chargeAmountMinor, receipt.chargeCurrency)}</strong>
      </div>
      <p className="muted small">{t.receiptNotFiscal}</p>
      <a
        className="button whatsapp"
        href={`https://wa.me/?text=${encodeURIComponent(receiptText(receipt, i18n))}`}
        target="_blank"
        rel="noreferrer"
      >
        <IconWhatsapp /> {t.shareWhatsapp}
      </a>
    </>
  );
}

/** The moment after paying: success and the receipt. */
export function PaymentDone({
  receipt,
  billFullyPaid,
  onBack,
}: {
  receipt: ReceiptView | null;
  billFullyPaid: boolean;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const install = useInstallPrompt();
  return (
    <div className="app">
      <TopBar />
      <main>
        <div className="success" role="status">
          <span className="success-tick">
            <IconCheck size={44} />
          </span>
          <h1>{billFullyPaid ? t.billPaidTitle : t.doneTitle}</h1>
          <p className="muted">{t.doneHint}</p>
        </div>
        {receipt && (
          <section className="paper">
            <ReceiptDetails receipt={receipt} />
          </section>
        )}
        <div className="after-actions">
          <button type="button" className="secondary" onClick={onBack}>
            {t.backToBill}
          </button>
          {install && (
            <button type="button" className="link" onClick={install}>
              {t.install}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

/** Earlier receipts for this bill, kept in this browser. */
export function ReceiptsList({ receipts }: { receipts: ReceiptView[] }) {
  const { t, money, time } = useI18n();
  if (receipts.length === 0) return null;
  return (
    <section>
      <h2>{t.yourReceipts}</h2>
      {receipts.map((receipt) => (
        <details key={receipt.receiptId} className="receipt-row">
          <summary>
            <span>{time(receipt.paidAt)}</span>
            <span className="amount">{money(receipt.chargeAmountMinor, receipt.chargeCurrency)}</span>
          </summary>
          <ReceiptDetails receipt={receipt} />
        </details>
      ))}
    </section>
  );
}
