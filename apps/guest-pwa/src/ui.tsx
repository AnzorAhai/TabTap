import { LANGUAGE_NAMES, LANGUAGES } from "@tabtap/shared";
import { useState, type ReactNode } from "react";
import { useI18n } from "./i18n";

type IconProps = { size?: number };

function Svg({ size = 22, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </Svg>
);
export const IconChevron = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5l7 7-7 7" />
  </Svg>
);
export const IconBack = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);
export const IconCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </Svg>
);
export const IconBill = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
    <path d="M9.5 8h5M9.5 12h5" />
  </Svg>
);
export const IconDish = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.5" />
  </Svg>
);
export const IconPeople = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 20a6 6 0 0 1 12 0" />
    <path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.5a6 6 0 0 1 3 5.5" />
  </Svg>
);
export const IconOffline = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 3l18 18" />
    <path d="M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5-2.7M14 10.2a10 10 0 0 1 5 2.7M2 8.8a15 15 0 0 1 4.2-2.6M10.5 5.1A15 15 0 0 1 22 8.8" />
    <circle cx="12" cy="20" r="0.6" />
  </Svg>
);
export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5v.01" />
  </Svg>
);
export const IconHandCash = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="7" width="18" height="11" rx="2" />
    <circle cx="12" cy="12.5" r="2.5" />
    <path d="M6.5 10.5v.01M17.5 14.5v.01" />
  </Svg>
);
export const IconWhatsapp = ({ size = 22 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.6-1.2.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.9 1-1.1 2.3-.2 4 1.8 3 3.6 3.9 5.6 4.7 1 .3 2.4.2 3-.8.2-.5.3-1.2.2-1.3-.1-.2-.2-.2-.7-.5z" />
  </svg>
);

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

export function TopBar() {
  return (
    <header className="topbar">
      <span className="brand">
        <Logo size={28} />
        <span>TabTap</span>
      </span>
      <LanguagePicker />
    </header>
  );
}

export function BackButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" className="back" onClick={onClick}>
      <IconBack size={20} />
      {t.back}
    </button>
  );
}

export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
}) {
  const { t } = useI18n();
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={t.decrease}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button
        type="button"
        aria-label={t.increase}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </div>
  );
}

export function CopyButton({ value }: { value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  }
  return (
    <button type="button" className="copy" onClick={copy} aria-label={`${t.copy}: ${value}`}>
      {copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
      <span>{copied ? t.copied : t.copy}</span>
    </button>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

/** A full-page message: nothing to pay here, no connection, not found. */
export function MessageScreen({
  icon,
  title,
  hint,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="app">
      <TopBar />
      <main className="message">
        <div className="message-icon">{icon}</div>
        <h1>{title}</h1>
        {hint && <p className="muted">{hint}</p>}
        {children}
      </main>
    </div>
  );
}
