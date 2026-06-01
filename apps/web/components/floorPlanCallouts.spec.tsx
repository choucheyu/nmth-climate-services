import { describe, expect, it } from "vitest";
import {
  buildLeaderLinePath,
  floorPlanCalloutStatusClassName,
  getCalloutCardSize,
  mergeFloorPlanDisplayStyle,
  normalizeFloorPlanDisplayStyle,
  ratioToPixel,
  resolveAnchorSide,
  resolveCalloutCardRatio,
  resolveFloorPlanPointStatus,
  type RatioPoint,
} from "./floorPlanCallouts";

describe("floorPlanCallouts", () => {
  it("falls back legacy empty displayStyle for 20 dense points", () => {
    const surface = { width: 960, height: 540 };
    const markers: RatioPoint[] = Array.from({ length: 20 }, (_, index) => ({
      xRatio: 0.08 + (index % 5) * 0.18,
      yRatio: 0.12 + Math.floor(index / 5) * 0.18,
    }));

    markers.forEach((markerRatio, index) => {
      const normalized = normalizeFloorPlanDisplayStyle(
        {},
        { totalPoints: markers.length, surfaceWidth: surface.width },
      );
      expect(normalized.density).toBe("micro");
      expect(normalized.card).toBeNull();

      const cardSize = getCalloutCardSize(normalized.density);
      const cardRatio = resolveCalloutCardRatio({
        markerRatio,
        storedCardRatio: normalized.card,
        cardSize,
        surface,
        pointIndex: index,
      });
      const card = ratioToPixel(cardRatio, surface);
      const marker = ratioToPixel(markerRatio, surface);
      const anchorSide = resolveAnchorSide(
        normalized.connection.anchorSide,
        marker,
        card,
      );
      const path = buildLeaderLinePath(marker, card, cardSize, anchorSide);

      expect(card.x - cardSize.width / 2).toBeGreaterThanOrEqual(6);
      expect(card.y - cardSize.height / 2).toBeGreaterThanOrEqual(6);
      expect(card.x + cardSize.width / 2).toBeLessThanOrEqual(
        surface.width - 6,
      );
      expect(card.y + cardSize.height / 2).toBeLessThanOrEqual(
        surface.height - 6,
      );
      expect(path).toMatch(/^M /);
    });
  });

  it("keeps future displayStyle fields while updating known callout fields", () => {
    const next = mergeFloorPlanDisplayStyle(
      {
        futureFlag: "keep",
        card: { xRatio: 0.2, yRatio: 0.3, note: "preserve" },
        connection: { anchorSide: "left", vendor: "preserve" },
      },
      {
        density: "compact",
        card: { xRatio: 0.7, yRatio: 0.8 },
        connection: { anchorSide: "right" },
      },
    );

    expect(next).toMatchObject({
      futureFlag: "keep",
      density: "compact",
      card: { xRatio: 0.7, yRatio: 0.8, note: "preserve" },
      connection: {
        anchorSide: "right",
        lineShape: "autoRoundedElbow",
        vendor: "preserve",
      },
    });
  });

  it("resolves normal floor plan point status", () => {
    expect(
      resolveFloorPlanPointStatus(
        {
          device: {
            lastSeenAt: "2026-05-15T06:44:00.000Z",
            measurements: [{ measuredAt: "2026-05-15T06:44:00.000Z" }],
            alerts: [],
          },
        },
        new Date("2026-05-15T06:45:00.000Z"),
      ),
    ).toBe("normal");
  });

  it("resolves threshold warning alerts as warning", () => {
    expect(
      resolveFloorPlanPointStatus(
        {
          device: {
            lastSeenAt: "2026-05-15T06:44:00.000Z",
            measurements: [{ measuredAt: "2026-05-15T06:44:00.000Z" }],
            alerts: [
              {
                id: "alert-1",
                type: "humidity_threshold",
                level: "warning",
                status: "active",
              },
            ],
          },
        },
        new Date("2026-05-15T06:45:00.000Z"),
      ),
    ).toBe("warning");
  });

  it("resolves critical alerts as critical", () => {
    expect(
      resolveFloorPlanPointStatus(
        {
          device: {
            lastSeenAt: "2026-05-15T06:44:00.000Z",
            latestMeasurement: { measuredAt: "2026-05-15T06:44:00.000Z" },
            currentAlerts: [
              {
                id: "alert-2",
                type: "temperature_threshold",
                level: "critical",
                status: "acknowledged",
              },
            ],
          },
        },
        new Date("2026-05-15T06:45:00.000Z"),
      ),
    ).toBe("critical");
  });

  it("resolves stale lastSeenAt or device_offline alerts as offline", () => {
    expect(
      resolveFloorPlanPointStatus(
        {
          device: {
            lastSeenAt: "2026-05-15T06:40:59.000Z",
            latestMeasurement: { measuredAt: "2026-05-15T06:40:59.000Z" },
            alerts: [],
          },
        },
        new Date("2026-05-15T06:45:00.000Z"),
      ),
    ).toBe("offline");

    expect(
      resolveFloorPlanPointStatus(
        {
          device: {
            measurements: [{ measuredAt: "2026-05-15T06:44:00.000Z" }],
            alerts: [
              {
                id: "alert-3",
                type: "device_offline",
                level: "warning",
                status: "acknowledged",
              },
            ],
          },
        },
        new Date("2026-05-15T06:45:00.000Z"),
      ),
    ).toBe("offline");
  });

  it("resolves missing device or missing data as noData", () => {
    expect(resolveFloorPlanPointStatus({}, new Date("2026-05-15T06:45:00.000Z"))).toBe(
      "noData",
    );
    expect(
      resolveFloorPlanPointStatus(
        {
          device: {
            lastSeenAt: "2026-05-15T06:44:00.000Z",
            alerts: [],
          },
        },
        new Date("2026-05-15T06:45:00.000Z"),
      ),
    ).toBe("noData");
    expect(
      resolveFloorPlanPointStatus(
        { device: { alerts: [] } },
        new Date("2026-05-15T06:45:00.000Z"),
      ),
    ).toBe("noData");
  });

  it("prioritizes offline over critical and warning alerts", () => {
    expect(
      resolveFloorPlanPointStatus(
        {
          device: {
            lastSeenAt: "2026-05-15T06:40:00.000Z",
            latestMeasurement: { measuredAt: "2026-05-15T06:40:00.000Z" },
            alerts: [
              {
                id: "alert-4",
                type: "humidity_threshold",
                level: "critical",
                status: "active",
              },
            ],
          },
        },
        new Date("2026-05-15T06:45:00.000Z"),
      ),
    ).toBe("offline");
  });

  it("ignores resolved alerts and maps status class names", () => {
    expect(
      resolveFloorPlanPointStatus(
        {
          device: {
            lastSeenAt: "2026-05-15T06:44:00.000Z",
            latestMeasurement: { measuredAt: "2026-05-15T06:44:00.000Z" },
            alerts: [
              {
                id: "alert-5",
                type: "humidity_threshold",
                level: "warning",
                status: "resolved",
              },
            ],
          },
        },
        new Date("2026-05-15T06:45:00.000Z"),
      ),
    ).toBe("normal");

    expect(floorPlanCalloutStatusClassName("warning")).toContain(
      "nmth-floor-plan-callout-status--warning",
    );
    expect(floorPlanCalloutStatusClassName("critical")).toContain(
      "nmth-floor-plan-callout-status--critical",
    );
    expect(floorPlanCalloutStatusClassName("offline")).toContain(
      "nmth-floor-plan-callout-status--offline",
    );
    expect(floorPlanCalloutStatusClassName("noData")).toContain(
      "nmth-floor-plan-callout-status--no-data",
    );
  });
});
