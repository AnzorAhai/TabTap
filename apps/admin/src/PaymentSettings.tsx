import type { PaymentMethod, StaffRole, TenantPaymentMethodView } from "@tabtap/shared";
import { useCallback, useState, type FormEvent } from "react";
import { api } from "./api";
import { useI18n } from "./i18n";
import type { Strings } from "./strings";
import { currentMonth, ErrorText, useAction, useLoad } from "./ui";

type DetailLabel = keyof Strings["detail"];

/** Payee details each method asks for (the API validates them). */
const DETAIL_FIELDS: Record<PaymentMethod, [key: string, label: DetailLabel][]> = {
  card: [],
  cash_usd: [],
  cash_ves: [],
  pago_movil: [
    ["bank", "bank"],
    ["phone", "phone"],
    ["documentId", "documentId"],
    ["holderName", "holderName"],
  ],
  zelle: [
    ["email", "email"],
    ["holderName", "holderName"],
  ],
  binance_pay: [
    ["payId", "payId"],
    ["holderName", "binanceName"],
  ],
};

const ALL_METHODS = Object.keys(DETAIL_FIELDS) as PaymentMethod[];
const PROOF_METHODS: PaymentMethod[] = ["pago_movil", "zelle", "binance_pay"];

export function PaymentMethodsSection({ tenantId, role }: { tenantId: string; role: StaffRole }) {
  const { t } = useI18n();
  const load = useCallback(() => api.paymentMethods(tenantId), [tenantId]);
  const saved = useLoad(load);
  return (
    <>
      <h1>{t.methodsTitle}</h1>
      <ErrorText error={saved.error} />
      {saved.data && (
        <MethodsForm
          key={JSON.stringify(saved.data)}
          tenantId={tenantId}
          role={role}
          initial={saved.data}
          onSaved={saved.reload}
        />
      )}
    </>
  );
}

function MethodsForm({
  tenantId,
  role,
  initial,
  onSaved,
}: {
  tenantId: string;
  role: StaffRole;
  initial: TenantPaymentMethodView[];
  onSaved: () => void;
}) {
  const { t } = useI18n();
  // Every known method is shown; ones the restaurant hasn't set up start disabled.
  const [methods, setMethods] = useState<TenantPaymentMethodView[]>(() => [
    ...initial,
    ...ALL_METHODS.filter((m) => !initial.some((i) => i.method === m)).map((method, i) => ({
      method,
      enabled: false,
      surchargeBps: 0,
      details: {},
      sortOrder: initial.length + i + 1,
    })),
  ]);
  const action = useAction();
  const editable = role === "owner" || role === "manager";
  const update = (method: PaymentMethod, change: Partial<TenantPaymentMethodView>) =>
    setMethods((list) => list.map((m) => (m.method === method ? { ...m, ...change } : m)));

  function submit(e: FormEvent) {
    e.preventDefault();
    void action.run(async () => {
      await api.updatePaymentMethods(tenantId, methods);
      onSaved();
    });
  }

  return (
    <section>
      <p className="muted">{t.methodsHint}</p>
      <form className="form" onSubmit={submit}>
        {methods.map((m) => (
          <fieldset key={m.method} className="method" disabled={!editable}>
            <legend>
              <label className="check">
                <input
                  type="checkbox"
                  checked={m.enabled}
                  onChange={(e) => update(m.method, { enabled: e.target.checked })}
                />
                {t.method[m.method]}
              </label>
            </legend>
            {m.enabled && (
              <div className="method-fields">
                <label className="field">
                  {t.surchargePercent}
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step={0.01}
                    value={m.surchargeBps / 100}
                    onChange={(e) => update(m.method, { surchargeBps: Math.round(Number(e.target.value) * 100) })}
                  />
                </label>
                {DETAIL_FIELDS[m.method].map(([key, label]) => (
                  <label key={key} className="field">
                    {t.detail[label]}
                    <input
                      value={m.details[key] ?? ""}
                      onChange={(e) => update(m.method, { details: { ...m.details, [key]: e.target.value } })}
                    />
                  </label>
                ))}
                {PROOF_METHODS.includes(m.method) && (
                  <label className="field">
                    {t.verification}
                    <select
                      value={m.details.verification ?? "staff"}
                      onChange={(e) => update(m.method, { details: { ...m.details, verification: e.target.value } })}
                    >
                      <option value="staff">{t.verifyStaff}</option>
                      <option value="simulated">{t.verifyDemo}</option>
                    </select>
                  </label>
                )}
              </div>
            )}
          </fieldset>
        ))}
        <ErrorText error={action.error} />
        {editable && (
          <div className="form-actions">
            <button disabled={action.busy}>{t.save}</button>
          </div>
        )}
      </form>
    </section>
  );
}

/** Platform fees accrued per month: TabTap invoices them to the restaurant. */
export function FeesSection({ tenantId }: { tenantId: string }) {
  const { t } = useI18n();
  const [month, setMonth] = useState(currentMonth());
  const load = useCallback(() => api.fees(tenantId, month), [tenantId, month]);
  const fees = useLoad(load);
  return (
    <>
      <h1>{t.feesTitle}</h1>
      <section>
        <p className="muted">{t.feesHint}</p>
        <label className="inline-field">
          {t.month}
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value || currentMonth())} />
        </label>
        <ErrorText error={fees.error} />
        <FeeTable rows={fees.data?.rows ?? []} showTenant={false} />
      </section>
    </>
  );
}

export function FeeTable({
  rows,
  showTenant,
}: {
  rows: { tenantName: string; currency: string; payments: number; billAmountMinor: number; feeMinor: number }[];
  showTenant: boolean;
}) {
  const { t, money } = useI18n();
  if (rows.length === 0) return <p className="muted">{t.noFees}</p>;
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {showTenant && <th>{t.colRestaurant}</th>}
            <th>{t.colCurrency}</th>
            <th className="num">{t.colPayments}</th>
            <th className="num">{t.colBills}</th>
            <th className="num">{t.colFee}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.tenantName}-${r.currency}`}>
              {showTenant && <td>{r.tenantName}</td>}
              <td>{r.currency}</td>
              <td className="num">{r.payments}</td>
              <td className="num">{money(r.billAmountMinor, r.currency)}</td>
              <td className="num">
                <strong>{money(r.feeMinor, r.currency)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
