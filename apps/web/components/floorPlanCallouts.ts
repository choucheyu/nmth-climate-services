export type FloorPlanCalloutDensity = "compact" | "micro" | "full";
export type FloorPlanCalloutAnchorSide =
  | "auto"
  | "top"
  | "right"
  | "bottom"
  | "left";
export type FloorPlanCalloutLineShape = "autoRoundedElbow";
export type FloorPlanCardAnchorSide = Exclude<
  FloorPlanCalloutAnchorSide,
  "auto"
>;
export type FloorPlanPointStatus =
  | "normal"
  | "warning"
  | "critical"
  | "offline"
  | "noData";

export interface RatioPoint {
  xRatio: number;
  yRatio: number;
}

export interface PixelPoint {
  x: number;
  y: number;
}

export interface SurfaceSize {
  width: number;
  height: number;
}

export interface FloorPlanCalloutCardSize {
  width: number;
  height: number;
}

export interface NormalizedFloorPlanDisplayStyle {
  raw: Record<string, unknown>;
  density: FloorPlanCalloutDensity;
  card: RatioPoint | null;
  connection: {
    anchorSide: FloorPlanCalloutAnchorSide;
    lineShape: FloorPlanCalloutLineShape;
  };
  hasExplicitDensity: boolean;
  hasStoredCard: boolean;
}

export interface FloorPlanStatusAlert {
  id?: string;
  type?: string;
  level?: string;
  status?: string;
  triggeredAt?: string | Date;
  message?: string;
  metadata?: unknown;
}

export interface FloorPlanStatusDevice {
  lastSeenAt?: string | Date | null;
  latestMeasurement?: unknown | null;
  measurements?: unknown[] | null;
  alerts?: FloorPlanStatusAlert[] | null;
  currentAlerts?: FloorPlanStatusAlert[] | null;
}

export interface FloorPlanStatusPoint {
  device?: FloorPlanStatusDevice | null;
}

export const FLOOR_PLAN_CALLOUT_DENSITIES = [
  "compact",
  "micro",
  "full",
] as const satisfies readonly FloorPlanCalloutDensity[];

export const FLOOR_PLAN_CALLOUT_ANCHOR_SIDES = [
  "auto",
  "top",
  "right",
  "bottom",
  "left",
] as const satisfies readonly FloorPlanCalloutAnchorSide[];

export const FLOOR_PLAN_CARD_ANCHOR_SIDES = [
  "top",
  "right",
  "bottom",
  "left",
] as const satisfies readonly FloorPlanCardAnchorSide[];

const CARD_SIZES: Record<FloorPlanCalloutDensity, FloorPlanCalloutCardSize> = {
  compact: { width: 104, height: 48 },
  micro: { width: 86, height: 36 },
  full: { width: 132, height: 64 },
};

const CARD_BOUNDARY_GAP = 6;
const OFFLINE_AFTER_MS = 3 * 60_000;
const CURRENT_ALERT_STATUSES = new Set(["active", "acknowledged"]);
const THRESHOLD_ALERT_TYPES = new Set([
  "humidity_threshold",
  "temperature_threshold",
]);

export function normalizeFloorPlanDisplayStyle(
  displayStyle: unknown,
  context: { totalPoints?: number; surfaceWidth?: number } = {},
): NormalizedFloorPlanDisplayStyle {
  const raw = isRecord(displayStyle) ? { ...displayStyle } : {};
  const connection = isRecord(raw.connection) ? raw.connection : {};
  const density = isCalloutDensity(raw.density)
    ? raw.density
    : inferCalloutDensity(context);
  const card = readRatioPoint(raw.card);
  const anchorSide = isCalloutAnchorSide(connection.anchorSide)
    ? connection.anchorSide
    : "auto";

  return {
    raw,
    density,
    card,
    connection: {
      anchorSide,
      lineShape: "autoRoundedElbow",
    },
    hasExplicitDensity: isCalloutDensity(raw.density),
    hasStoredCard: Boolean(card),
  };
}

