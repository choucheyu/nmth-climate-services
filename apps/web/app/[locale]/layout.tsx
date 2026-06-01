import { NextIntlClientProvider } from "next-intl";
import type { AbstractIntlMessages } from "next-intl";
import { notFound } from "next/navigation";
import { ReactNode } from "react";
import zhTW from "@nmth/shared/messages/zh-TW";
import en from "@nmth/shared/messages/en";
import ja from "@nmth/shared/messages/ja";
import { isLocale, type Locale } from "@nmth/shared";
import { AppProviders } from "../../components/AppProviders";

const messages: Record<Locale, AbstractIntlMessages> = {
  "zh-TW": zhTW as AbstractIntlMessages,
  en: en as AbstractIntlMessages,
  ja: ja as AbstractIntlMessages
};

type LocaleLayoutProps = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;

  if (!isLocale(locale)) {
    notFound();
  }

  return (
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      <AppProviders locale={locale}>{children}</AppProviders>
    </NextIntlClientProvider>
  );
}
