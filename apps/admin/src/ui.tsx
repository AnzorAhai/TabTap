import { formatMoney as formatMinor, type InviteLinkView, type StaffRole } from "@tabtap/shared";
import { useCallback, useEffect, useState } from "react";

export const LOCALE = "ru-RU";

export const ROLE_LABEL: Record<StaffRole, string> = {
  owner: "Владелец",
  manager: "Менеджер",
  waiter: "Официант",
};

export function formatMoney(minor: number, currency: string): string {
  return formatMinor(minor, currency, LOCALE);
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(LOCALE, { dateStyle: "short", timeStyle: "short" });
}

export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Loads data for a section; `reload` refetches after a change. */
export function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    load()
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch((e: unknown) => !cancelled && setError(messageOf(e)));
    return () => {
      cancelled = true;
    };
  }, [load, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, reload };
}

/** Runs a form action, showing its error inline. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run };
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? <div className="error">{error}</div> : null;
}

/** A one-time link to pass on (WhatsApp, Telegram, …); it is shown only once. */
export function InviteLinkBox({ link }: { link: InviteLinkView }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="invite-link">
      <div>
        Ссылка для <strong>{link.email}</strong> — отправьте её сами. Действует до {formatTime(link.expiresAt)},
        сработает один раз.
      </div>
      <div className="row">
        <input readOnly value={link.url} onFocus={(e) => e.target.select()} />
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard.writeText(link.url).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? "Скопировано" : "Копировать"}
        </button>
      </div>
    </div>
  );
}
