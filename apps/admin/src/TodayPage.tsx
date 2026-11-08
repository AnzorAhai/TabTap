import type { AdminPaymentView, DailySummaryView, LiveTableView, StaffRole } from "@tabtap/shared";
import { useCallback, useState } from "react";
import { api } from "./api";
import { useI18n } from "./i18n";
import type { LiveState } from "./strings";
import { ErrorText, useAction, useDialogs, useLoad, usePolling } from "./ui";

/** What staff keep open during service: money waiting, tables, and (for managers) the day's takings. */
export function TodayPage({ tenantId, role }: { tenantId: string; role: StaffRole }) {
  const { t } = useI18n();
  const managing = role === "owner" || role === "manager";

  const loadLive = useCallback(() => api.liveTables(tenantId), [tenantId]);
  const live = useLoad(loadLive);
  const loadWaiting = useCallback(() => api.payments(tenantId, { status: "pending", limit: 200 }), [tenantId]);
  const waiting = useLoad(loadWaiting);
  const { reload: reloadLive } = live;
  const { reload: reloadWaiting } = waiting;
  const refresh = useCallback(() => {
    reloadLive();
    reloadWaiting();
  }, [reloadLive, reloadWaiting]);
  usePolling(refresh, 5000);

  return (
    <>
      <h1>{t.todayTitle}</h1>
      <ErrorText error={live.error ?? waiting.error} />
      <AwaitingList
        tenantId={tenantId}
        payments={(waiting.data ?? []).filter((p) => p.awaitingReview)}
        onChanged={refresh}
      />
      {managing && <DaySummary tenantId={tenantId} />}
      <section>
        <div className="section-head">
          <h2>{t.liveTables}</h2>
          <span className="pulse" aria-hidden="true" />
        </div>
        <p className="muted small">{t.liveHint}</p>
        <div className="live-grid">
          {(live.data ?? []).map((table) => (
            <LiveTile key={table.tableId} table={table} />
          ))}
        </div>
      </section>
    </>
  );
}

function liveState(table: LiveTableView): LiveState {
  if (!table.isActive) return "off";
  if (!table.bill) return "free";
  if (table.bill.reservedMinor > 0) return "paying";
  if (table.bill.status === "paid") return "paid";
  if (table.bill.status === "closed") return "closed";
  return table.bill.status === "partially_paid" ? "partial" : "open";
}

function LiveTile({ table }: { table: LiveTableView }) {
  const { t, money } = useI18n();
  const state = liveState(table);
  const { bill } = table;
  const review = (bill?.awaitingReview ?? 0) > 0;
  return (
    <div className={`live-tile live-${state}`}>
      <div className="live-head">
        <strong>{table.label}</strong>
        <span className="live-badge">{t.live[state]}</span>
      </div>
      {bill && (
        <>
          <div className="live-bar" aria-hidden="true">
            <span
              className="live-paid"
              style={{ width: `${Math.min(100, (bill.paidMinor / bill.totalMinor) * 100)}%` }}
            />
            <span
              className="live-held"
              style={{ width: `${Math.min(100, (bill.reservedMinor / bill.totalMinor) * 100)}%` }}
            />
          </div>
          <div className="live-amounts">
            <span>{t.liveOf(money(bill.paidMinor, bill.currency), money(bill.totalMinor, bill.currency))}</span>
            {bill.remainingMinor > 0 && (
              <span className="muted">{t.liveLeft(money(bill.remainingMinor, bill.currency))}</span>
            )}
          </div>
        </>
      )}
      {review && <div className="live-review">{t.live.review(bill!.awaitingReview)}</div>}
    </div>
  );
}

function DaySummary({ tenantId }: { tenantId: string }) {
  const { t, money, number, day } = useI18n();
  const [date, setDate] = useState("");
  const load = useCallback(() => api.summary(tenantId, date || undefined), [tenantId, date]);
  const summary = useLoad(load);
  const { reload } = summary;
  usePolling(reload, 15000);
  const data: DailySummaryView | null = summary.data;
  const primary = data?.totals[0];

  return (
    <section>
      <div className="section-head">
        <h2>{data ? day(data.date) : t.todayTitle}</h2>
        <label className="inline-field">
          {t.summaryDate}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <ErrorText error={summary.error} />
      {data && data.totals.length === 0 && <p className="muted">{t.noSales}</p>}
      {data?.totals.map((row) => (
        <div key={row.currency} className="kpis">
          <Kpi label={t.kpiSales} value={money(row.amountMinor, row.currency)} strong />
          <Kpi label={t.kpiTips} value={money(row.tipMinor, row.currency)} />
          <Kpi label={t.kpiPayments} value={number(row.payments)} />
          <Kpi label={t.kpiAverage} value={money(Math.round(row.amountMinor / row.payments), row.currency)} />
          <Kpi label={t.kpiFee} value={money(row.feeMinor, row.currency)} />
        </div>
      ))}
      {primary && data && (
        <>
          <h3>{t.byMethod}</h3>
          <ul className="method-list">
            {data.byMethod.map((row) => (
              <li key={`${row.method}-${row.chargeCurrency}`}>
                <span>{t.method[row.method]}</span>
                <span className="muted">× {row.payments}</span>
                <strong>{money(row.chargeAmountMinor, row.chargeCurrency)}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
      {data?.refunds.map((row) => (
        <p key={row.currency} className="muted small">
          {t.refundsLine(row.payments, money(row.amountMinor, row.currency))}
        </p>
      ))}
    </section>
  );
}

function Kpi({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? "kpi kpi-strong" : "kpi"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/** Offline payments a staff member has to confirm or turn down. */
export function AwaitingList({
  tenantId,
  payments,
  onChanged,
}: {
  tenantId: string;
  payments: AdminPaymentView[];
  onChanged: () => void;
}) {
  const { t, money, dateTime } = useI18n();
  const action = useAction();
  const dialogs = useDialogs();
  if (payments.length === 0 && !action.error) return null;

  const confirm = (id: string) =>
    void action.run(async () => {
      await api.confirmPayment(tenantId, id);
      onChanged();
    });

  async function reject(id: string) {
    const reason = await dialogs.prompt({
      title: t.rejectTitle,
      label: `${t.rejectReason} (${t.optional})`,
      confirmLabel: t.reject,
      danger: true,
    });
    if (reason === null) return;
    void action.run(async () => {
      await api.rejectPayment(tenantId, id, reason || undefined);
      onChanged();
    });
  }

  return (
    <section className="awaiting">
      <h2>
        {t.awaitingTitle} <span className="count">{payments.length}</span>
      </h2>
      <ErrorText error={action.error} />
      {payments.map((p) => (
        <div key={p.id} className="awaiting-row">
          <div>
            <strong className="awaiting-amount">{money(p.chargeAmountMinor, p.chargeCurrency)}</strong>
            <div>
              {t.method[p.method]} · {p.tableLabel} · {dateTime(p.createdAt)}
            </div>
            {p.proof && (
              <div className="muted small">
                {Object.entries(p.proof)
                  .map(([key, value]) => `${t.proof[key] ?? key}: ${value}`)
                  .join(" · ")}
              </div>
            )}
            {!p.proof && (
              <div className="muted small">{p.method.startsWith("cash") ? t.cashNote : t.noReferenceYet}</div>
            )}
          </div>
          <div className="row-actions">
            <button type="button" disabled={action.busy} onClick={() => confirm(p.id)}>
              {t.moneyReceived}
            </button>
            <button type="button" className="ghost danger" disabled={action.busy} onClick={() => void reject(p.id)}>
              {t.reject}
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