export function mergeFloorPlanDisplayStyle(
  displayStyle: unknown,
  patch: {
    density?: FloorPlanCalloutDensity;
    card?: RatioPoint | null;
    connection?: Partial<{
      anchorSide: FloorPlanCalloutAnchorSide;
      lineShape: FloorPlanCalloutLineShape;
    }>;
  },
) {
  const next: Record<string, unknown> = isRecord(displayStyle)
    ? { ...displayStyle }
    : {};

  if (patch.density !== undefined) {
    next.density = patch.density;
  }

  if (patch.card !== undefined) {
    if (patch.card === null) {
      delete next.card;
    } else {
      const existingCard = isRecord(next.card) ? next.card : {};
      next.card = {
        ...existingCard,
        xRatio: clampRatio(patch.card.xRatio),
        yRatio: clampRatio(patch.card.yRatio),
      };
    }
  }

  if (patch.connection) {
    const existingConnection = isRecord(next.connection)
      ? { ...next.connection }
      : {};
    const anchorSide = patch.connection.anchorSide;
    next.connection = {
      ...existingConnection,
      ...(isCalloutAnchorSide(anchorSide) ? { anchorSide } : {}),
      lineShape: "autoRoundedElbow",
    };
  }

  return next;
}

export function getCalloutCardSize(density: FloorPlanCalloutDensity) {
  return CARD_SIZES[density];
}

export function resolveCalloutCardRatio(input: {
  markerRatio: RatioPoint;
  storedCardRatio: RatioPoint | null;
  cardSize: FloorPlanCalloutCardSize;
  surface: SurfaceSize;
  pointIndex: number;
}) {
  if (input.storedCardRatio) {
    return fitCardRatioToSurface(
      input.storedCardRatio,
      input.cardSize,
      input.surface,
    );
  }

  return resolveFallbackCardRatio(
    input.markerRatio,
    input.cardSize,
    input.surface,
    input.pointIndex,
  );
}

export function fitCardRatioToSurface(
  ratio: RatioPoint,
  cardSize: FloorPlanCalloutCardSize,
  surface: SurfaceSize,
) {
  const xRatio = clampRatio(ratio.xRatio);
  const yRatio = clampRatio(ratio.yRatio);
  if (!isUsableSurface(surface)) {
    return { xRatio, yRatio };
  }

  const x = fitValue(
    xRatio * surface.width,
    cardSize.width / 2 + CARD_BOUNDARY_GAP,
    surface.width - cardSize.width / 2 - CARD_BOUNDARY_GAP,
  );
  const y = fitValue(
    yRatio * surface.height,
    cardSize.height / 2 + CARD_BOUNDARY_GAP,
    surface.height - cardSize.height / 2 - CARD_BOUNDARY_GAP,
  );

  return {
    xRatio: x / surface.width,
    yRatio: y / surface.height,
  };
}

export function ratioToPixel(ratio: RatioPoint, surface: SurfaceSize) {
  return {
    x: ratio.xRatio * surface.width,
    y: ratio.yRatio * surface.height,
  };
}

export function resolveFloorPlanPointStatus(
  point: FloorPlanStatusPoint,
  now: Date | number = new Date(),
): FloorPlanPointStatus {
  const device = point.device;
  if (!device) return "noData";

  const currentAlerts = floorPlanCurrentAlerts(device);
  const hasOfflineAlert = currentAlerts.some(
    (alert) => alert.type === "device_offline",
  );
  const nowMs = now instanceof Date ? now.getTime() : now;
  const lastSeenMs = dateLikeToTime(device.lastSeenAt);
  if (
    hasOfflineAlert ||
    (lastSeenMs !== null && Number.isFinite(nowMs) && nowMs - lastSeenMs > OFFLINE_AFTER_MS)
  ) {
    return "offline";
  }

  if (currentAlerts.some((alert) => alert.level === "critical")) {
    return "critical";
  }

  if (
    currentAlerts.some(
      (alert) =>
        alert.level === "warning" ||
        THRESHOLD_ALERT_TYPES.has(alert.type ?? ""),
    )
  ) {
    return "warning";
  }

  if (!hasLatestFloorPlanMeasurement(device)) {
    return "noData";
  }

  return "normal";
}

export function floorPlanCalloutStatusClassName(
  status: FloorPlanPointStatus,
) {
  return `nmth-floor-plan-callout-status--${
    status === "noData" ? "no-data" : status
  }`;
}

