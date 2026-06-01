import { getRequestConfig } from "next-intl/server";
import type { AbstractIntlMessages } from "next-intl";
import zhTW from "@nmth/shared/messages/zh-TW";
import en from "@nmth/shared/messages/en";
import ja from "@nmth/shared/messages/ja";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@nmth/shared";

const messages: Record<Locale, AbstractIntlMessages> = {
  "zh-TW": zhTW as AbstractIntlMessages,
  en: en as AbstractIntlMessages,
  ja: ja as AbstractIntlMessages
};

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = await requestLocale;
  const resolvedLocale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return {
    locale: resolvedLocale,
    messages: messages[resolvedLocale]
  };
});
