import { convertMinor, type TableBillView } from "@tabtap/shared";
import { useI18n } from "./i18n";

/** The bill itself, drawn as a paper receipt. */
export function BillCard({ view }: { view: TableBillView }) {
  const { t, money } = useI18n();
  const { bill } = view;
  const localOption = view.paymentMethods.find((m) => m.rate);
  const showProgress = bill.paidMinor > 0 || bill.reservedMinor > 0;
  const percent = (minor: number) => `${Math.min(100, (minor / bill.totalMinor) * 100)}%`;

  return (
    <section className="paper" aria-label={t.yourBill}>
      <h2>{t.yourBill}</h2>
      <ul className="lines">
        {bill.items.map((item) => (
          <li key={item.id} className={item.state === "paid" ? "line line-paid" : "line"}>
            <span className="qty">{item.quantity}×</span>
            <span className="line-name">
              {item.name}
              {item.state !== "available" && <span className={`chip chip-${item.state}`}>{t.claim[item.state]}</span>}
            </span>
            <span className="amount">{money(item.lineTotalMinor, bill.currency)}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">{t.pricesInclude}</p>
      <dl className="rows">
        <div>
          <dt>{t.subtotal}</dt>
          <dd>{money(bill.subtotalMinor, bill.currency)}</dd>
        </div>
        <div>
          <dt>{t.tax}</dt>
          <dd>{money(bill.taxMinor, bill.currency)}</dd>
        </div>
        {bill.serviceChargeMinor > 0 && (
          <div>
            <dt>{t.service}</dt>
            <dd>{money(bill.serviceChargeMinor, bill.currency)}</dd>
          </div>
        )}
      </dl>
      <div className="grand-total">
        <span>{t.total}</span>
        <strong>{money(bill.totalMinor, bill.currency)}</strong>
      </div>
      {localOption?.rate && (
        <p className="muted small right">
          {t.inLocalCurrency(
            money(
              convertMinor(bill.totalMinor, bill.currency, localOption.currency, localOption.rate),
              localOption.currency,
            ),
          )}
        </p>
      )}

      {showProgress && (
        <div className="progress">
          <div className="bar" aria-hidden="true">
            <span className="bar-paid" style={{ width: percent(bill.paidMinor) }} />
            <span className="bar-held" style={{ width: percent(bill.reservedMinor) }} />
          </div>
          <dl className="progress-legend">
            <div>
              <dt>{t.paid}</dt>
              <dd>{money(bill.paidMinor, bill.currency)}</dd>
            </div>
            {bill.reservedMinor > 0 && (
              <div>
                <dt>{t.inProgress}</dt>
                <dd>{money(bill.reservedMinor, bill.currency)}</dd>
              </div>
            )}
            <div>
              <dt>{t.left}</dt>
              <dd>{money(bill.remainingMinor, bill.currency)}</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
