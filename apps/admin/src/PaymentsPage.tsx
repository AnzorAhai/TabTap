import {
  csvLine,
  minorToDecimal,
  PaymentMethod,
  PaymentStatus,
  type AdminPaymentView,
  type PaymentsQuery,
  type StaffRole,
} from "@tabtap/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { useI18n } from "./i18n";
import { AwaitingList } from "./TodayPage";
import { ErrorText, useAction, useDialogs, usePolling } from "./ui";

const PAGE_SIZE = 50;
const EXPORT_LIMIT = 5000;
/** Tells Excel the file is UTF-8. */
const BOM = String.fromCharCode(0xfeff);

/** A date and time spreadsheets can sort, in the viewer's time zone: 2026-11-08 17:52. */
const sortableTime = (iso: string) => new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });

export function PaymentsPage({ tenantId, role }: { tenantId: string; role: StaffRole }) {
  const { t, money, dateTime, language } = useI18n();
  const managing = role === "owner" || role === "manager";
  const action = useAction();
  const dialogs = useDialogs();

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<PaymentStatus | "">("");
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [rows, setRows] = useState<AdminPaymentView[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const filter = useMemo<PaymentsQuery>(
    () => ({ from: from || undefined, to: to || undefined, status: status || undefined, method: method || undefined }),
    [from, to, status, method],
  );

  const reload = useCallback(() => {
    api.payments(tenantId, { ...filter, limit }).then(
      (list) => {
        setRows(list);
        setError(null);
      },
      (e: unknown) => setError(e),
    );
  }, [tenantId, filter, limit]);
  useEffect(reload, [reload]);
  usePolling(reload, 10000);

  function changeFilter<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      setLimit(PAGE_SIZE);
    };
  }

  async function refund(p: AdminPaymentView) {
    const amount = money(p.chargeAmountMinor, p.chargeCurrency);
    const reason = await dialogs.prompt({
      title: t.refundTitle,
      body: p.method === "card" ? t.refundCard(amount) : t.refundOffline(amount),
      label: `${t.refundReason} (${t.optional})`,
      confirmLabel: t.refundAction,
      danger: true,
    });
    if (reason === null) return;
    void action.run(async () => {
      await api.refundPayment(tenantId, p.id, reason || undefined);
      reload();
    });
  }

  function exportCsv() {
    void action.run(async () => {
      const list = await api.payments(tenantId, { ...filter, limit: EXPORT_LIMIT });
      // Excel in Spanish and Russian expects semicolons and decimal commas.
      const separator = language === "en" ? "," : ";";
      const localized = (text: string) => (language === "en" ? text : text.replace(".", ","));
      const decimal = (minor: number, currency: string) => localized(minorToDecimal(minor, currency));
      const { csv } = t;
      const header = [
        csv.created,
        csv.settled,
        csv.table,
        csv.what,
        csv.method,
        csv.status,
        csv.amount,
        csv.tip,
        csv.fee,
        csv.currency,
        csv.charged,
        csv.chargeCurrency,
        csv.rate,
        csv.surcharge,
        csv.reference,
        csv.payer,
      ];
      const lines = list.map((p) =>
        csvLine(
          [
            sortableTime(p.createdAt),
            p.settledAt && sortableTime(p.settledAt),
            p.tableLabel,
            t.mode[p.mode],
            t.method[p.method],
            t.paymentStatus[p.status],
            decimal(p.amountMinor, p.currency),
            decimal(p.tipMinor, p.currency),
            decimal(p.platformFeeMinor, p.currency),
            p.currency,
            decimal(p.chargeAmountMinor, p.chargeCurrency),
            p.chargeCurrency,
            p.exchangeRate && localized(p.exchangeRate),
            decimal(p.surchargeMinor, p.chargeCurrency),
            p.proof?.reference ?? null,
            p.proof?.payerName ?? p.proof?.payerPhone ?? null,
          ],
          separator,
        ),
      );
      const url = URL.createObjectURL(
        new Blob([`${BOM}${[csvLine(header, separator), ...lines].join("\r\n")}\r\n`], {
          type: "text/csv;charset=utf-8",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `tabtap-${from || "all"}${to ? `-${to}` : ""}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  const awaiting = (rows ?? []).filter((p) => p.awaitingReview);
  const canLoadMore = rows !== null && rows.length === limit;

  return (
    <>
      <div className="page-head">
        <h1>{t.paymentsTitle}</h1>
        {managing && (
          <button type="button" className="ghost" disabled={action.busy || !rows?.length} onClick={exportCsv}>
            {t.exportCsv}
          </button>
        )}
      </div>
      <ErrorText error={error ?? action.error} />
      <AwaitingList tenantId={tenantId} payments={awaiting} onChanged={reload} />

      <section>
        <div className="filters">
          <label className="field">
            {t.filterFrom}
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => changeFilter(setFrom)(e.target.value)}
            />
          </label>
          <label className="field">
            {t.filterTo}
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => changeFilter(setTo)(e.target.value)}
            />
          </label>
          <label className="field">
            {t.filterStatus}
            <select value={status} onChange={(e) => changeFilter(setStatus)(e.target.value as PaymentStatus | "")}>
              <option value="">{t.all}</option>
              {Object.values(PaymentStatus).map((value) => (
                <option key={value} value={value}>
                  {t.paymentStatus[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t.filterMethod}
            <select value={method} onChange={(e) => changeFilter(setMethod)(e.target.value as PaymentMethod | "")}>
              <option value="">{t.allFem}</option>
              {Object.values(PaymentMethod).map((value) => (
                <option key={value} value={value}>
                  {t.method[value]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.colTime}</th>
                <th>{t.colTable}</th>
                <th>{t.colWhat}</th>
                <th>{t.colMethod}</th>
                <th className="num">{t.colAmount}</th>
                <th className="num">{t.colTip}</th>
                <th className="num">{t.colFee}</th>
                <th className="num">{t.colCharged}</th>
                <th>{t.colStatus}</th>
                {managing && <th />}
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((p) => (
                <tr key={p.id}>
                  <td className="nowrap">{dateTime(p.createdAt)}</td>
                  <td className="nowrap">{p.tableLabel}</td>
                  <td>{t.mode[p.mode]}</td>
                  <td>{t.method[p.method]}</td>
                  <td className="num">{money(p.amountMinor, p.currency)}</td>
                  <td className="num">{p.tipMinor > 0 ? money(p.tipMinor, p.currency) : "—"}</td>
                  <td className="num">{money(p.platformFeeMinor, p.currency)}</td>
                  <td className="num">
                    {money(p.chargeAmountMinor, p.chargeCurrency)}
                    {p.surchargeMinor > 0 && (
                      <div className="muted small">{t.inclSurcharge(money(p.surchargeMinor, p.chargeCurrency))}</div>
                    )}
                  </td>
                  <td>
                    <span className={`pill pill-${p.status}`}>{t.paymentStatus[p.status]}</span>
                    {p.refundReason && <div className="muted small">{t.refundedNote(p.refundReason)}</div>}
                  </td>
                  {managing && (
                    <td>
                      {p.status === "succeeded" && (
                        <button
                          type="button"
                          className="link danger"
                          disabled={action.busy}
                          onClick={() => void refund(p)}
                        >
                          {t.refund}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {rows?.length === 0 && (
                <tr>
                  <td colSpan={managing ? 10 : 9}>{t.noPayments}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {canLoadMore && (
          <button type="button" className="ghost load-more" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
            {t.loadMore}
          </button>
        )}
      </section>
    </>
  );
}
