import type { AdminTableView, PaymentMode, PaymentStatus, StaffRole, TenantSettingsView } from "@tabtap/shared";
import QRCode from "qrcode";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import { ErrorText, formatMoney, formatTime, useAction, useLoad } from "./ui";

const STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: "В обработке",
  succeeded: "Оплачено",
  failed: "Ошибка",
  expired: "Истекло",
  canceled: "Отменено",
  refunded: "Возврат",
};

const MODE_LABEL: Record<PaymentMode, string> = {
  full: "Весь остаток",
  items: "Блюда",
  shares: "Доли",
};

function QrImage({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { margin: 1, width: 240 })
      .then((dataUrl) => !cancelled && setSrc(dataUrl))
      .catch(() => !cancelled && setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [value]);
  if (!src) return <div className="qr-placeholder" />;
  return <img src={src} alt="QR-код стола" width={120} height={120} />;
}

const canManage = (role: StaffRole) => role === "owner" || role === "manager";

export function TablesSection({ tenantId, role }: { tenantId: string; role: StaffRole }) {
  const loadTables = useCallback(() => api.tables(tenantId), [tenantId]);
  const loadVenues = useCallback(() => api.venues(tenantId), [tenantId]);
  const tables = useLoad(loadTables);
  const venues = useLoad(loadVenues);
  const action = useAction();
  const [label, setLabel] = useState("");
  const [posRef, setPosRef] = useState("");

  function create(e: FormEvent) {
    e.preventDefault();
    const venueId = venues.data?.[0]?.id;
    if (!venueId) return;
    void action.run(async () => {
      await api.createTable(tenantId, { venueId, label, posTableRef: posRef });
      setLabel("");
      setPosRef("");
      tables.reload();
    });
  }

  function change(table: AdminTableView, update: () => Promise<unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    void action.run(async () => {
      await update();
      tables.reload();
    });
  }

  return (
    <section>
      <h2>Столы и QR-коды</h2>
      <ErrorText error={tables.error ?? action.error} />
      <div className="tables-grid">
        {(tables.data ?? []).map((table) => (
          <div key={table.id} className={table.isActive ? "table-card" : "table-card inactive"}>
            <QrImage value={table.guestUrl} />
            <div className="table-label">{table.label}</div>
            <a href={table.guestUrl} target="_blank" rel="noreferrer">
              Открыть как гость
            </a>
            <span className="muted small">Касса: {table.posTableRef}</span>
            <span className={table.isActive ? "status-active" : "status-inactive"}>
              {table.isActive ? "Активен" : "Отключён"}
            </span>
            {canManage(role) && (
              <div className="card-actions">
                <button
                  type="button"
                  className="link"
                  disabled={action.busy}
                  onClick={() => {
                    const next = window.prompt("Название стола", table.label);
                    if (next && next !== table.label) {
                      change(table, () => api.updateTable(tenantId, table.id, { label: next }));
                    }
                  }}
                >
                  Переименовать
                </button>
                <button
                  type="button"
                  className="link"
                  disabled={action.busy}
                  onClick={() =>
                    change(table, () => api.updateTable(tenantId, table.id, { isActive: !table.isActive }))
                  }
                >
                  {table.isActive ? "Отключить" : "Включить"}
                </button>
                <button
                  type="button"
                  className="link"
                  disabled={action.busy}
                  onClick={() =>
                    change(
                      table,
                      () => api.rotateQr(tenantId, table.id),
                      "Выпустить новый QR-код? Напечатанный сейчас код перестанет работать.",
                    )
                  }
                >
                  Новый QR
                </button>
              </div>
            )}
          </div>
        ))}
        {tables.data?.length === 0 && <p>Столов пока нет.</p>}
      </div>
      {canManage(role) && (
        <form className="form inline" onSubmit={create}>
          <input
            placeholder="Название, напр. Стол 4"
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <input placeholder="ID стола в кассе" required value={posRef} onChange={(e) => setPosRef(e.target.value)} />
          <button disabled={action.busy || !venues.data?.length}>Добавить стол</button>
        </form>
      )}
    </section>
  );
}

