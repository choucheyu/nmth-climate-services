"use client";

import { App as AntApp, Button, Drawer, Dropdown, Layout, Menu, Space, Tag, Typography } from "antd";
import type { MenuProps } from "antd";
import {
  Activity,
  Bell,
  Building2,
  ChevronDown,
  FileChartColumn,
  Gauge,
  Languages,
  LogOut,
  Menu as MenuIcon,
  Settings,
  Thermometer,
  UserCircle
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { Permission } from "@nmth/shared";
import { localeLabels, LOCALES, type Locale } from "@nmth/shared";
import { ApiError, apiFetch } from "../lib/api";
import { APP_NAV_PERMISSION_RULES, roleLabel, usePermissions } from "../lib/permissions";
import { useResponsiveMode } from "../lib/responsive";

const { Sider, Content } = Layout;

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const { message } = AntApp.useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { isMobile, isTabletPortrait, isTabletLandscape } = useResponsiveMode();
  const permissions = usePermissions();
  const session = permissions.session;
  const navRule = (key: string): Permission[] => APP_NAV_PERMISSION_RULES.find((item) => item.key === key)?.any ?? [];

  const nav: Array<{ key: string; icon: ReactNode; label: string; any: Permission[] }> = [
    { key: `/${locale}/dashboard`, icon: <Gauge size={18} />, label: t("nav.dashboard"), any: navRule("dashboard") },
    { key: `/${locale}/devices`, icon: <Thermometer size={18} />, label: t("nav.devices"), any: navRule("devices") },
    { key: `/${locale}/exhibitions`, icon: <Building2 size={18} />, label: t("nav.exhibitions"), any: navRule("exhibitions") },
    { key: `/${locale}/alerts`, icon: <Bell size={18} />, label: t("nav.alerts"), any: navRule("alerts") },
    { key: `/${locale}/reports`, icon: <FileChartColumn size={18} />, label: t("nav.reports"), any: navRule("reports") },
    { key: `/${locale}/settings`, icon: <Settings size={18} />, label: t("nav.settings"), any: navRule("settings") }
  ];
  const visibleNav = nav.filter((item) => permissions.hasAnyPermission(item.any));
  const selectedNavKey = visibleNav.find((item) => pathname.startsWith(item.key))?.key ?? visibleNav[0]?.key ?? `/${locale}/dashboard`;
  const usesDrawerNav = isMobile || isTabletPortrait;
  const isTouchHeader = usesDrawerNav || isTabletLandscape;
  const touchIconButtonStyle = isTouchHeader ? { minHeight: 44, minWidth: 44 } : undefined;
  const touchButtonStyle = isTouchHeader ? { minHeight: 44 } : undefined;
  const siderCollapsed = collapsed;
  const accountMenuItems = [
    session.data
      ? {
          key: "session",
          disabled: true,
          label: (
            <Space direction="vertical" size={0} style={{ maxWidth: 220 }}>
              <Typography.Text strong ellipsis>
                {session.data.name || session.data.email}
              </Typography.Text>
              {session.data.roles?.[0] ? <Typography.Text type="secondary">{roleLabel(t, session.data.roles[0])}</Typography.Text> : null}
            </Space>
          )
        }
      : null,
    session.data ? { type: "divider" as const } : null,
    ...LOCALES.map((item) => ({
      key: `locale:${item}`,
      icon: <Languages size={16} />,
      label: localeLabels[item]
    })),
    { type: "divider" as const },
    {
      key: "logout",
      icon: <LogOut size={16} />,
      label: t("nav.logout")
    }
  ].filter(Boolean) as MenuProps["items"];

  function switchLocale(nextLocale: Locale) {
    const segments = pathname.split("/");
    segments[1] = nextLocale;
    router.push(segments.join("/"));
  }

  async function logout() {
    await apiFetch("/auth/logout", { method: "POST", body: "{}" }).catch(() => undefined);
    router.push(`/${locale}/login`);
  }

  function handleAccountMenuClick({ key }: { key: string }) {
    if (key.startsWith("locale:")) {
      switchLocale(key.replace("locale:", "") as Locale);
      return;
    }
    if (key === "logout") {
      void logout();
    }
  }

  useEffect(() => {
    if (session.error instanceof ApiError && session.error.status === 401) {
      router.replace(`/${locale}/login`);
    }
  }, [locale, router, session.error]);

  useEffect(() => {
    function onForbidden() {
      message.error(t("authz.forbiddenToast"));
    }
    window.addEventListener("nmth:api-forbidden", onForbidden);
    return () => window.removeEventListener("nmth:api-forbidden", onForbidden);
  }, [message, t]);

  return (
    <Layout className="nmth-shell">
      <header className="nmth-header">
        {usesDrawerNav ? (
          <Button
            aria-label={t("nav.menu")}
            icon={<MenuIcon size={18} />}
            onClick={() => setMobileNavOpen(true)}
            size="large"
            style={touchIconButtonStyle}
            type="text"
          />
        ) : null}
        <div className="nmth-brand" style={{ minWidth: 0 }}>
          <div className="nmth-brand-mark">N</div>
          <div style={{ minWidth: 0 }}>
            <div
              className="nmth-brand-title"
              style={usesDrawerNav ? { maxWidth: isMobile ? 180 : 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } : undefined}
            >
              {t("app.brand")}
            </div>
            <div
              className="nmth-brand-subtitle"
              style={usesDrawerNav ? { maxWidth: isMobile ? 180 : 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } : undefined}
            >
              {t("app.title")}
            </div>
          </div>
        </div>
        {usesDrawerNav ? (
          <Dropdown menu={{ items: accountMenuItems, onClick: handleAccountMenuClick }} trigger={["click"]}>
            <Button aria-label={t("app.account")} icon={<UserCircle size={18} />} size="large" style={touchIconButtonStyle} type="text" />
          </Dropdown>
        ) : (
          <Space>
            {session.data ? (
              <Space>
                <Typography.Text>{session.data.name || session.data.email}</Typography.Text>
                {session.data.roles?.[0] ? <Tag>{roleLabel(t, session.data.roles[0])}</Tag> : null}
              </Space>
            ) : null}
            <Dropdown
              menu={{
                items: LOCALES.map((item) => ({ key: item, label: localeLabels[item] })),
                onClick: ({ key }) => switchLocale(key as Locale)
              }}
            >
              <Button icon={<Languages size={16} />} size={isTouchHeader ? "large" : undefined} style={touchButtonStyle}>
                <Space size={4}>
                  {localeLabels[locale]}
                  <ChevronDown size={14} />
                </Space>
              </Button>
            </Dropdown>
            <Button icon={<LogOut size={16} />} onClick={logout} size={isTouchHeader ? "large" : undefined} style={touchButtonStyle}>
              {t("nav.logout")}
            </Button>
          </Space>
        )}
      </header>
      {usesDrawerNav ? (
        <Drawer
          placement="left"
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          title={t("app.title")}
          width={isMobile ? "min(320px, 86vw)" : 340}
          styles={{ body: { padding: 0 } }}
        >
          <Menu
            mode="inline"
            selectedKeys={[selectedNavKey]}
            items={visibleNav}
            onClick={({ key }) => {
              setMobileNavOpen(false);
              router.push(String(key));
            }}
            style={{ borderInlineEnd: 0 }}
          />
          <div style={{ padding: 18, color: "var(--nmth-muted)", fontSize: 12 }}>
            <Activity size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
            {t("app.version")} 0.1.0
          </div>
        </Drawer>
      ) : null}
      <Layout>
        {!usesDrawerNav ? (
          <Sider
            width={248}
            breakpoint="lg"
            collapsible
            collapsed={siderCollapsed}
            onCollapse={setCollapsed}
            collapsedWidth={80}
            style={{ borderRight: "1px solid var(--nmth-border)" }}
          >
            <div style={{ padding: 18 }}>
              <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 700 }}>
                MONITORING
              </Typography.Text>
            </div>
            <Menu
              mode="inline"
              selectedKeys={[selectedNavKey]}
              items={visibleNav}
              onClick={({ key }) => router.push(String(key))}
              style={{ borderInlineEnd: 0 }}
            />
            <div style={{ padding: 18, color: "var(--nmth-muted)", fontSize: 12 }}>
              <Activity size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
              {t("app.version")} 0.1.0
            </div>
          </Sider>
        ) : null}
        <Content
          className="nmth-main"
          style={{ minWidth: 0, width: usesDrawerNav ? "100%" : undefined, maxWidth: usesDrawerNav ? "100%" : undefined, overflowX: isMobile ? "hidden" : undefined }}
        >
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
