"use client";

import { Grid } from "antd";

export type ResponsiveMode = "phone" | "tabletPortrait" | "tabletLandscape" | "desktop";

export function useResponsiveMode() {
  const screens = Grid.useBreakpoint();
  const isPhone = !screens.md;
  const isMobile = isPhone;
  const isTabletPortrait = Boolean(screens.md && !screens.lg);
  const isTabletLandscape = Boolean(screens.lg && !screens.xl);
  const isTablet = isTabletPortrait || isTabletLandscape;
  const isDesktop = Boolean(screens.xl);
  const mode: ResponsiveMode = isPhone
    ? "phone"
    : isTabletPortrait
      ? "tabletPortrait"
      : isTabletLandscape
        ? "tabletLandscape"
        : "desktop";

  return {
    screens,
    mode,
    isPhone,
    isMobile,
    isTablet,
    isTabletPortrait,
    isTabletLandscape,
    isDesktop
  };
}
