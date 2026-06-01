"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type AutoRefreshControlOptions = {
  storageKey: string;
  defaultEnabled?: boolean;
};

type AutoRefreshTriggerOptions = {
  autoRefreshEnabled: boolean;
  enabled?: boolean;
  intervalMs: number;
  isVisible: boolean;
  onRefresh: () => void | Promise<unknown>;
};

function documentIsVisible() {
  if (typeof document === "undefined") {
    return true;
  }
  return document.visibilityState !== "hidden";
}

export function useAutoRefreshControl({
  storageKey,
  defaultEnabled = true,
}: AutoRefreshControlOptions) {
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(defaultEnabled);
  const [isVisible, setIsVisible] = useState(documentIsVisible);

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === "on") {
      setAutoRefreshEnabled(true);
    } else if (stored === "off") {
      setAutoRefreshEnabled(false);
    }
  }, [storageKey]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, autoRefreshEnabled ? "on" : "off");
  }, [autoRefreshEnabled, storageKey]);

  useEffect(() => {
    const updateVisibility = () => setIsVisible(documentIsVisible());
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    window.addEventListener("focus", updateVisibility);
    window.addEventListener("blur", updateVisibility);
    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
      window.removeEventListener("focus", updateVisibility);
      window.removeEventListener("blur", updateVisibility);
    };
  }, []);

  const queryOptions = useCallback(
    (intervalMs: number, queryEnabled = true) => {
      const refetchInterval: number | false =
        autoRefreshEnabled && isVisible && queryEnabled ? intervalMs : false;
      return {
        refetchInterval,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: autoRefreshEnabled ? ("always" as const) : false,
      };
    },
    [autoRefreshEnabled, isVisible],
  );

  const isTimestampStale = useCallback(
    (timestamp: number | null | undefined, staleAfterMs: number) =>
      Boolean(timestamp && Date.now() - timestamp > staleAfterMs),
    [],
  );

  return useMemo(
    () => ({
      autoRefreshEnabled,
      isVisible,
      isTimestampStale,
      queryOptions,
      setAutoRefreshEnabled,
    }),
    [
      autoRefreshEnabled,
      isTimestampStale,
      isVisible,
      queryOptions,
      setAutoRefreshEnabled,
    ],
  );
}

export function useAutoRefreshTrigger({
  autoRefreshEnabled,
  enabled = true,
  intervalMs,
  isVisible,
  onRefresh,
}: AutoRefreshTriggerOptions) {
  const refreshRef = useRef(onRefresh);
  const active = autoRefreshEnabled && enabled && isVisible;

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void refreshRef.current();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (autoRefreshEnabled && enabled && documentIsVisible()) {
        void refreshRef.current();
      }
    };
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [autoRefreshEnabled, enabled]);
}

export function newestTimestamp(values: Array<number | null | undefined>) {
  const timestamps = values.filter((value): value is number => Boolean(value));
  return timestamps.length ? Math.max(...timestamps) : null;
}
