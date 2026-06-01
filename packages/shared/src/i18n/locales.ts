export const LOCALES = ["zh-TW", "en", "ja"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "zh-TW";

export const localeLabels: Record<Locale, string> = {
  "zh-TW": "繁體中文",
  en: "English",
  ja: "日本語"
};

export function isLocale(value: string | undefined): value is Locale {
  return LOCALES.includes(value as Locale);
}
