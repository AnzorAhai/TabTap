import {
  convertMinor,
  type DemoMenuItemView,
  type DemoPosOrderView,
  type DemoPosTableView,
  type DemoPosView,
  type StaffRole,
} from "@tabtap/shared";
import { useCallback, useState } from "react";
import { api } from "./api";
import { useI18n } from "./i18n";
import { QrImage } from "./TablesPage";
import { ErrorText, useAction, useDialogs, useLoad, usePolling } from "./ui";

/** The waiter's screen of the demo POS: punch orders, watch guests pay, clear the table. */
export function PosPage({ tenantId, role }: { tenantId: string; role: StaffRole }) {
  const { t } = useI18n();
  const managing = role === "owner" || role === "manager";
  const load = useCallback(() => api.demoPos(tenantId), [tenantId]);
  const pos = useLoad(load);
  const { reload } = pos;
  // Quick enough that a guest's payment appears as they make it.
  usePolling(reload, 2000);
  const action = useAction();
  const dialogs = useDialogs();
  const [chosenTableId, setChosenTableId] = useState<string | null>(null);

  const view = pos.data;
  const table = view?.tables.find((x) => x.tableId === chosenTableId) ?? view?.tables[0] ?? null;

  const change = (update: () => Promise<unknown>) =>
    void action.run(async () => {
      await update();
      reload();
    });

  async function reset() {
    const ok = await dialogs.confirm({
      title: t.posResetTitle,
      body: t.posResetBody,
      confirmLabel: t.posReset,
      danger: true,
    });
    if (ok) change(() => api.demoPosReset(tenantId));
  }

  return (
    <>
      <div className="page-head">
        <h1>{t.posTitle}</h1>
        {managing && (
          <button type="button" className="ghost danger" disabled={action.busy} onClick={() => void reset()}>
            {t.posReset}
          </button>
        )}
      </div>
      <ErrorText error={pos.error ?? action.error} />
      {view && (
        <div className="pos-tables">
          {view.tables.map((x) => (
            <TableButton
              key={x.tableId}
              table={x}
              currency={view.currency}
              selected={x.tableId === table?.tableId}
              onSelect={() => setChosenTableId(x.tableId)}
            />
          ))}
        </div>
      )}
      {view && table && (
        <div className="pos-grid">
          <OrderPanel
            key={table.tableId}
            view={view}
            table={table}
            onRemove={(lineId) => change(() => api.demoPosRemoveLine(tenantId, table.tableId, lineId))}
            onClose={() => change(() => api.demoPosClose(tenantId, table.tableId))}
          />
          <Menu view={view} onAdd={(item) => change(() => api.demoPosAddLine(tenantId, table.tableId, item.id))} />
        </div>
      )}
    </>
  );
}

function TableButton({
  table,
  currency,
  selected,
  onSelect,
}: {
  table: DemoPosTableView;
  currency: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t, money } = useI18n();
  const { order } = table;
  const state = !order ? "free" : order.status === "paid" ? "paid" : order.reservedMinor > 0 ? "paying" : "open";
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`pos-table pos-table-${state} ${selected ? "pos-table-on" : ""}`}
      onClick={onSelect}
    >
      <strong>{table.label}</strong>
      <small>
        {!order && t.posFree}
        {order && (order.status === "paid" ? t.live.paid : money(order.remainingMinor + order.reservedMinor, currency))}
      </small>
    </button>
  );
}

function OrderPanel({
  view,
  table,
  onRemove,
  onClose,
}: {
  view: DemoPosView;
  table: DemoPosTableView;
  onRemove: (lineId: string) => void;
  onClose: () => void;
}) {
  const { t, money } = useI18n();
  const dialogs = useDialogs();
  const [showQr, setShowQr] = useState(false);
  const { order } = table;

  async function close(current: DemoPosOrderView) {
    const owed = current.remainingMinor + current.reservedMinor;
    if (owed > 0) {
      const ok = await dialogs.confirm({
        title: t.posCloseTitle(table.label),
        body: t.posCloseUnpaid(money(owed, view.currency)),
        confirmLabel: t.posClose,
        danger: true,
      });
      if (!ok) return;
    }
    onClose();
  }

  return (
    <section className="pos-order">
      <div className="section-head">
        <h2>{table.label}</h2>
        <button type="button" className="link" onClick={() => setShowQr((on) => !on)}>
          {showQr ? t.posHideQr : t.posShowQr}
        </button>
      </div>
      {showQr && (
        <div className="pos-qr">
          <QrImage value={table.guestUrl} alt={t.qrAlt(table.label)} pixels={520} shown={260} />
          <p className="muted small">{t.posScanHint}</p>
        </div>
      )}
      {!order && <p className="muted">{t.posEmpty}</p>}
      {order && <OrderDetails view={view} order={order} onRemove={onRemove} onClose={() => void close(order)} />}
    </section>
  );
}

