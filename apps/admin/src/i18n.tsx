import { formatMoney, LANGUAGE_LOCALES, pickLanguage, type Language } from "@tabtap/shared";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError } from "./api";
import { en, es, ru, type Strings } from "./strings";

export const STRINGS: Record<Language, Strings> = { es, en, ru };
const STORAGE_KEY = "tabtap.language";

function savedLanguage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

interface I18n {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Strings;
  money: (amountMinor: number, currency: string) => string;
  dateTime: (iso: string) => string;
  /** A calendar day given as YYYY-MM-DD. */
  day: (date: string) => string;
  number: (value: number | string, maxFractionDigits?: number) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => pickLanguage(savedLanguage(), navigator.languages ?? []));

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = STRINGS[language].appTitle;
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // not remembered next time
    }
  }, [language]);

  const value = useMemo<I18n>(() => {
    const locale = LANGUAGE_LOCALES[language];
    return {
      language,
      setLanguage,
      t: STRINGS[language],
      money: (amountMinor, currency) => formatMoney(amountMinor, currency, locale),
      dateTime: (iso) => new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }),
      day: (date) => new Date(`${date}T12:00:00`).toLocaleDateString(locale, { dateStyle: "long" }),
      number: (value, maxFractionDigits = 2) =>
        Number(value).toLocaleString(locale, { maximumFractionDigits: maxFractionDigits }),
    };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}

type ErrorKey = keyof Strings["errors"];

/** The API answers in English; these are the messages staff actually run into. */
const KNOWN_ERRORS: [RegExp, ErrorKey][] = [
  [/^Invalid email or password/, "invalidLogin"],
  [/expired or was already used/, "linkExpired"],
  [/no longer valid/, "linkInvalid"],
  [/at least one owner/, "needOwner"],
  [/already uses that POS table id/, "posIdTaken"],
  [/at least one payment method enabled/, "keepOneMethod"],
  [/already set a password/, "alreadySetPassword"],
  [/already works at this restaurant/, "alreadyWorksHere"],
  [/Only completed payments can be refunded/, "onlyCompletedRefund"],
  [/couldn't make the refund/, "refundFailed"],
  [/BCV rate/, "bcvUnavailable"],
  [/No account with this email/, "noAccount"],
  [/^(pago_movil|zelle|binance_pay): /, "methodDetails"],
];

export function errorText(error: unknown, t: Strings): string {
  if (!(error instanceof ApiError)) return t.errors.generic;
  if (error.status === 0) return t.errors.offline;
  const known = KNOWN_ERRORS.find(([pattern]) => pattern.test(error.message));
  if (known) return t.errors[known[1]];
  if (error.status === 403) return t.errors.forbidden;
  if (error.status === 404) return t.errors.notFound;
  if (error.status === 409) return t.errors.conflict;
  if (error.status === 429) return t.errors.rateLimited;
  // Validation messages say which field is wrong, which beats a generic text in any language.
  return error.status === 400 ? error.message : t.errors.generic;
}
