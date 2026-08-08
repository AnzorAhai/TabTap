import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { AdminPaymentView, AdminTableView, PaymentStatus } from "@tabtap/shared";
import { listPayments, listTables } from "./api";

function formatMoney(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

const STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: "В обработке",
  succeeded: "Оплачено",
  failed: "Ошибка",
  refunded: "Возврат",
};

function QrImage({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { margin: 1, width: 160 })
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl);
      })
      .catch(() => setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!src) return <div className="qr-placeholder" />;
  return <img src={src} alt="QR-код стола" width={120} height={120} />;
}

export default function App() {
  const [tables, setTables] = useState<AdminTableView[]>([]);
  const [payments, setPayments] = useState<AdminPaymentView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([listTables(), listPayments()])
      .then(([t, p]) => {
        setTables(t);
        setPayments(p);
      })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <main className="screen">Загружаем данные…</main>;
  if (error) return <main className="screen">Ошибка: {error}</main>;

  return (
    <main className="screen">
      <h1>TabTap — панель ресторана</h1>

      <section>
        <h2>Столы и QR-коды</h2>
        <div className="tables-grid">
          {tables.map((table) => (
            <div key={table.id} className="table-card">
              <QrImage value={table.guestUrl} />
              <div className="table-label">{table.label}</div>
              <a href={table.guestUrl} target="_blank" rel="noreferrer">
                {table.guestUrl}
              </a>
              <span className={table.isActive ? "status-active" : "status-inactive"}>
                {table.isActive ? "Активен" : "Отключён"}
              </span>
            </div>
          ))}
          {tables.length === 0 && <p>Столов пока нет.</p>}
        </div>
      </section>

      <section>
        <h2>Платежи</h2>
        <table className="payments-table">
          <thead>
            <tr>
              <th>Время</th>
              <th>Стол</th>
              <th>Гость</th>
              <th>Сумма</th>
              <th>Чаевые</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.id}>
                <td>{formatTime(payment.createdAt)}</td>
                <td>{payment.tableLabel}</td>
                <td>{payment.participantLabel ?? "—"}</td>
                <td>{formatMoney(payment.amountMinor, payment.currency)}</td>
                <td>{payment.tipMinor > 0 ? formatMoney(payment.tipMinor, payment.currency) : "—"}</td>
                <td>
                  <span className={`payment-status status-${payment.status}`}>
                    {STATUS_LABEL[payment.status]}
                  </span>
                </td>
              </tr>
            ))}
            {payments.length === 0 && (
              <tr>
                <td colSpan={6}>Платежей пока нет.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
