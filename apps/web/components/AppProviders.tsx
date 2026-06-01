"use client";

import "@ant-design/v5-patch-for-react-19";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, ConfigProvider, theme } from "antd";
import type { ReactNode } from "react";
import { useState } from "react";
import { DESIGN_TOKENS, type Locale } from "@nmth/shared";
import enUS from "antd/locale/en_US";
import jaJP from "antd/locale/ja_JP";
import zhTW from "antd/locale/zh_TW";

const localeMap = {
  "zh-TW": zhTW,
  en: enUS,
  ja: jaJP
};

export function AppProviders({ children, locale }: { children: ReactNode; locale: Locale }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <ConfigProvider
      locale={localeMap[locale]}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: DESIGN_TOKENS.colors.primary,
          colorInfo: DESIGN_TOKENS.colors.attention,
          colorError: DESIGN_TOKENS.colors.danger,
          colorWarning: DESIGN_TOKENS.colors.warning,
          colorSuccess: DESIGN_TOKENS.colors.success,
          borderRadius: DESIGN_TOKENS.radius.lg,
          fontFamily: "'Lato', 'Noto Sans TC', 'Noto Sans JP', sans-serif"
        },
        components: {
          Button: {
            borderRadius: 999,
            controlHeight: 38
          },
          Card: {
            borderRadiusLG: DESIGN_TOKENS.radius.lg
          },
          Layout: {
            siderBg: "#ffffff",
            headerBg: "#ffffff"
          },
          Table: {
            headerBg: "#F4F9FD",
            rowHoverBg: "#EAF3FB"
          }
        }
      }}
    >
      <AntApp>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}
