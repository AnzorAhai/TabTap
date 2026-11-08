// Interface languages of the guest app and the admin panel.

export const LANGUAGES = ["es", "en", "ru"] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<Language, string> = { es: "Español", en: "English", ru: "Русский" };

/** Locale for numbers, money and dates in each language. */
export const LANGUAGE_LOCALES: Record<Language, string> = { es: "es-VE", en: "en-US", ru: "ru-RU" };

/** The saved choice if there is one, else the browser's first supported language, else Spanish. */
export function pickLanguage(saved: string | null, browserLanguages: readonly string[]): Language {
  const isLanguage = (code: string | null | undefined): code is Language =>
    (LANGUAGES as readonly (string | null | undefined)[]).includes(code);
  if (isLanguage(saved)) return saved;
  return browserLanguages.map((tag) => tag.slice(0, 2).toLowerCase()).find(isLanguage) ?? "es";
}