export function PaymentsSection({ tenantId }: { tenantId: string }) {
  const load = useCallback(() => api.payments(tenantId), [tenantId]);
  const payments = useLoad(load);
  return (
    <section>
      <h2>
        Платежи{" "}
        <button type="button" className="link" onClick={payments.reload}>
          обновить
        </button>
      </h2>
      <ErrorText error={payments.error} />
      <div className="table-scroll">
        <table className="payments-table">
          <thead>
            <tr>
              <th>Время</th>
              <th>Стол</th>
              <th>Что оплачено</th>
              <th>Сумма</th>
              <th>Чаевые</th>
              <th>Комиссия</th>
              <th>Списано с гостя</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {(payments.data ?? []).map((p) => (
              <tr key={p.id}>
                <td>{formatTime(p.createdAt)}</td>
                <td>{p.tableLabel}</td>
                <td>{MODE_LABEL[p.mode]}</td>
                <td>{formatMoney(p.amountMinor, p.currency)}</td>
                <td>{p.tipMinor > 0 ? formatMoney(p.tipMinor, p.currency) : "—"}</td>
                <td>{formatMoney(p.platformFeeMinor, p.currency)}</td>
                <td>{formatMoney(p.chargeAmountMinor, p.chargeCurrency)}</td>
                <td>
                  <span className={`payment-status status-${p.status}`}>{STATUS_LABEL[p.status]}</span>
                </td>
              </tr>
            ))}
            {payments.data?.length === 0 && (
              <tr>
                <td colSpan={8}>Платежей пока нет.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function RatesSection({ tenantId, settings }: { tenantId: string; settings: TenantSettingsView }) {
  const load = useCallback(() => api.rates(tenantId), [tenantId]);
  const rates = useLoad(load);
  const action = useAction();
  const [quote, setQuote] = useState(settings.paymentCurrencies[0] ?? "VES");
  const [rate, setRate] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    void action.run(async () => {
      await api.setRate(tenantId, { baseCurrency: settings.defaultCurrency, quoteCurrency: quote, rate: rate.trim() });
      setRate("");
      rates.reload();
    });
  }

  return (
    <section>
      <h2>Курс</h2>
      <ErrorText error={rates.error} />
      {rates.data?.length === 0 && <p>Курс не задан — гости могут платить только в {settings.defaultCurrency}.</p>}
      {(rates.data ?? []).map((r) => (
        <p key={`${r.baseCurrency}-${r.quoteCurrency}`}>
          1 {r.baseCurrency} = <strong>{r.rate}</strong> {r.quoteCurrency} · с {formatTime(r.effectiveAt)} ({r.source})
        </p>
      ))}
      {canManage(settings.role) && (
        <form className="form inline" onSubmit={submit}>
          <span>1 {settings.defaultCurrency} =</span>
          <input
            inputMode="decimal"
            placeholder="например 236.5"
            required
            pattern="\d{1,12}(\.\d{1,8})?"
            value={rate}
            onChange={(e) => setRate(e.target.value.replace(",", "."))}
          />
          <input value={quote} maxLength={3} required onChange={(e) => setQuote(e.target.value.toUpperCase())} />
          <button disabled={action.busy}>Задать курс</button>
          <ErrorText error={action.error} />
        </form>
      )}
    </section>
  );
}

export function SettingsSection({
  settings,
  onSaved,
}: {
  settings: TenantSettingsView;
  onSaved: (s: TenantSettingsView) => void;
}) {
  const action = useAction();
  const [name, setName] = useState(settings.name);
  const [currencies, setCurrencies] = useState(settings.paymentCurrencies.join(", "));
  const [tips, setTips] = useState(settings.tipPercentOptions.join(", "));
  const editable = canManage(settings.role);

  function submit(e: FormEvent) {
    e.preventDefault();
    void action.run(async () => {
      const saved = await api.updateSettings(settings.id, {
        name: settings.role === "owner" ? name : undefined,
        paymentCurrencies: currencies
          .split(/[\s,]+/)
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean),
        tipPercentOptions: tips
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(Number),
      });
      onSaved(saved);
    });
  }

  return (
    <section>
      <h2>Настройки</h2>
      <form className="form" onSubmit={submit}>
        <label>
          Название ресторана
          <input value={name} disabled={settings.role !== "owner"} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Валюта счёта (из кассы)
          <input value={settings.defaultCurrency} disabled />
        </label>
        <label>
          Дополнительные валюты оплаты (через запятую, напр. VES)
          <input value={currencies} disabled={!editable} onChange={(e) => setCurrencies(e.target.value)} />
        </label>
        <label>
          Варианты чаевых, % (через запятую)
          <input value={tips} disabled={!editable} onChange={(e) => setTips(e.target.value)} />
        </label>
        <p className="muted">
          Комиссия TabTap: {(settings.platformFeeBps / 100).toLocaleString("ru-RU")}% от суммы счёта (без чаевых).
        </p>
        <ErrorText error={action.error} />
        {editable && <button disabled={action.busy}>Сохранить</button>}
      </form>
    </section>
  );
}