export function resolveAnchorSide(
  requestedSide: FloorPlanCalloutAnchorSide,
  marker: PixelPoint,
  card: PixelPoint,
): FloorPlanCardAnchorSide {
  if (requestedSide !== "auto") {
    return requestedSide;
  }

  const dx = marker.x - card.x;
  const dy = marker.y - card.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx < 0 ? "left" : "right";
  }
  return dy < 0 ? "top" : "bottom";
}

export function getCardAnchorPoint(
  card: PixelPoint,
  cardSize: FloorPlanCalloutCardSize,
  anchorSide: FloorPlanCardAnchorSide,
) {
  switch (anchorSide) {
    case "top":
      return { x: card.x, y: card.y - cardSize.height / 2 };
    case "right":
      return { x: card.x + cardSize.width / 2, y: card.y };
    case "bottom":
      return { x: card.x, y: card.y + cardSize.height / 2 };
    case "left":
      return { x: card.x - cardSize.width / 2, y: card.y };
  }
}

export function buildLeaderLinePath(
  marker: PixelPoint,
  card: PixelPoint,
  cardSize: FloorPlanCalloutCardSize,
  anchorSide: FloorPlanCardAnchorSide,
) {
  const end = getCardAnchorPoint(card, cardSize, anchorSide);
  const dx = end.x - marker.x;
  const dy = end.y - marker.y;
  const distance = Math.hypot(dx, dy);
  const directEnough = distance < 72 || Math.abs(dx) < 10 || Math.abs(dy) < 10;

  if (directEnough) {
    return `M ${round(marker.x)} ${round(marker.y)} L ${round(end.x)} ${round(
      end.y,
    )}`;
  }

  const elbow = Math.max(18, Math.min(48, distance * 0.24));
  const points =
    anchorSide === "left" || anchorSide === "right"
      ? horizontalCardEntryPolyline(marker, end, anchorSide, elbow)
      : verticalCardEntryPolyline(marker, end, anchorSide, elbow);

  return roundedPolylinePath(points, 7);
}

export function inferCalloutDensity(context: {
  totalPoints?: number;
  surfaceWidth?: number;
}): FloorPlanCalloutDensity {
  if ((context.surfaceWidth ?? 0) > 0 && (context.surfaceWidth ?? 0) < 560) {
    return "micro";
  }
  if ((context.totalPoints ?? 0) >= 20) {
    return "micro";
  }
  return "compact";
}

export function clampRatio(value: number) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function resolveFallbackCardRatio(
  markerRatio: RatioPoint,
  cardSize: FloorPlanCalloutCardSize,
  surface: SurfaceSize,
  pointIndex: number,
) {
  if (!isUsableSurface(surface)) {
    const horizontalDirection = markerRatio.xRatio > 0.78 ? -1 : 1;
    const verticalDirection = markerRatio.yRatio < 0.18 ? 1 : -1;
    return {
      xRatio: clampRatio(markerRatio.xRatio + horizontalDirection * 0.11),
      yRatio: clampRatio(markerRatio.yRatio + verticalDirection * 0.07),
    };
  }

  const marker = ratioToPixel(markerRatio, surface);
  const jitter = ((pointIndex % 5) - 2) * 8;
  const horizontalOffset = cardSize.width / 2 + 26;
  const verticalOffset = cardSize.height / 2 + 18;
  const candidates = [
    { x: marker.x + horizontalOffset, y: marker.y - verticalOffset + jitter },
    { x: marker.x - horizontalOffset, y: marker.y - verticalOffset - jitter },
    { x: marker.x + horizontalOffset, y: marker.y + verticalOffset - jitter },
    { x: marker.x - horizontalOffset, y: marker.y + verticalOffset + jitter },
    { x: marker.x, y: marker.y - cardSize.height - 22 },
    { x: marker.x, y: marker.y + cardSize.height + 22 },
  ];

  const firstVisible = candidates.find((candidate) =>
    isCardInsideSurface(candidate, cardSize, surface),
  );
  const chosen = firstVisible ?? candidates[0]!;

  return fitCardRatioToSurface(
    {
      xRatio: chosen.x / surface.width,
      yRatio: chosen.y / surface.height,
    },
    cardSize,
    surface,
  );
}

