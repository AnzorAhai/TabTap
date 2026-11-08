import { useEffect, useMemo, useState } from "react";
import { ApiError } from "./api";
import { BillFlow } from "./BillFlow";
import { errorText, useI18n } from "./i18n";
import { useInstallPrompt } from "./pwa";
import { IconAlert, IconOffline, Logo, MessageScreen, Spinner } from "./ui";
import { useTableBill } from "./useTableBill";

export default function App() {
  const qrToken = useMemo(() => new URLSearchParams(window.location.search).get("table"), []);
  return qrToken ? <TableScreen qrToken={qrToken} /> : <Landing />;
}

function Landing() {
  const { t } = useI18n();
  const install = useInstallPrompt();
  return (
    <MessageScreen icon={<Logo size={72} />} title={t.landingTitle} hint={t.landingHint}>
      {install && (
        <button type="button" className="secondary" onClick={install}>
          {t.install}
        </button>
      )}
    </MessageScreen>
  );
}

function TableScreen({ qrToken }: { qrToken: string }) {
  const { view, setView, error, loading, refresh } = useTableBill(qrToken);
  if (loading) return <Loading />;
  if (!view) return <LoadProblem error={error} onRetry={refresh} />;
  return <BillFlow key={view.bill.id} view={view} setView={setView} loadError={error} refresh={refresh} />;
}

function Loading() {
  const { t } = useI18n();
  // The API can take a while to wake up, and networks here are often slow.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 4000);
    return () => window.clearTimeout(timer);
  }, []);
  return <MessageScreen icon={<Spinner />} title={t.loadingBill} hint={slow ? t.loadingSlow : undefined} />;
}

function LoadProblem({ error, onRetry }: { error: unknown; onRetry: () => Promise<void> }) {
  const { t } = useI18n();
  const status = error instanceof ApiError ? error.status : -1;
  // The waiter may be about to open the bill: it appears without the guest doing anything.
  useEffect(() => {
    if (status !== 404) return;
    const timer = window.setInterval(() => void onRetry(), 4000);
    return () => window.clearInterval(timer);
  }, [status, onRetry]);
  const retry = (
    <button type="button" className="primary" onClick={() => void onRetry()}>
      {t.retry}
    </button>
  );
  if (status === 0) {
    return (
      <MessageScreen icon={<IconOffline size={40} />} title={t.offlineTitle} hint={t.offlineHint}>
        {retry}
      </MessageScreen>
    );
  }
  if (status === 404) {
    return (
      <MessageScreen icon={<IconAlert size={40} />} title={t.missingTitle} hint={t.missingHint}>
        {retry}
      </MessageScreen>
    );
  }
  return (
    <MessageScreen icon={<IconAlert size={40} />} title={t.problemTitle} hint={errorText(error, t)}>
      {retry}
    </MessageScreen>
  );
}
