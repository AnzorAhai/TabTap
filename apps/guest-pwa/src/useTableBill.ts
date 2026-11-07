import type { BillEvent, TableBillView } from "@tabtap/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

/**
 * Loads the table's bill and keeps it live: the server pushes "bill.updated" over SSE
 * whenever anyone at the table claims or pays something, and we refetch. Also
 * refetches when the tab regains focus, in case the stream was down meanwhile.
 */
export function useTableBill(qrToken: string) {
  const [view, setView] = useState<TableBillView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      setView(await api.tableBill(qrToken));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [qrToken]);

  useEffect(() => {
    let cancelled = false;
    api
      .tableBill(qrToken)
      .then((v) => !cancelled && setView(v))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [qrToken]);

  const billId = view?.bill.id;
  useEffect(() => {
    if (!billId) return;
    const source = new EventSource(api.eventsUrl(billId));
    source.onmessage = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as BillEvent;
      if (event.kind !== "bill.updated") return;
      // Several changes often arrive together (payment created, then settled).
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => void refresh(), 250);
    };
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      source.close();
      window.removeEventListener("focus", onFocus);
      window.clearTimeout(refreshTimer.current);
    };
  }, [billId, refresh]);

  return { view, setView, error, loading, refresh };
}
