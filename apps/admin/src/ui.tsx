import { LANGUAGE_NAMES, LANGUAGES, type InviteLinkView } from "@tabtap/shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { errorText, useI18n } from "./i18n";

export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Loads data for a section; `reload` refetches after a change. */
export function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    load()
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [load, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, reload };
}

/** Calls `tick` regularly while the page is visible. */
export function usePolling(tick: () => void, intervalMs: number) {
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) tick();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [tick, intervalMs]);
}

/** Runs a form action, showing its error inline. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run };
}

export function ErrorText({ error }: { error: unknown }) {
  const { t } = useI18n();
  return error ? (
    <div className="error" role="alert">
      {errorText(error, t)}
    </div>
  ) : null;
}

/** The TabTap mark: a receipt with a tick. Colors are fixed so it reads on any background. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" rx="12" fill="#123f36" />
      <path d="M14 10h20v28l-3.33-2.6L27.33 38 24 35.4 20.67 38l-3.34-2.6L14 38z" fill="#f5b301" />
      <path
        d="M19 23l3.6 3.6 6.4-7"
        fill="none"
        stroke="#123f36"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LanguagePicker() {
  const { language, setLanguage, t } = useI18n();
  return (
    <div className="languages" role="group" aria-label={t.languageLabel}>
      {LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          title={LANGUAGE_NAMES[code]}
          aria-pressed={code === language}
          className={code === language ? "language language-on" : "language"}
          onClick={() => setLanguage(code)}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/** A one-time link to pass on (WhatsApp, Telegram, …); it is shown only once. */
export function InviteLinkBox({ link }: { link: InviteLinkView }) {
  const { t, dateTime } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="invite-link">
      <div>
        <strong>{t.linkFor(link.email)}</strong> {t.linkValid(dateTime(link.expiresAt))}
      </div>
      <div className="invite-row">
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
          {copied ? t.copied : t.copy}
        </button>
      </div>
    </div>
  );
}

// Confirmation and short-text dialogs, in place of window.confirm/prompt.

interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface PromptOptions extends ConfirmOptions {
  label?: string;
  initial?: string;
  required?: boolean;
  maxLength?: number;
}

type Open = (PromptOptions & { input: boolean; resolve: (value: string | null) => void }) | null;

interface Dialogs {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** The text entered, or null if the dialog was dismissed. */
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const DialogContext = createContext<Dialogs | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open>(null);
  const dialogs = useMemo<Dialogs>(
    () => ({
      confirm: (options) =>
        new Promise((resolve) => setOpen({ ...options, input: false, resolve: (value) => resolve(value !== null) })),
      prompt: (options) => new Promise((resolve) => setOpen({ ...options, input: true, resolve })),
    }),
    [],
  );
  return (
    <DialogContext.Provider value={dialogs}>
      {children}
      {open && (
        <DialogView
          request={open}
          onDone={(value) => {
            open.resolve(value);
            setOpen(null);
          }}
        />
      )}
    </DialogContext.Provider>
  );
}

function DialogView({ request, onDone }: { request: NonNullable<Open>; onDone: (value: string | null) => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(request.initial ?? "");

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    onDone(value.trim());
  }

  return (
    <dialog ref={ref} className="dialog" onCancel={() => onDone(null)}>
      <form onSubmit={submit}>
        <h2>{request.title}</h2>
        {request.body && <p className="muted">{request.body}</p>}
        {request.input && (
          <label className="field">
            {request.label}
            <input
              autoFocus
              required={request.required}
              maxLength={request.maxLength ?? 200}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        )}
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={() => onDone(null)}>
            {t.cancel}
          </button>
          <button type="submit" className={request.danger ? "danger-solid" : undefined}>
            {request.confirmLabel ?? t.confirm}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function useDialogs(): Dialogs {
  const value = useContext(DialogContext);
  if (!value) throw new Error("useDialogs must be used inside DialogProvider");
  return value;
}
