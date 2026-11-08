import { formatMoney, LANGUAGE_LOCALES, pickLanguage, type Language } from "@tabtap/shared";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError } from "./api";
import { en, es, ru, type Strings } from "./strings";

const STRINGS: Record<Language, Strings> = { es, en, ru };
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
  time: (iso: string) => string;
  dateTime: (iso: string) => string;
  /** A plain number in the current language, e.g. a rate or a percentage. */
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
      time: (iso) => new Date(iso).toLocaleTimeString(locale, { timeStyle: "short" }),
      dateTime: (iso) => new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }),
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

/** What to tell a guest about a failed request; the API's own messages are for developers. */
export function errorText(error: unknown, t: Strings): string {
  if (!(error instanceof ApiError)) return t.errorGeneric;
  if (error.status === 0) return t.errorOffline;
  if (error.status === 400) return t.errorInvalid;
  if (error.status === 409) return t.errorConflict;
  if (error.status === 429) return t.errorRateLimited;
  if (error.status === 502) return t.errorProvider;
  return t.errorGeneric;
}