function horizontalCardEntryPolyline(
  marker: PixelPoint,
  end: PixelPoint,
  side: "left" | "right",
  elbow: number,
) {
  const outward = side === "left" ? -1 : 1;
  const preferredBendX = end.x + outward * elbow;
  const bendX =
    outward < 0
      ? Math.min((marker.x + end.x) / 2, preferredBendX)
      : Math.max((marker.x + end.x) / 2, preferredBendX);

  return [marker, { x: bendX, y: marker.y }, { x: bendX, y: end.y }, end];
}

function verticalCardEntryPolyline(
  marker: PixelPoint,
  end: PixelPoint,
  side: "top" | "bottom",
  elbow: number,
) {
  const outward = side === "top" ? -1 : 1;
  const preferredBendY = end.y + outward * elbow;
  const bendY =
    outward < 0
      ? Math.min((marker.y + end.y) / 2, preferredBendY)
      : Math.max((marker.y + end.y) / 2, preferredBendY);

  return [marker, { x: marker.x, y: bendY }, { x: end.x, y: bendY }, end];
}

function roundedPolylinePath(points: PixelPoint[], radius: number) {
  if (points.length < 2) {
    return "";
  }

  let path = `M ${round(points[0]!.x)} ${round(points[0]!.y)}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const corner = points[index]!;
    const next = points[index + 1]!;
    const before = pointToward(corner, previous, radius);
    const after = pointToward(corner, next, radius);
    path += ` L ${round(before.x)} ${round(before.y)} Q ${round(
      corner.x,
    )} ${round(corner.y)} ${round(after.x)} ${round(after.y)}`;
  }
  const last = points[points.length - 1]!;
  path += ` L ${round(last.x)} ${round(last.y)}`;
  return path;
}

function pointToward(from: PixelPoint, to: PixelPoint, distance: number) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!length) return from;
  const safeDistance = Math.min(distance, length / 2);
  return {
    x: from.x + (dx / length) * safeDistance,
    y: from.y + (dy / length) * safeDistance,
  };
}

function isCardInsideSurface(
  center: PixelPoint,
  cardSize: FloorPlanCalloutCardSize,
  surface: SurfaceSize,
) {
  return (
    center.x - cardSize.width / 2 >= CARD_BOUNDARY_GAP &&
    center.y - cardSize.height / 2 >= CARD_BOUNDARY_GAP &&
    center.x + cardSize.width / 2 <= surface.width - CARD_BOUNDARY_GAP &&
    center.y + cardSize.height / 2 <= surface.height - CARD_BOUNDARY_GAP
  );
}

function isUsableSurface(surface: SurfaceSize) {
  return surface.width > 0 && surface.height > 0;
}

function fitValue(value: number, min: number, max: number) {
  if (max < min) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

function floorPlanCurrentAlerts(device: FloorPlanStatusDevice) {
  return [...(device.currentAlerts ?? []), ...(device.alerts ?? [])].filter(
    (alert) => CURRENT_ALERT_STATUSES.has(alert.status ?? ""),
  );
}

function hasLatestFloorPlanMeasurement(device: FloorPlanStatusDevice) {
  return Boolean(
    device.latestMeasurement ??
      (Array.isArray(device.measurements) ? device.measurements[0] : null),
  );
}

function dateLikeToTime(value: string | Date | null | undefined) {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function readRatioPoint(value: unknown): RatioPoint | null {
  if (!isRecord(value)) return null;
  const xRatio = Number(value.xRatio);
  const yRatio = Number(value.yRatio);
  if (!Number.isFinite(xRatio) || !Number.isFinite(yRatio)) {
    return null;
  }
  return {
    xRatio: clampRatio(xRatio),
    yRatio: clampRatio(yRatio),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCalloutDensity(value: unknown): value is FloorPlanCalloutDensity {
  return FLOOR_PLAN_CALLOUT_DENSITIES.includes(
    value as FloorPlanCalloutDensity,
  );
}

function isCalloutAnchorSide(
  value: unknown,
): value is FloorPlanCalloutAnchorSide {
  return FLOOR_PLAN_CALLOUT_ANCHOR_SIDES.includes(
    value as FloorPlanCalloutAnchorSide,
  );
}

function round(value: number) {
  return Number(value.toFixed(2));
}