function OrderDetails({
  view,
  order,
  onRemove,
  onClose,
}: {
  view: DemoPosView;
  order: DemoPosOrderView;
  onRemove: (lineId: string) => void;
  onClose: () => void;
}) {
  const { t, money } = useI18n();
  const { currency, rate } = view;
  const editable = order.payments.length === 0;

  return (
    <>
      <ul className="pos-lines">
        {order.lines.map((line) => (
          <li key={line.id} className={line.state === "paid" ? "pos-line pos-line-paid" : "pos-line"}>
            <span className="pos-line-name">
              {line.name}
              {line.state !== "available" && (
                <span className={`pill pill-${line.state === "paid" ? "succeeded" : "pending"}`}>
                  {t.posLineState[line.state]}
                </span>
              )}
            </span>
            <span className="pos-amount">{money(line.priceMinor, currency)}</span>
            {editable && (
              <button
                type="button"
                className="pos-remove"
                aria-label={`${t.remove}: ${line.name}`}
                onClick={() => onRemove(line.id)}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>

      <dl className="pos-sums">
        <div>
          <dt>{t.posSubtotal}</dt>
          <dd>{money(order.subtotalMinor, currency)}</dd>
        </div>
        <div>
          <dt>{t.posTax}</dt>
          <dd>{money(order.taxMinor, currency)}</dd>
        </div>
        <div>
          <dt>{t.posService}</dt>
          <dd>{money(order.serviceChargeMinor, currency)}</dd>
        </div>
      </dl>
      <div className="pos-total">
        <span>{t.posTotal}</span>
        <strong>{money(order.totalMinor, currency)}</strong>
      </div>
      {rate && (
        <p className="muted small pos-right">
          {money(convertMinor(order.totalMinor, currency, rate.currency, rate.value), rate.currency)}
        </p>
      )}

      {order.status === "paid" && (
        <div className="pos-paid" role="status">
          <strong>{t.live.paid}</strong>
          {order.tipMinor > 0 && <span>{t.posTipLine(money(order.tipMinor, currency))}</span>}
        </div>
      )}

      {order.payments.length > 0 && (
        <>
          {order.status !== "paid" && (
            <dl className="pos-sums pos-progress">
              <div>
                <dt>{t.posPaidSoFar}</dt>
                <dd>{money(order.paidMinor, currency)}</dd>
              </div>
              {order.reservedMinor > 0 && (
                <div>
                  <dt>{t.posInProgress}</dt>
                  <dd>{money(order.reservedMinor, currency)}</dd>
                </div>
              )}
              {order.tipMinor > 0 && (
                <div>
                  <dt>{t.colTip}</dt>
                  <dd>{money(order.tipMinor, currency)}</dd>
                </div>
              )}
              <div>
                <dt>{t.posLeft}</dt>
                <dd>{money(order.remainingMinor, currency)}</dd>
              </div>
            </dl>
          )}
          <h3>{t.posPayments}</h3>
          <ul className="pos-payments">
            {order.payments.map((p) => (
              <li key={p.id}>
                <span>{t.method[p.method]}</span>
                <span className="pos-amount">{money(p.chargeAmountMinor, p.chargeCurrency)}</span>
                <span className={`pill pill-${p.status}`}>{t.paymentStatus[p.status]}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <button type="button" className={order.status === "paid" ? "pos-close" : "ghost pos-close"} onClick={onClose}>
        {t.posClose}
      </button>
    </>
  );
}

function Menu({ view, onAdd }: { view: DemoPosView; onAdd: (item: DemoMenuItemView) => void }) {
  const { t, money } = useI18n();
  const { currency, rate } = view;
  const categories = [...new Set(view.menu.map((item) => item.category))];
  return (
    <section>
      <h2>{t.posMenu}</h2>
      {categories.map((category) => (
        <div key={category}>
          <h3>{category}</h3>
          <div className="pos-menu">
            {view.menu
              .filter((item) => item.category === category)
              .map((item) => (
                <button key={item.id} type="button" className="pos-dish" onClick={() => onAdd(item)}>
                  <span>{item.name}</span>
                  <strong>{money(item.priceMinor, currency)}</strong>
                  {rate && (
                    <small>
                      {money(convertMinor(item.priceMinor, currency, rate.currency, rate.value), rate.currency)}
                    </small>
                  )}
                </button>
              ))}
          </div>
        </div>
      ))}
    </section>
  );
}
