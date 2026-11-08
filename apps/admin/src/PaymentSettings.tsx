import type { PaymentMethod, StaffRole, TenantPaymentMethodView } from "@tabtap/shared";
import { useCallback, useState, type FormEvent } from "react";
import { api } from "./api";
import { currentMonth, ErrorText, formatMoney, METHOD_LABEL, useAction, useLoad } from "./ui";

/** Payee details each method asks for (the API validates them). */
const DETAIL_FIELDS: Record<PaymentMethod, [key: string, label: string][]> = {
  card: [],
  cash_usd: [],
  cash_ves: [],
  pago_movil: [
    ["bank", "Банк (код и название)"],
    ["phone", "Телефон Pago Móvil"],
    ["documentId", "RIF / C.I."],
    ["holderName", "Получатель"],
  ],
  zelle: [
    ["email", "Email Zelle"],
    ["holderName", "Получатель"],
  ],
  binance_pay: [
    ["payId", "Binance Pay ID"],
    ["holderName", "Имя в Binance"],
  ],
};

const ALL_METHODS = Object.keys(DETAIL_FIELDS) as PaymentMethod[];
const PROOF_METHODS: PaymentMethod[] = ["pago_movil", "zelle", "binance_pay"];

export function PaymentMethodsSection({ tenantId, role }: { tenantId: string; role: StaffRole }) {
  const load = useCallback(() => api.paymentMethods(tenantId), [tenantId]);
  const saved = useLoad(load);
  return saved.data ? (
    <MethodsForm
      key={JSON.stringify(saved.data)}
      tenantId={tenantId}
      role={role}
      initial={saved.data}
      onSaved={saved.reload}
    />
  ) : (
    <section>
      <h2>Способы оплаты</h2>
      <ErrorText error={saved.error} />
    </section>
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
      <h2>Способы оплаты</h2>
      <p className="muted">
        Гости платят прямо ресторану. Надбавка — например, IGTF 3% для contribuyentes especiales при оплате в валюте вне
        банковской системы Венесуэлы (наличные USD, Zelle, Binance); уточните у бухгалтера.
      </p>
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
                {METHOD_LABEL[m.method]}
              </label>
            </legend>
            {m.enabled && (
              <div className="method-fields">
                <label>
                  Надбавка, %
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
                  <label key={key}>
                    {label}
                    <input
                      value={m.details[key] ?? ""}
                      onChange={(e) => update(m.method, { details: { ...m.details, [key]: e.target.value } })}
                    />
                  </label>
                ))}
                {PROOF_METHODS.includes(m.method) && (
                  <label>
                    Проверка перевода
                    <select
                      value={m.details.verification ?? "staff"}
                      onChange={(e) => update(m.method, { details: { ...m.details, verification: e.target.value } })}
                    >
                      <option value="staff">Сотрудник подтверждает вручную</option>
                      <option value="simulated">Демо: проверяется автоматически</option>
                    </select>
                  </label>
                )}
              </div>
            )}
          </fieldset>
        ))}
        <ErrorText error={action.error} />
        {editable && <button disabled={action.busy}>Сохранить</button>}
      </form>
    </section>
  );
}

/** Platform fees accrued per month: TabTap invoices them to the restaurant. */
export function FeesSection({ tenantId }: { tenantId: string }) {
  const [month, setMonth] = useState(currentMonth());
  const load = useCallback(() => api.fees(tenantId, month), [tenantId, month]);
  const fees = useLoad(load);
  return (
    <section>
      <h2>Комиссия TabTap</h2>
      <p className="muted">
        Начисляется с суммы счёта (без чаевых) по каждой проведённой оплате; счёт выставляется раз в месяц.
      </p>
      <label className="form inline">
        Месяц <input type="month" value={month} onChange={(e) => setMonth(e.target.value || currentMonth())} />
      </label>
      <ErrorText error={fees.error} />
      <FeeTable rows={fees.data?.rows ?? []} showTenant={false} />
    </section>
  );
}

export function FeeTable({
  rows,
  showTenant,
}: {
  rows: { tenantName: string; currency: string; payments: number; billAmountMinor: number; feeMinor: number }[];
  showTenant: boolean;
}) {
  if (rows.length === 0) return <p>За этот месяц оплат нет.</p>;
  return (
    <div className="table-scroll">
      <table className="payments-table">
        <thead>
          <tr>
            {showTenant && <th>Ресторан</th>}
            <th>Валюта</th>
            <th>Оплат</th>
            <th>Сумма счетов</th>
            <th>Комиссия</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.tenantName}-${r.currency}`}>
              {showTenant && <td>{r.tenantName}</td>}
              <td>{r.currency}</td>
              <td>{r.payments}</td>
              <td>{formatMoney(r.billAmountMinor, r.currency)}</td>
              <td>
                <strong>{formatMoney(r.feeMinor, r.currency)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
