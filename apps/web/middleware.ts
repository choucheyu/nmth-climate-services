import createMiddleware from "next-intl/middleware";
import { DEFAULT_LOCALE, LOCALES } from "@nmth/shared";

export default createMiddleware({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE
});

export const config = {
  matcher: ["/(zh-TW|en|ja)/:path*"]
};
