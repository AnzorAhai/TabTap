import type { AdminTableView, PaymentMode, PaymentStatus, StaffRole, TenantSettingsView } from "@tabtap/shared";
import QRCode from "qrcode";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import { ErrorText, formatMoney, formatTime, METHOD_LABEL, useAction, useLoad } from "./ui";

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
  const action = useAction();
  const { reload } = payments;
  // Offline payments wait for staff, so keep the list fresh while it's open.
  useEffect(() => {
    const timer = window.setInterval(reload, 10_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  const review = (paymentId: string, decision: "confirm" | "reject") =>
    void action.run(async () => {
      if (decision === "confirm") await api.confirmPayment(tenantId, paymentId);
      else await api.rejectPayment(tenantId, paymentId, window.prompt("Причина (необязательно)") ?? undefined);
      reload();
    });

  const awaiting = (payments.data ?? []).filter((p) => p.awaitingReview);

  return (
    <section>
      <h2>
        Платежи{" "}
        <button type="button" className="link" onClick={reload}>
          обновить
        </button>
      </h2>
      <ErrorText error={payments.error ?? action.error} />
      {awaiting.length > 0 && (
        <div className="awaiting">
          <h3>Ждут подтверждения ({awaiting.length})</h3>
          {awaiting.map((p) => (
            <div key={p.id} className="awaiting-row">
              <div>
                <strong>{formatMoney(p.chargeAmountMinor, p.chargeCurrency)}</strong> · {METHOD_LABEL[p.method]} ·{" "}
                {p.tableLabel} · {formatTime(p.createdAt)}
                {p.proof && (
                  <div className="muted small">
                    {Object.entries(p.proof)
                      .map(([k, v]) => `${PROOF_LABEL[k] ?? k}: ${v}`)
                      .join(" · ")}
                  </div>
                )}
                {!p.proof && p.method.startsWith("cash") && (
                  <div className="muted small">Наличные — примите у гостя</div>
                )}
                {!p.proof && !p.method.startsWith("cash") && (
                  <div className="muted small">Гость ещё не сообщил номер операции</div>
                )}
              </div>
              <div className="actions">
                <button type="button" disabled={action.busy} onClick={() => review(p.id, "confirm")}>
                  Деньги получены
                </button>
                <button
                  type="button"
                  className="link danger"
                  disabled={action.busy}
                  onClick={() => review(p.id, "reject")}
                >
                  Отклонить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="table-scroll">
        <table className="payments-table">
          <thead>
            <tr>
              <th>Время</th>
              <th>Стол</th>
              <th>Что оплачено</th>
              <th>Способ</th>
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
                <td>{METHOD_LABEL[p.method]}</td>
                <td>{formatMoney(p.amountMinor, p.currency)}</td>
                <td>{p.tipMinor > 0 ? formatMoney(p.tipMinor, p.currency) : "—"}</td>
                <td>{formatMoney(p.platformFeeMinor, p.currency)}</td>
                <td>
                  {formatMoney(p.chargeAmountMinor, p.chargeCurrency)}
                  {p.surchargeMinor > 0 && (
                    <div className="muted small">вкл. надбавку {formatMoney(p.surchargeMinor, p.chargeCurrency)}</div>
                  )}
                </td>
                <td>
                  <span className={`payment-status status-${p.status}`}>{STATUS_LABEL[p.status]}</span>
                </td>
              </tr>
            ))}
            {payments.data?.length === 0 && (
              <tr>
                <td colSpan={9}>Платежей пока нет.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const PROOF_LABEL: Record<string, string> = {
  reference: "Операция",
  payerPhone: "Телефон",
  payerBank: "Банк",
  payerName: "Отправитель",
};

export function RatesSection({ tenantId, settings }: { tenantId: string; settings: TenantSettingsView }) {
  const load = useCallback(() => api.rates(tenantId), [tenantId]);
  const rates = useLoad(load);
  const action = useAction();
  const [quote, setQuote] = useState("VES");
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
      <ErrorText error={rates.error ?? action.error} />
      {rates.data?.length === 0 && <p>Курс не задан — оплата в боливарах недоступна.</p>}
      {(rates.data ?? []).map((r) => (
        <p key={`${r.baseCurrency}-${r.quoteCurrency}`}>
          1 {r.baseCurrency} = <strong>{r.rate}</strong> {r.quoteCurrency} · с {formatTime(r.effectiveAt)} (
          {r.source === "bcv" ? "BCV" : r.source === "manual" ? "вручную" : r.source})
        </p>
      ))}
      <p className="muted">
        {settings.rateSource === "bcv"
          ? "Официальный курс BCV подтягивается автоматически каждый час. Курс, введённый вручную, действует до следующего изменения курса BCV."
          : "Курс вводится вручную. Автоматический курс BCV можно включить в настройках."}
      </p>
      {canManage(settings.role) && (
        <>
          <button
            type="button"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await api.refreshBcv(tenantId);
                rates.reload();
              })
            }
          >
            Взять курс BCV сейчас
          </button>
          <form className="form inline" onSubmit={submit}>
            <span>1 {settings.defaultCurrency} =</span>
            <input
              inputMode="decimal"
              placeholder="например 896.12"
              required
              pattern="\d{1,12}(\.\d{1,8})?"
              value={rate}
              onChange={(e) => setRate(e.target.value.replace(",", "."))}
            />
            <input value={quote} maxLength={3} required onChange={(e) => setQuote(e.target.value.toUpperCase())} />
            <button disabled={action.busy}>Задать вручную</button>
          </form>
        </>
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
  const [rateSource, setRateSource] = useState(settings.rateSource);
  const [tips, setTips] = useState(settings.tipPercentOptions.join(", "));
  const editable = canManage(settings.role);

  function submit(e: FormEvent) {
    e.preventDefault();
    void action.run(async () => {
      const saved = await api.updateSettings(settings.id, {
        name: settings.role === "owner" ? name : undefined,
        rateSource,
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
          Курс USD → VES
          <select
            value={rateSource}
            disabled={!editable}
            onChange={(e) => setRateSource(e.target.value as "manual" | "bcv")}
          >
            <option value="bcv">Официальный курс BCV, автоматически</option>
            <option value="manual">Вводить вручную</option>
          </select>
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
