import {
  clampRatio,
  type PixelPoint,
  type RatioPoint,
  type SurfaceSize,
} from "./floorPlanCallouts";

const DEFAULT_FLOOR_PLAN_ASPECT_RATIO = 16 / 9;
const MOBILE_LABEL_MIN_SURFACE_WIDTH = 560;
const MOBILE_LABEL_MAX_POINT_COUNT = 14;

export const MOBILE_MARKER_POPOVER_SIZE = {
  width: 156,
  height: 76,
} as const;

export function resolveFloorPlanAspectRatio(input: {
  pageWidth?: number | null;
  pageHeight?: number | null;
}) {
  const pageWidth = input.pageWidth ?? 0;
  const pageHeight = input.pageHeight ?? 0;
  if (
    Number.isFinite(pageWidth) &&
    Number.isFinite(pageHeight) &&
    pageWidth > 0 &&
    pageHeight > 0
  ) {
    return pageWidth / pageHeight;
  }
  return DEFAULT_FLOOR_PLAN_ASPECT_RATIO;
}

export function resolveMobileFloorPlanSurfaceSize(input: {
  containerWidth: number;
  containerHeight: number;
  pageWidth?: number | null;
  pageHeight?: number | null;
}): SurfaceSize {
  const containerWidth = Math.max(1, Math.floor(input.containerWidth));
  const containerHeight = Math.max(1, Math.floor(input.containerHeight));
  const aspectRatio = resolveFloorPlanAspectRatio(input);
  const widthFirstHeight = Math.round(containerWidth / aspectRatio);

  if (widthFirstHeight <= containerHeight) {
    return {
      width: containerWidth,
      height: Math.max(1, widthFirstHeight),
    };
  }

  return {
    width: Math.max(1, Math.round(containerHeight * aspectRatio)),
    height: containerHeight,
  };
}

export function resolveMobileMarkerPosition(
  ratio: RatioPoint,
  renderedFloorPlanSurface: SurfaceSize,
): PixelPoint {
  return {
    x: clampRatio(ratio.xRatio) * renderedFloorPlanSurface.width,
    y: clampRatio(ratio.yRatio) * renderedFloorPlanSurface.height,
  };
}

export function shouldShowMobileMarkerLabels(input: {
  pointCount: number;
  surfaceWidth: number;
}) {
  return (
    input.pointCount > 0 &&
    input.pointCount <= MOBILE_LABEL_MAX_POINT_COUNT &&
    input.surfaceWidth >= MOBILE_LABEL_MIN_SURFACE_WIDTH
  );
}

export function shortenMobileMarkerLabel(label: string, maxLength = 12) {
  const trimmed = label.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(1, maxLength - 3))}...`;
}

export function clampMobilePopoverPosition(input: {
  marker: PixelPoint;
  surface: SurfaceSize;
  popoverSize?: SurfaceSize;
  gap?: number;
}): PixelPoint {
  const popoverSize = input.popoverSize ?? MOBILE_MARKER_POPOVER_SIZE;
  const gap = input.gap ?? 12;
  const edgePadding = 8;
  let x = input.marker.x + gap;
  let y = input.marker.y - popoverSize.height - gap;

  if (x + popoverSize.width + edgePadding > input.surface.width) {
    x = input.marker.x - popoverSize.width - gap;
  }

  if (y < edgePadding) {
    y = input.marker.y + gap;
  }

  return {
    x: clampValue(
      x,
      edgePadding,
      input.surface.width - popoverSize.width - edgePadding,
    ),
    y: clampValue(
      y,
      edgePadding,
      input.surface.height - popoverSize.height - edgePadding,
    ),
  };
}

function clampValue(value: number, min: number, max: number) {
  if (max < min) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
