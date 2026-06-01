"use client";

import {
  App,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import { useQuery } from "@tanstack/react-query";
import { MapPinned, Maximize2, Pencil, RadioTower, X } from "lucide-react";
import { formatClimateValue } from "@nmth/shared";
import { useTranslations } from "next-intl";
import {
  forwardRef,
  Fragment,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ClimateTrendChart } from "./ClimateTrendChart";
import {
  FLOOR_PLAN_CALLOUT_ANCHOR_SIDES,
  FLOOR_PLAN_CALLOUT_DENSITIES,
  FLOOR_PLAN_CARD_ANCHOR_SIDES,
  buildLeaderLinePath,
  clampRatio,
  fitCardRatioToSurface,
  floorPlanCalloutStatusClassName,
  getCalloutCardSize,
  mergeFloorPlanDisplayStyle,
  normalizeFloorPlanDisplayStyle,
  ratioToPixel,
  resolveAnchorSide,
  resolveCalloutCardRatio,
  resolveFloorPlanPointStatus,
  type FloorPlanCalloutAnchorSide,
  type FloorPlanCalloutDensity,
  type FloorPlanPointStatus,
  type FloorPlanStatusAlert,
  type FloorPlanCardAnchorSide,
  type RatioPoint,
  type SurfaceSize,
} from "./floorPlanCallouts";
import {
  MOBILE_MARKER_POPOVER_SIZE,
  clampMobilePopoverPosition,
  resolveMobileFloorPlanSurfaceSize,
  resolveMobileMarkerPosition,
} from "./floorPlanMobileViewerModel";
import { shouldUseRenderedFloorPlanImage } from "./floorPlanBackground";
import { apiFetch, formatRelativeDelay } from "../lib/api";
import { useResponsiveMode } from "../lib/responsive";

interface LatestMeasurement {
  measuredAt: string;
  temperatureC: number;
  humidityPercent: number;
  dehumidifySetpoint?: number | null;
  source: string;
}

interface DeviceWithLatest {
  id: string;
  deviceName: string;
  displayName: string;
  lastSeenAt?: string | null;
  latestMeasurement?: LatestMeasurement | null;
  measurements?: LatestMeasurement[];
  alerts?: FloorPlanStatusAlert[];
  currentAlerts?: FloorPlanStatusAlert[];
}

interface FloorPlanPoint {
  id: string;
  name: string;
  xRatio: number;
  yRatio: number;
  displayStyle?: unknown;
  device?: DeviceWithLatest | null;
}

type PdfRenderState = "idle" | "loading" | "ready" | "failed";

interface PdfFloorPlanCanvasProps {
  pdfUrl?: string | null;
  label: string;
  floorPlanWidthBucket: number;
  floorPlanMaxHeight?: number | null;
  pageNumber: number;
  pageWidth?: number | null;
  pageHeight?: number | null;
  renderScale: 1 | 2;
  onRenderStateChange: (state: PdfRenderState) => void;
  onDisplaySizeChange: (size: { width: number; height: number }) => void;
}

const PdfFloorPlanCanvas = memo(
  forwardRef<HTMLCanvasElement, PdfFloorPlanCanvasProps>(
    function PdfFloorPlanCanvas(
      {
        pdfUrl,
        label,
        floorPlanWidthBucket,
        floorPlanMaxHeight,
        pageNumber,
        pageWidth,
        pageHeight,
        renderScale,
        onRenderStateChange,
        onDisplaySizeChange,
      },
      ref,
    ) {
      const canvasRef = useRef<HTMLCanvasElement>(null);

      useImperativeHandle(
        ref,
        () => canvasRef.current as HTMLCanvasElement,
        [],
      );

      useEffect(() => {
        if (!pdfUrl) {
          onRenderStateChange("idle");
          onDisplaySizeChange({ width: 0, height: 0 });
          return;
        }
        const activePdfUrl = pdfUrl;
        const canvas = canvasRef.current;
        if (!canvas || !floorPlanWidthBucket) {
          onRenderStateChange("loading");
          return;
        }

        let cancelled = false;
        let loadingTask: { destroy: () => Promise<void> } | null = null;
        let renderTask: {
          cancel: () => void;
          promise: Promise<unknown>;
        } | null = null;
        let pdfDocument: { destroy: () => Promise<void> } | null = null;
        const targetCanvas = canvas;
        onRenderStateChange("loading");

        async function renderPdf() {
          try {
            const pdfjs = await import("pdfjs-dist");
            pdfjs.GlobalWorkerOptions.workerSrc = new URL(
              "pdfjs-dist/build/pdf.worker.mjs",
              import.meta.url,
            ).toString();
            const task = pdfjs.getDocument({
              url: activePdfUrl,
              withCredentials: true,
            });
            loadingTask = task;
            const pdf = await task.promise;
            pdfDocument = pdf;
            const page = await pdf.getPage(Math.min(pageNumber, pdf.numPages));
            const viewport = page.getViewport({ scale: 1 });
            const viewBoxWidth =
              pageWidth && pageHeight ? pageWidth : viewport.width;
            const viewBoxHeight =
              pageWidth && pageHeight ? pageHeight : viewport.height;
            let displayWidth = Math.max(1, Math.round(floorPlanWidthBucket));
            let displayHeight = Math.max(
              1,
              Math.round(displayWidth * (viewBoxHeight / viewBoxWidth)),
            );
            const maxDisplayHeight =
              floorPlanMaxHeight && Number.isFinite(floorPlanMaxHeight)
                ? Math.max(1, Math.floor(floorPlanMaxHeight))
                : null;
            if (maxDisplayHeight && displayHeight > maxDisplayHeight) {
              displayHeight = maxDisplayHeight;
              displayWidth = Math.max(
                1,
                Math.round(displayHeight * (viewBoxWidth / viewBoxHeight)),
              );
            }
            const intrinsicWidth = Math.max(
              1,
              Math.round(displayWidth * renderScale),
            );
            const intrinsicHeight = Math.max(
              1,
              Math.round(displayHeight * renderScale),
            );
            const bufferCanvas = document.createElement("canvas");
            bufferCanvas.width = intrinsicWidth;
            bufferCanvas.height = intrinsicHeight;
            const bufferContext = bufferCanvas.getContext("2d");
            if (!bufferContext) {
              throw new Error("Canvas 2D context unavailable");
            }

            renderTask = page.render({
              canvasContext: bufferContext,
              viewport,
              transform: [
                intrinsicWidth / viewport.width,
                0,
                0,
                intrinsicHeight / viewport.height,
                0,
                0,
              ],
            });
            await renderTask.promise;
            renderTask = null;
            await pdf.destroy();
            pdfDocument = null;
            if (!cancelled) {
              targetCanvas.width = intrinsicWidth;
              targetCanvas.height = intrinsicHeight;
              targetCanvas.style.width = `${displayWidth}px`;
              targetCanvas.style.height = `${displayHeight}px`;
              const visibleContext = targetCanvas.getContext("2d");
              if (!visibleContext) {
                throw new Error("Canvas 2D context unavailable");
              }
              visibleContext.clearRect(0, 0, intrinsicWidth, intrinsicHeight);
              visibleContext.drawImage(bufferCanvas, 0, 0);
              onDisplaySizeChange({
                width: displayWidth,
                height: displayHeight,
              });
              onRenderStateChange("ready");
            }
          } catch {
            if (!cancelled) {
              onRenderStateChange("failed");
            }
          }
        }

        void renderPdf();
        return () => {
          cancelled = true;
          renderTask?.cancel();
          void loadingTask?.destroy();
          void pdfDocument?.destroy();
        };
      }, [
        floorPlanMaxHeight,
        floorPlanWidthBucket,
        onDisplaySizeChange,
        onRenderStateChange,
        pageHeight,
        pageNumber,
        pageWidth,
        pdfUrl,
        renderScale,
      ]);

      return pdfUrl ? <canvas ref={canvasRef} aria-label={label} /> : null;
    },
  ),
);

interface RenderedFloorPlanImageProps {
  imageUrl?: string | null;
  label: string;
  floorPlanWidthBucket: number;
  floorPlanMaxHeight?: number | null;
  pageWidth?: number | null;
  pageHeight?: number | null;
  onRenderStateChange: (state: PdfRenderState) => void;
  onDisplaySizeChange: (size: { width: number; height: number }) => void;
}

const RenderedFloorPlanImage = memo(
  forwardRef<HTMLImageElement, RenderedFloorPlanImageProps>(
    function RenderedFloorPlanImage(
      {
        imageUrl,
        label,
        floorPlanWidthBucket,
        floorPlanMaxHeight,
        pageWidth,
        pageHeight,
        onRenderStateChange,
        onDisplaySizeChange,
      },
      ref,
    ) {
      const imageRef = useRef<HTMLImageElement>(null);

      useImperativeHandle(
        ref,
        () => imageRef.current as HTMLImageElement,
        [],
      );

      const updateDisplaySize = useCallback(() => {
        const image = imageRef.current;
        if (!imageUrl) {
          onRenderStateChange("idle");
          onDisplaySizeChange({ width: 0, height: 0 });
          return;
        }
        if (
          !image ||
          !image.complete ||
          !image.naturalWidth ||
          !floorPlanWidthBucket
        ) {
          onRenderStateChange("loading");
          return;
        }
        const viewBoxWidth = pageWidth && pageHeight ? pageWidth : image.naturalWidth;
        const viewBoxHeight = pageWidth && pageHeight ? pageHeight : image.naturalHeight;
        let displayWidth = Math.max(1, Math.round(floorPlanWidthBucket));
        let displayHeight = Math.max(
          1,
          Math.round(displayWidth * (viewBoxHeight / viewBoxWidth)),
        );
        const maxDisplayHeight =
          floorPlanMaxHeight && Number.isFinite(floorPlanMaxHeight)
            ? Math.max(1, Math.floor(floorPlanMaxHeight))
            : null;
        if (maxDisplayHeight && displayHeight > maxDisplayHeight) {
          displayHeight = maxDisplayHeight;
          displayWidth = Math.max(
            1,
            Math.round(displayHeight * (viewBoxWidth / viewBoxHeight)),
          );
        }
        image.style.width = `${displayWidth}px`;
        image.style.height = `${displayHeight}px`;
        onDisplaySizeChange({ width: displayWidth, height: displayHeight });
        onRenderStateChange("ready");
      }, [
        floorPlanMaxHeight,
        floorPlanWidthBucket,
        imageUrl,
        onDisplaySizeChange,
        onRenderStateChange,
        pageHeight,
        pageWidth,
      ]);

      useEffect(() => {
        updateDisplaySize();
      }, [updateDisplaySize]);

      if (!imageUrl) return null;
      return (
        <img
          ref={imageRef}
          alt={label}
          className="nmth-floor-plan-rendered-image"
          src={imageUrl}
          onLoad={updateDisplaySize}
          onError={() => {
            onDisplaySizeChange({ width: 0, height: 0 });
            onRenderStateChange("failed");
          }}
          style={{ display: "block", maxWidth: "100%", userSelect: "none" }}
        />
      );
    },
  ),
);

const PDF_RENDER_WIDTH_BUCKET = 24;
const FLOOR_PLAN_RESIZE_DEBOUNCE_MS = 120;
const MOBILE_MARKER_DOT_SIZE = 6.5;
const MOBILE_MARKER_DOT_SIZE_ACTIVE = 8;
const MOBILE_MARKER_TOUCH_TARGET_SIZE = MOBILE_MARKER_DOT_SIZE;

interface MobileViewerOrientationSession {
  fullscreenStarted: boolean;
  orientationLocked: boolean;
}

type ScreenOrientationWithLock = ScreenOrientation & {
  lock?: (orientation: "landscape") => Promise<void>;
  unlock?: () => void;
};

function measureElementContentBox(element: HTMLElement): SurfaceSize {
  const rect = element.getBoundingClientRect();
  const styles = window.getComputedStyle(element);
  const horizontalPadding =
    Number.parseFloat(styles.paddingLeft || "0") +
    Number.parseFloat(styles.paddingRight || "0");
  const verticalPadding =
    Number.parseFloat(styles.paddingTop || "0") +
    Number.parseFloat(styles.paddingBottom || "0");

  return {
    width: Math.max(1, Math.floor(rect.width - horizontalPadding)),
    height: Math.max(1, Math.floor(rect.height - verticalPadding)),
  };
}

async function startMobileViewerOrientationSession(): Promise<MobileViewerOrientationSession> {
  const session = { fullscreenStarted: false, orientationLocked: false };
  if (typeof window === "undefined" || typeof document === "undefined") {
    return session;
  }

  const orientation = window.screen.orientation as
    | ScreenOrientationWithLock
    | undefined;
  if (typeof orientation?.lock !== "function") {
    return session;
  }

  // Orientation lock is intentionally best-effort; iOS and embedded WebViews
  // commonly reject it, so the rotate guidance remains the reliable fallback.
  const root = document.documentElement as HTMLElement & {
    requestFullscreen?: () => Promise<void>;
  };
  if (
    !document.fullscreenElement &&
    document.fullscreenEnabled &&
    typeof root.requestFullscreen === "function"
  ) {
    try {
      await root.requestFullscreen();
      session.fullscreenStarted = true;
    } catch {
      session.fullscreenStarted = false;
    }
  }

  try {
    await orientation.lock("landscape");
    session.orientationLocked = true;
  } catch {
    session.orientationLocked = false;
  }

  return session;
}

async function stopMobileViewerOrientationSession(
  session: MobileViewerOrientationSession | null,
) {
  if (
    !session ||
    typeof window === "undefined" ||
    typeof document === "undefined"
  ) {
    return;
  }

  if (session.orientationLocked) {
    try {
      (
        window.screen.orientation as ScreenOrientationWithLock | undefined
      )?.unlock?.();
    } catch {
      // Best-effort cleanup only.
    }
  }

  if (
    session.fullscreenStarted &&
    document.fullscreenElement &&
    typeof document.exitFullscreen === "function"
  ) {
    try {
      await document.exitFullscreen();
    } catch {
      // Best-effort cleanup only.
    }
  }
}

function statusPriority(status: FloorPlanPointStatus) {
  const priority: Record<FloorPlanPointStatus, number> = {
    normal: 0,
    noData: 0,
    warning: 1,
    critical: 2,
    offline: 3,
  };
  return priority[status] ?? 0;
}

function usePhoneLandscapeViewport() {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    function update() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      setMatches(width > height && width <= 960 && height <= 520);
    }

    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return matches;
}

type DragTarget = "marker" | "card";

interface ActiveDrag {
  id: string;
  target: DragTarget;
  moved: boolean;
  xRatio: number;
  yRatio: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
  cardSize?: { width: number; height: number };
}

interface FloorPlanCalloutLayout {
  point: FloorPlanPoint;
  latest?: LatestMeasurement | null;
  status: FloorPlanPointStatus;
  markerRatio: RatioPoint;
  cardRatio: RatioPoint;
  marker: { x: number; y: number };
  card: { x: number; y: number };
  cardSize: { width: number; height: number };
  density: FloorPlanCalloutDensity;
  requestedAnchorSide: FloorPlanCalloutAnchorSide;
  anchorSide: FloorPlanCardAnchorSide;
  leaderPath: string;
  isDraft: boolean;
}

interface FloorPlanMobileViewerProps {
  open: boolean;
  points: FloorPlanPoint[];
  pdfUrl?: string | null;
  renderedImageUrl?: string | null;
  pageNumber: number;
  pageWidth?: number | null;
  pageHeight?: number | null;
  renderScale: 1 | 2;
  isLandscape: boolean;
  initialPointId?: string | null;
  onClose: () => void;
  pointStatusColor: (status: FloorPlanPointStatus) => string;
  pointStatusLabel: (status: FloorPlanPointStatus) => string;
}

function FloorPlanMobileViewer({
  open,
  points,
  pdfUrl,
  renderedImageUrl,
  pageNumber,
  pageWidth,
  pageHeight,
  renderScale,
  isLandscape,
  initialPointId,
  onClose,
  pointStatusColor,
  pointStatusLabel,
}: FloorPlanMobileViewerProps) {
  const t = useTranslations();
  const viewerFrameRef = useRef<HTMLDivElement>(null);
  const mobilePdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [viewerFrameSize, setViewerFrameSize] = useState({
    width: 0,
    height: 0,
  });
  const [mobilePdfRenderState, setMobilePdfRenderState] =
    useState<PdfRenderState>("idle");
  const [mobileRenderedImageState, setMobileRenderedImageState] =
    useState<PdfRenderState>("idle");
  const [mobilePdfCanvasDisplaySize, setMobilePdfCanvasDisplaySize] = useState({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    if (open) {
      setSelectedPointId(initialPointId ?? null);
      return;
    }
    setSelectedPointId(null);
    setViewerFrameSize({ width: 0, height: 0 });
    setMobilePdfRenderState("idle");
    setMobileRenderedImageState("idle");
    setMobilePdfCanvasDisplaySize({ width: 0, height: 0 });
  }, [initialPointId, open]);

  useEffect(() => {
    setMobileRenderedImageState(renderedImageUrl ? "loading" : "idle");
    setMobilePdfCanvasDisplaySize({ width: 0, height: 0 });
  }, [renderedImageUrl]);

  useEffect(() => {
    if (!open || !isLandscape) return;
    const element = viewerFrameRef.current;
    if (!element) return;

    function measure() {
      const target = viewerFrameRef.current;
      if (!target) return;
      const next = measureElementContentBox(target);
      setViewerFrameSize((current) => {
        if (
          Math.abs(current.width - next.width) < 2 &&
          Math.abs(current.height - next.height) < 2
        ) {
          return current;
        }
        return next;
      });
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [isLandscape, open]);

  const plannedSurfaceSize =
    viewerFrameSize.width && viewerFrameSize.height
      ? resolveMobileFloorPlanSurfaceSize({
          containerWidth: viewerFrameSize.width,
          containerHeight: viewerFrameSize.height,
          pageWidth,
          pageHeight,
        })
      : { width: 0, height: 0 };
  const useRenderedImage = shouldUseRenderedFloorPlanImage(
    renderedImageUrl,
    mobileRenderedImageState === "failed",
  );
  const renderedSurfaceSize =
    ((useRenderedImage && mobileRenderedImageState === "ready") ||
      (!useRenderedImage && mobilePdfRenderState === "ready")) &&
    mobilePdfCanvasDisplaySize.width &&
    mobilePdfCanvasDisplaySize.height
      ? mobilePdfCanvasDisplaySize
      : plannedSurfaceSize;
  const showFallbackPlan =
    !useRenderedImage && (!pdfUrl || mobilePdfRenderState === "failed");
  const showBackgroundLoading = useRenderedImage
    ? mobileRenderedImageState === "loading"
    : Boolean(pdfUrl && mobilePdfRenderState === "loading");
  const mobilePointLayouts = useMemo(
    () =>
      renderedSurfaceSize.width && renderedSurfaceSize.height
        ? points.map((point) => {
            const marker = resolveMobileMarkerPosition(
              { xRatio: point.xRatio, yRatio: point.yRatio },
              renderedSurfaceSize,
            );
            const status = resolveFloorPlanPointStatus(point);
            const latest =
              point.device?.measurements?.[0] ??
              point.device?.latestMeasurement;
            return {
              point,
              marker,
              status,
              latest,
              displayName: point.device?.displayName ?? point.name,
            };
          })
        : [],
    [points, renderedSurfaceSize],
  );
  const selectedLayout =
    mobilePointLayouts.find((layout) => layout.point.id === selectedPointId) ??
    null;
  const popoverPosition = selectedLayout
    ? clampMobilePopoverPosition({
        marker: selectedLayout.marker,
        surface: renderedSurfaceSize,
      })
    : null;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="100vw"
      style={{ top: 0, maxWidth: "100vw", paddingBottom: 0, margin: 0 }}
      styles={{
        content: {
          height: "100vh",
          maxHeight: "100dvh",
          borderRadius: 0,
          padding: 0,
          overflow: "hidden",
          boxSizing: "border-box",
        },
        body: { height: "100%", padding: 0 },
      }}
      closeIcon={null}
      maskClosable
    >
      <div
        data-testid="floor-plan-mobile-viewer"
        style={{
          height: "100vh",
          maxHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxSizing: "border-box",
          background: "#fff",
        }}
      >
        <div
          style={{
            flex: "0 0 auto",
            minHeight: 52,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding:
              "max(10px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) 10px max(12px, env(safe-area-inset-left))",
            borderBottom: "1px solid var(--nmth-border)",
            boxSizing: "border-box",
          }}
        >
          <Space size={8}>
            <MapPinned size={17} color="#004EA2" />
            <Typography.Text strong>
              {t("floorPlan.mobileViewerTitle")}
            </Typography.Text>
          </Space>
          <Button
            type="text"
            icon={<X size={16} />}
            aria-label={t("floorPlan.closeFloorPlanViewer")}
            onClick={onClose}
          />
        </div>
        {!isLandscape ? (
          <div
            data-testid="floor-plan-mobile-viewer-rotate-guidance"
            style={{
              flex: 1,
              minHeight: 0,
              display: "grid",
              placeItems: "center",
              padding: 24,
              textAlign: "center",
              background: "#F8FAFC",
            }}
          >
            <Space direction="vertical" size={10} align="center">
              <MapPinned size={28} color="#004EA2" />
              <Typography.Text strong>
                {t("floorPlan.rotateForFloorPlan")}
              </Typography.Text>
            </Space>
          </div>
        ) : (
          <div
            ref={viewerFrameRef}
            data-testid="floor-plan-mobile-viewer-body"
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
              display: "grid",
              placeItems: "center",
              padding:
                "8px max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left))",
              boxSizing: "border-box",
              background: "#F8FAFC",
            }}
          >
            {!renderedSurfaceSize.width || !renderedSurfaceSize.height ? (
              <Spin />
            ) : (
              <div
                data-testid="floor-plan-mobile-viewer-surface"
                className="nmth-floor-plan"
                onClick={() => setSelectedPointId(null)}
                style={{
                  width: renderedSurfaceSize.width,
                  height: renderedSurfaceSize.height,
                  minHeight: renderedSurfaceSize.height,
                  maxWidth: renderedSurfaceSize.width,
                  maxHeight: renderedSurfaceSize.height,
                  boxSizing: "border-box",
                  touchAction: "manipulation",
                }}
              >
                {useRenderedImage ? (
                  <RenderedFloorPlanImage
                    imageUrl={renderedImageUrl}
                    label={t("dashboard.floorPlan")}
                    floorPlanWidthBucket={plannedSurfaceSize.width}
                    floorPlanMaxHeight={plannedSurfaceSize.height}
                    pageWidth={pageWidth}
                    pageHeight={pageHeight}
                    onRenderStateChange={setMobileRenderedImageState}
                    onDisplaySizeChange={setMobilePdfCanvasDisplaySize}
                  />
                ) : (
                  <PdfFloorPlanCanvas
                    ref={mobilePdfCanvasRef}
                    pdfUrl={pdfUrl}
                    label={t("dashboard.floorPlan")}
                    floorPlanWidthBucket={plannedSurfaceSize.width}
                    floorPlanMaxHeight={plannedSurfaceSize.height}
                    pageNumber={pageNumber}
                    pageWidth={pageWidth}
                    pageHeight={pageHeight}
                    renderScale={renderScale}
                    onRenderStateChange={setMobilePdfRenderState}
                    onDisplaySizeChange={setMobilePdfCanvasDisplaySize}
                  />
                )}
                {showFallbackPlan ? (
                  <>
                    <div
                      className="nmth-floor-wing"
                      style={{
                        left: "7%",
                        top: "14%",
                        width: "33%",
                        height: "30%",
                      }}
                    />
                    <div
                      className="nmth-floor-wing"
                      style={{
                        left: "46%",
                        top: "20%",
                        width: "38%",
                        height: "46%",
                      }}
                    />
                    <div
                      className="nmth-floor-wing"
                      style={{
                        left: "18%",
                        top: "56%",
                        width: "30%",
                        height: "24%",
                      }}
                    />
                  </>
                ) : null}
                {showBackgroundLoading ? (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "grid",
                      placeItems: "center",
                      background: "rgba(255, 255, 255, 0.58)",
                      zIndex: 3,
                    }}
                  >
                    <Spin />
                  </div>
                ) : null}
                {mobilePointLayouts.map((layout) => {
                  const active = selectedPointId === layout.point.id;
                  const statusLabel = pointStatusLabel(layout.status);
                  return (
                    <button
                      key={layout.point.id}
                      type="button"
                      data-testid="floor-plan-mobile-marker"
                      className={floorPlanCalloutStatusClassName(layout.status)}
                      aria-label={`${layout.displayName}, ${statusLabel}${
                        active ? `, ${t("floorPlan.markerSelected")}` : ""
                      }`}
                      aria-pressed={active}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedPointId(layout.point.id);
                      }}
                      style={{
                        position: "absolute",
                        left: layout.marker.x,
                        top: layout.marker.y,
                        width: active
                          ? MOBILE_MARKER_DOT_SIZE_ACTIVE
                          : MOBILE_MARKER_TOUCH_TARGET_SIZE,
                        height: active
                          ? MOBILE_MARKER_DOT_SIZE_ACTIVE
                          : MOBILE_MARKER_TOUCH_TARGET_SIZE,
                        transform: "translate(-50%, -50%)",
                        display: "grid",
                        placeItems: "center",
                        alignItems: "center",
                        padding: 0,
                        border: 0,
                        background: "transparent",
                        cursor: "pointer",
                        touchAction: "manipulation",
                        zIndex: active ? 8 : 6,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: active
                            ? MOBILE_MARKER_DOT_SIZE_ACTIVE
                            : MOBILE_MARKER_DOT_SIZE,
                          height: active
                            ? MOBILE_MARKER_DOT_SIZE_ACTIVE
                            : MOBILE_MARKER_DOT_SIZE,
                          borderRadius: 999,
                          border: "1px solid #fff",
                          background: "var(--nmth-floor-plan-callout-accent)",
                          boxShadow: active
                            ? "0 0 0 1px #294f73, 0 0 0 2.5px rgba(41, 79, 115, 0.16)"
                            : "0 0 0 0.5px rgba(32, 58, 82, 0.52), 0 1px 3px rgba(20, 32, 51, 0.18)",
                        }}
                      />
                    </button>
                  );
                })}
                {selectedLayout && popoverPosition ? (
                  <div
                    data-testid="floor-plan-mobile-marker-popover"
                    aria-live="polite"
                    onClick={(event) => event.stopPropagation()}
                    style={{
                      position: "absolute",
                      left: popoverPosition.x,
                      top: popoverPosition.y,
                      width: MOBILE_MARKER_POPOVER_SIZE.width,
                      minHeight: MOBILE_MARKER_POPOVER_SIZE.height,
                      padding: 7,
                      borderRadius: 6,
                      border: "1px solid var(--nmth-border)",
                      background: "rgba(255, 255, 255, 0.96)",
                      boxShadow: "0 12px 28px rgba(20, 32, 51, 0.18)",
                      zIndex: 10,
                    }}
                  >
                    <Space
                      direction="vertical"
                      size={3}
                      style={{ width: "100%" }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 6,
                          alignItems: "center",
                        }}
                      >
                        <Typography.Text
                          strong
                          ellipsis
                          style={{
                            maxWidth: 86,
                            fontSize: 12,
                            lineHeight: 1.2,
                          }}
                        >
                          {selectedLayout.displayName}
                        </Typography.Text>
                        <Tag
                          color={pointStatusColor(selectedLayout.status)}
                          style={{
                            marginInlineEnd: 0,
                            fontSize: 11,
                            lineHeight: "18px",
                            paddingInline: 5,
                          }}
                        >
                          {pointStatusLabel(selectedLayout.status)}
                        </Tag>
                      </div>
                      <Typography.Text
                        style={{ fontSize: 12, lineHeight: 1.25 }}
                      >
                        {`${t("floorPlan.markerTemperature")}: ${
                          selectedLayout.latest
                            ? formatClimateValue(
                                selectedLayout.latest.temperatureC,
                                "-",
                              )
                            : "--"
                        } C`}
                      </Typography.Text>
                      <Typography.Text
                        style={{ fontSize: 12, lineHeight: 1.25 }}
                      >
                        {`${t("floorPlan.markerHumidity")}: ${
                          selectedLayout.latest
                            ? formatClimateValue(
                                selectedLayout.latest.humidityPercent,
                                "-",
                              )
                            : "--"
                        } %RH`}
                      </Typography.Text>
                    </Space>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

export function FloorPlanDashboard({
  points,
  editable = false,
  onPointSaved,
  pdfUrl,
  renderedImageUrl,
  hasFloorPlan = true,
  pageNumber,
  pageWidth,
  pageHeight,
  renderScale,
}: {
  points: FloorPlanPoint[];
  editable?: boolean;
  onPointSaved?: () => Promise<unknown> | unknown;
  pdfUrl?: string | null;
  renderedImageUrl?: string | null;
  hasFloorPlan?: boolean;
  pageNumber?: number | null;
  pageWidth?: number | null;
  pageHeight?: number | null;
  renderScale?: number | null;
}) {
  const t = useTranslations();
  const { message } = App.useApp();
  const { isMobile, isTabletPortrait, isTabletLandscape } = useResponsiveMode();
  const isPhoneLandscapeViewport = usePhoneLandscapeViewport();
  const isMobileFloorPlanMode = isMobile || isPhoneLandscapeViewport;
  const [form] = Form.useForm();
  const panelRef = useRef<HTMLDivElement>(null);
  const floorPlanRef = useRef<HTMLDivElement>(null);
  const [floorPlanElement, setFloorPlanElement] =
    useState<HTMLDivElement | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const renderedImageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<ActiveDrag | null>(null);
  const suppressClickRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<FloorPlanPoint | null>(null);
  const selectedPoint =
    selected && (points.find((point) => point.id === selected.id) ?? selected);
  const selectedPointId = selectedPoint?.id;
  const [editMode, setEditMode] = useState(false);
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);
  const [pdfRenderState, setPdfRenderState] = useState<
    "idle" | "loading" | "ready" | "failed"
  >("idle");
  const [renderedImageState, setRenderedImageState] = useState<PdfRenderState>("idle");
  const [floorPlanSize, setFloorPlanSize] = useState({
    width: 0,
    minHeight: 0,
  });
  const [pdfCanvasDisplaySize, setPdfCanvasDisplaySize] = useState({
    width: 0,
    height: 0,
  });
  const [draftMarkerPositions, setDraftMarkerPositions] = useState<
    Record<string, { xRatio: number; yRatio: number }>
  >({});
  const [draftCardPositions, setDraftCardPositions] = useState<
    Record<string, { xRatio: number; yRatio: number }>
  >({});
  const [draftDisplayStyles, setDraftDisplayStyles] = useState<
    Record<string, unknown>
  >({});
  const [drawerResizeKey, setDrawerResizeKey] = useState(0);
  const [isMobileViewerOpen, setIsMobileViewerOpen] = useState(false);
  const [mobileViewerInitialPointId, setMobileViewerInitialPointId] = useState<
    string | null
  >(null);
  const mobileOrientationSessionRef =
    useRef<MobileViewerOrientationSession | null>(null);
  const mobileOrientationRequestRef =
    useRef<Promise<MobileViewerOrientationSession> | null>(null);
  const setFloorPlanNode = useCallback((node: HTMLDivElement | null) => {
    floorPlanRef.current = node;
    setFloorPlanElement(node);
  }, []);

  useEffect(() => {
    if (!editable || isMobileFloorPlanMode || isTabletPortrait) {
      setEditMode(false);
    }
  }, [editable, isMobileFloorPlanMode, isTabletPortrait]);

  const releaseMobileViewerOrientationSession = useCallback(() => {
    const pendingRequest = mobileOrientationRequestRef.current;
    mobileOrientationRequestRef.current = null;

    const activeSession = mobileOrientationSessionRef.current;
    mobileOrientationSessionRef.current = null;

    if (activeSession) {
      void stopMobileViewerOrientationSession(activeSession);
    }

    if (pendingRequest) {
      void pendingRequest.then((session) => {
        void stopMobileViewerOrientationSession(session);
      });
    }
  }, []);

  useEffect(
    () => () => {
      releaseMobileViewerOrientationSession();
    },
    [releaseMobileViewerOrientationSession],
  );

  const pageNumberValue = Math.max(1, Math.floor(pageNumber ?? 1));
  const renderScaleValue = renderScale === 2 ? 2 : 1;
  const displayWidthBucket = floorPlanSize.width
    ? Math.max(
        1,
        Math.round(floorPlanSize.width / PDF_RENDER_WIDTH_BUCKET) *
          PDF_RENDER_WIDTH_BUCKET,
      )
    : 0;
  const interactionSurface: SurfaceSize =
    pdfCanvasDisplaySize.width && pdfCanvasDisplaySize.height
      ? pdfCanvasDisplaySize
      : {
          width: floorPlanSize.width,
          height: floorPlanSize.minHeight,
        };
  const handlePdfRenderStateChange = useCallback(
    (state: PdfRenderState) => setPdfRenderState(state),
    [],
  );
  const handlePdfDisplaySizeChange = useCallback(
    (size: { width: number; height: number }) => setPdfCanvasDisplaySize(size),
    [],
  );

  useEffect(() => {
    setRenderedImageState(renderedImageUrl ? "loading" : "idle");
    setPdfCanvasDisplaySize({ width: 0, height: 0 });
  }, [renderedImageUrl]);

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await panelRef.current?.requestFullscreen();
  }

  function pointDisplayStyle(point: FloorPlanPoint) {
    return draftDisplayStyles[point.id] ?? point.displayStyle;
  }

  function pointFormValues(point: FloorPlanPoint, markerRatio?: RatioPoint) {
    const normalized = normalizeFloorPlanDisplayStyle(
      pointDisplayStyle(point),
      {
        totalPoints: points.length,
        surfaceWidth: interactionSurface.width,
      },
    );
    const marker = markerRatio ?? draftMarkerPositions[point.id] ?? point;
    return {
      name: point.name,
      xRatio: marker.xRatio,
      yRatio: marker.yRatio,
      density: normalized.density,
      anchorSide: normalized.connection.anchorSide,
    };
  }

  function selectPoint(point: FloorPlanPoint, markerRatio?: RatioPoint) {
    setSelected(markerRatio ? { ...point, ...markerRatio } : point);
    setHoveredPointId(point.id);
    form.setFieldsValue(pointFormValues(point, markerRatio));
  }

  function handlePointCardKeyDown(
    event: ReactKeyboardEvent<HTMLElement>,
    point: FloorPlanPoint,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectPoint(point);
    }
  }

  async function savePoint(values: {
    name: string;
    xRatio: number;
    yRatio: number;
    density: FloorPlanCalloutDensity;
    anchorSide: FloorPlanCalloutAnchorSide;
  }) {
    if (!editable) {
      return;
    }
    if (!selectedPoint) {
      message.error(t("dashboard.noData"));
      return;
    }
    const displayStyle = mergeFloorPlanDisplayStyle(
      pointDisplayStyle(selectedPoint),
      {
        density: values.density,
        connection: { anchorSide: values.anchorSide },
      },
    );
    await apiFetch(`/floor-plans/points/${selectedPoint.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: values.name,
        xRatio: values.xRatio,
        yRatio: values.yRatio,
        displayStyle,
      }),
    });
    setDraftDisplayStyles((current) => ({
      ...current,
      [selectedPoint.id]: displayStyle,
    }));
    message.success(t("app.save"));
    setSelected(null);
    await onPointSaved?.();
  }

  function getInteractionRect() {
    if (useRenderedImage && renderedImageState === "ready" && renderedImageRef.current) {
      return renderedImageRef.current.getBoundingClientRect();
    }
    return pdfRenderState === "ready" && pdfCanvasRef.current
      ? pdfCanvasRef.current.getBoundingClientRect()
      : (floorPlanRef.current?.getBoundingClientRect() ?? null);
  }

  function pointPositionFromCoordinates(
    clientX: number,
    clientY: number,
    drag?: ActiveDrag,
  ) {
    const rect = getInteractionRect();
    if (!rect) return null;
    const next = {
      xRatio: clampRatio(
        (clientX - (drag?.pointerOffsetX ?? 0) - rect.left) / rect.width,
      ),
      yRatio: clampRatio(
        (clientY - (drag?.pointerOffsetY ?? 0) - rect.top) / rect.height,
      ),
    };
    if (drag?.target === "card" && drag.cardSize) {
      return fitCardRatioToSurface(next, drag.cardSize, interactionSurface);
    }
    return next;
  }

  function updateDraftPosition(
    drag: ActiveDrag,
    clientX: number,
    clientY: number,
    moved: boolean,
  ) {
    const next = pointPositionFromCoordinates(clientX, clientY, drag);
    if (!next) return;
    const updatedDrag = {
      ...drag,
      moved: drag.moved || moved,
      ...next,
    };
    dragRef.current = updatedDrag;
    if (drag.target === "card") {
      setDraftCardPositions((current) => ({ ...current, [drag.id]: next }));
      return;
    }
    setDraftMarkerPositions((current) => ({ ...current, [drag.id]: next }));
  }

  function startDrag(
    point: FloorPlanPoint,
    target: DragTarget,
    event: ReactPointerEvent<HTMLElement>,
    layout?: FloorPlanCalloutLayout,
  ) {
    if (!editable || !editMode) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const rect = getInteractionRect();
    const currentPixel =
      target === "card" && layout ? layout.card : layout?.marker;
    const pointerOffsetX =
      rect && currentPixel && target === "card"
        ? event.clientX - (rect.left + currentPixel.x)
        : 0;
    const pointerOffsetY =
      rect && currentPixel && target === "card"
        ? event.clientY - (rect.top + currentPixel.y)
        : 0;
    const startRatio =
      target === "card" && layout ? layout.cardRatio : layout?.markerRatio;
    const drag: ActiveDrag = {
      id: point.id,
      target,
      moved: false,
      xRatio: startRatio?.xRatio ?? point.xRatio,
      yRatio: startRatio?.yRatio ?? point.yRatio,
      pointerOffsetX,
      pointerOffsetY,
      cardSize: target === "card" ? layout?.cardSize : undefined,
    };
    dragRef.current = drag;
    updateDraftPosition(drag, event.clientX, event.clientY, false);
  }

  async function saveAnchorSide(
    point: FloorPlanPoint,
    anchorSide: FloorPlanCardAnchorSide,
  ) {
    if (!editable) {
      return;
    }
    const displayStyle = mergeFloorPlanDisplayStyle(pointDisplayStyle(point), {
      connection: { anchorSide },
    });
    setDraftDisplayStyles((current) => ({
      ...current,
      [point.id]: displayStyle,
    }));
    if (selectedPointId === point.id) {
      form.setFieldValue("anchorSide", anchorSide);
    }
    await apiFetch(`/floor-plans/points/${point.id}`, {
      method: "PATCH",
      body: JSON.stringify({ displayStyle }),
    });
    message.success(t("app.save"));
    await onPointSaved?.();
  }

  async function finishActiveDrag() {
    if (!dragRef.current) return;
    const drag = dragRef.current;
    dragRef.current = null;
    if (!editable) return;
    if (!drag.moved) return;
    suppressClickRef.current = drag.id;
    const point = points.find((candidate) => candidate.id === drag.id);
    if (!point) return;
    if (drag.target === "card") {
      const displayStyle = mergeFloorPlanDisplayStyle(
        pointDisplayStyle(point),
        {
          card: { xRatio: drag.xRatio, yRatio: drag.yRatio },
          connection: { lineShape: "autoRoundedElbow" },
        },
      );
      setDraftDisplayStyles((current) => ({
        ...current,
        [drag.id]: displayStyle,
      }));
      await apiFetch(`/floor-plans/points/${drag.id}`, {
        method: "PATCH",
        body: JSON.stringify({ displayStyle }),
      });
    } else {
      await apiFetch(`/floor-plans/points/${drag.id}`, {
        method: "PATCH",
        body: JSON.stringify({ xRatio: drag.xRatio, yRatio: drag.yRatio }),
      });
    }
    message.success(t("app.save"));
    await onPointSaved?.();
    if (drag.target === "card") {
      setDraftCardPositions((current) => {
        const { [drag.id]: _removed, ...rest } = current;
        return rest;
      });
    } else {
      setDraftMarkerPositions((current) => {
        const { [drag.id]: _removed, ...rest } = current;
        return rest;
      });
    }
  }

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      updateDraftPosition(drag, event.clientX, event.clientY, true);
    }
    function handleDragEnd() {
      void finishActiveDrag();
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handleDragEnd);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handleDragEnd);
    };
  });

  useEffect(() => {
    const element = floorPlanElement;
    if (!hasFloorPlan || !element) {
      setFloorPlanSize({ width: 0, minHeight: 0 });
      setPdfCanvasDisplaySize({ width: 0, height: 0 });
      return;
    }
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    function widthBucket(width: number) {
      return Math.round(width / PDF_RENDER_WIDTH_BUCKET);
    }

    function measureCanvasSize() {
      const target = floorPlanElement;
      if (!target) return null;
      const computed = window.getComputedStyle(target);
      const minHeight = Number.parseFloat(computed.minHeight);
      return {
        width: Math.max(1, Math.round(target.clientWidth)),
        minHeight: Math.max(
          1,
          Math.round(minHeight || target.clientHeight || 560),
        ),
      };
    }

    function updateCanvasSize() {
      const next = measureCanvasSize();
      if (!next) return;
      setFloorPlanSize((current) => {
        const widthJitter = Math.abs(current.width - next.width) < 4;
        const sameWidthBucket =
          widthBucket(current.width) === widthBucket(next.width);
        const sameHeight = Math.abs(current.minHeight - next.minHeight) < 2;
        if (widthJitter && sameWidthBucket && sameHeight) {
          return current;
        }
        return next;
      });
    }

    function scheduleCanvasSizeUpdate() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(updateCanvasSize, FLOOR_PLAN_RESIZE_DEBOUNCE_MS);
    }

    updateCanvasSize();
    const observer = new ResizeObserver(scheduleCanvasSizeUpdate);
    observer.observe(element);
    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      observer.disconnect();
    };
  }, [floorPlanElement, hasFloorPlan]);

  const useRenderedImage = shouldUseRenderedFloorPlanImage(
    renderedImageUrl,
    renderedImageState === "failed",
  );
  const showFallbackPlan =
    hasFloorPlan && !useRenderedImage && (!pdfUrl || pdfRenderState === "failed");
  const showBackgroundLoading = useRenderedImage
    ? renderedImageState === "loading"
    : Boolean(pdfUrl && pdfRenderState === "loading");

  function pointStyle(position: RatioPoint): CSSProperties {
    if (interactionSurface.width && interactionSurface.height) {
      return {
        left: `${position.xRatio * interactionSurface.width}px`,
        top: `${position.yRatio * interactionSurface.height}px`,
      };
    }
    return {
      left: `${position.xRatio * 100}%`,
      top: `${position.yRatio * 100}%`,
    };
  }

  const calloutLayouts = useMemo<FloorPlanCalloutLayout[]>(() => {
    if (!interactionSurface.width || !interactionSurface.height) return [];
    return points.map((point, index) => {
      const markerRatio = draftMarkerPositions[point.id] ?? {
        xRatio: point.xRatio,
        yRatio: point.yRatio,
      };
      const normalized = normalizeFloorPlanDisplayStyle(
        draftDisplayStyles[point.id] ?? point.displayStyle,
        {
          totalPoints: points.length,
          surfaceWidth: interactionSurface.width,
        },
      );
      const density = normalized.density;
      const cardSize = getCalloutCardSize(density);
      const cardRatio =
        draftCardPositions[point.id] ??
        resolveCalloutCardRatio({
          markerRatio,
          storedCardRatio: normalized.card,
          cardSize,
          surface: interactionSurface,
          pointIndex: index,
        });
      const marker = ratioToPixel(markerRatio, interactionSurface);
      const card = ratioToPixel(cardRatio, interactionSurface);
      const anchorSide = resolveAnchorSide(
        normalized.connection.anchorSide,
        marker,
        card,
      );
      const latest =
        point.device?.measurements?.[0] ?? point.device?.latestMeasurement;
      const status = resolveFloorPlanPointStatus(point);
      return {
        point,
        latest,
        status,
        markerRatio,
        cardRatio,
        marker,
        card,
        cardSize,
        density,
        requestedAnchorSide: normalized.connection.anchorSide,
        anchorSide,
        leaderPath: buildLeaderLinePath(marker, card, cardSize, anchorSide),
        isDraft: Boolean(
          draftMarkerPositions[point.id] || draftCardPositions[point.id],
        ),
      };
    });
  }, [
    draftCardPositions,
    draftDisplayStyles,
    draftMarkerPositions,
    interactionSurface,
    points,
  ]);

  const mobilePointRows = useMemo(
    () =>
      points
        .map((point) => ({
          point,
          latest:
            point.device?.measurements?.[0] ?? point.device?.latestMeasurement,
          status: resolveFloorPlanPointStatus(point),
        }))
        .sort(
          (left, right) =>
            statusPriority(right.status) - statusPriority(left.status),
        ),
    [points],
  );
  const inspectedPoint = isTabletPortrait
    ? (selectedPoint ?? mobilePointRows[0]?.point ?? null)
    : selectedPoint;
  const inspectedLatest =
    inspectedPoint?.device?.measurements?.[0] ??
    inspectedPoint?.device?.latestMeasurement;
  const inspectedDeviceId = inspectedPoint?.device?.id;
  const selectedTrend = useQuery({
    queryKey: ["floor-plan-point-trend-24h", inspectedDeviceId],
    queryFn: () =>
      apiFetch<LatestMeasurement[]>(
        `/measurements/trend-24h?deviceId=${inspectedDeviceId}`,
      ),
    enabled: Boolean(inspectedDeviceId),
    retry: 1,
  });

  function densityLabel(value: FloorPlanCalloutDensity) {
    switch (value) {
      case "micro":
        return t("floorPlan.densityMicro");
      case "full":
        return t("floorPlan.densityFull");
      case "compact":
        return t("floorPlan.densityCompact");
    }
  }

  function anchorSideLabel(value: FloorPlanCalloutAnchorSide) {
    switch (value) {
      case "top":
        return t("floorPlan.anchorTop");
      case "right":
        return t("floorPlan.anchorRight");
      case "bottom":
        return t("floorPlan.anchorBottom");
      case "left":
        return t("floorPlan.anchorLeft");
      case "auto":
        return t("floorPlan.anchorAuto");
    }
  }

  function pointStatusColor(status: FloorPlanPointStatus) {
    if (status === "critical") return "red";
    if (status === "warning") return "orange";
    if (status === "offline") return "default";
    if (status === "noData") return "default";
    return "green";
  }

  function pointStatusLabel(status: FloorPlanPointStatus) {
    if (status === "critical") return t("dashboard.critical");
    if (status === "warning") return t("dashboard.warning");
    if (status === "offline") return t("dashboard.offline");
    if (status === "noData") return t("dashboard.noData");
    return t("dashboard.normal");
  }

  const canOpenMobileViewer = hasFloorPlan && mobilePointRows.length > 0;

  function openMobileViewer(initialPointId?: string | null) {
    releaseMobileViewerOrientationSession();
    const orientationRequest = startMobileViewerOrientationSession();
    mobileOrientationRequestRef.current = orientationRequest;
    void orientationRequest.then((session) => {
      if (mobileOrientationRequestRef.current !== orientationRequest) {
        void stopMobileViewerOrientationSession(session);
        return;
      }
      mobileOrientationRequestRef.current = null;
      mobileOrientationSessionRef.current = session;
    });
    setMobileViewerInitialPointId(initialPointId ?? null);
    setIsMobileViewerOpen(true);
  }

  function closeMobileViewer() {
    releaseMobileViewerOrientationSession();
    setIsMobileViewerOpen(false);
    setMobileViewerInitialPointId(null);
  }

  if (isMobileFloorPlanMode) {
    return (
      <div
        ref={panelRef}
        className="nmth-panel"
        style={{ padding: 16 }}
        data-testid="floor-plan-phone-list"
      >
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
            }}
          >
            <Space>
              <RadioTower size={18} color="#004EA2" />
              <Typography.Text strong>
                {t("dashboard.floorPlan")}
              </Typography.Text>
            </Space>
            <Tag>{t("floorPlan.readOnlyMode")}</Tag>
          </div>
          {editable ? (
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {t("floorPlan.mobileReadOnlyHelp")}
            </Typography.Paragraph>
          ) : null}
          {canOpenMobileViewer ? (
            <Button
              type="primary"
              icon={<MapPinned size={15} />}
              onClick={() => openMobileViewer()}
              data-testid="floor-plan-mobile-viewer-open"
              block
            >
              {t("floorPlan.viewFloorPlan")}
            </Button>
          ) : null}
          {!hasFloorPlan ? (
            <Empty description={t("floorPlan.noFloorPlan")} />
          ) : null}
          {hasFloorPlan && mobilePointRows.length ? (
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              {mobilePointRows.map(({ point, latest, status }) => (
                <Card
                  key={point.id}
                  aria-label={point.device?.displayName ?? point.name}
                  size="small"
                  onClick={() => selectPoint(point)}
                  onKeyDown={(event) => handlePointCardKeyDown(event, point)}
                  role="button"
                  style={{ cursor: "pointer" }}
                  tabIndex={0}
                >
                  <Space
                    direction="vertical"
                    size={8}
                    style={{ width: "100%" }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <Typography.Text strong>
                        {point.device?.displayName ?? point.name}
                      </Typography.Text>
                      <Tag color={pointStatusColor(status)}>
                        {pointStatusLabel(status)}
                      </Tag>
                    </div>
                    <Space wrap size={[8, 6]}>
                      <Tag>
                        {point.device?.deviceName ?? t("dashboard.noData")}
                      </Tag>
                      <Tag>{`${t("device.lastOnline")}: ${formatRelativeDelay(point.device?.lastSeenAt)}`}</Tag>
                    </Space>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 8,
                      }}
                    >
                      <Typography.Text>{`${t("device.temperature")}: ${latest ? formatClimateValue(latest.temperatureC, "-") : "--"} C`}</Typography.Text>
                      <Typography.Text>{`${t("device.humidity")}: ${latest ? formatClimateValue(latest.humidityPercent, "-") : "--"} %RH`}</Typography.Text>
                    </div>
                  </Space>
                </Card>
              ))}
            </Space>
          ) : hasFloorPlan ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("floorPlan.noPoints")}
            />
          ) : null}
        </Space>
        <FloorPlanMobileViewer
          open={isMobileViewerOpen}
          points={points}
          pdfUrl={pdfUrl}
          renderedImageUrl={renderedImageUrl}
          pageNumber={pageNumberValue}
          pageWidth={pageWidth}
          pageHeight={pageHeight}
          renderScale={renderScaleValue}
          isLandscape={isPhoneLandscapeViewport}
          initialPointId={mobileViewerInitialPointId}
          onClose={closeMobileViewer}
          pointStatusColor={pointStatusColor}
          pointStatusLabel={pointStatusLabel}
        />
        <Drawer
          title={
            selectedPoint?.device?.displayName ??
            selectedPoint?.name ??
            t("floorPlan.detail")
          }
          open={Boolean(selected)}
          onClose={() => setSelected(null)}
          afterOpenChange={(open) => {
            if (open) setDrawerResizeKey((value) => value + 1);
          }}
          width="100%"
          styles={{ body: { minWidth: 0 } }}
        >
          <Space wrap style={{ marginBottom: 16 }}>
            <Tag color="blue">{selectedPoint?.device?.deviceName ?? "-"}</Tag>
            <Tag>
              {t("device.setpoint")}:{" "}
              {formatClimateValue(inspectedLatest?.dehumidifySetpoint, "-")}
            </Tag>
            <Tag>
              {t("device.lastOnline")}:{" "}
              {formatRelativeDelay(selectedPoint?.device?.lastSeenAt)}
            </Tag>
          </Space>
          {!inspectedDeviceId ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("floorPlan.noBoundDeviceTrend")}
            />
          ) : selectedTrend.isLoading ? (
            <div
              style={{ display: "grid", placeItems: "center", minHeight: 220 }}
            >
              <Spin />
            </div>
          ) : selectedTrend.data?.length ? (
            <ClimateTrendChart
              data={selectedTrend.data}
              height={280}
              compact
              axisPreset="reports"
              resizeKey={`${selectedPoint?.id ?? "point"}-${drawerResizeKey}-${selectedTrend.data.length}`}
              labels={{
                temperature: t("device.temperature"),
                humidity: t("device.humidity"),
                setpoint: t("report.humiditySetpoint"),
              }}
            />
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("floorPlan.noTrendData")}
            />
          )}
          <Typography.Title level={5}>
            {t("floorPlan.rawParsed")}
          </Typography.Title>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              background: "#F4F9FD",
              padding: 12,
              borderRadius: 8,
            }}
          >
            {JSON.stringify(inspectedLatest ?? {}, null, 2)}
          </pre>
        </Drawer>
      </div>
    );
  }

  if (isTabletPortrait) {
    return (
      <div
        ref={panelRef}
        className="nmth-panel"
        style={{ padding: 16 }}
        data-testid="floor-plan-tablet-inspector"
      >
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <Space>
              <RadioTower size={18} color="#004EA2" />
              <Typography.Text strong>
                {t("dashboard.floorPlan")}
              </Typography.Text>
            </Space>
            <Tag>{t("floorPlan.readOnlyMode")}</Tag>
          </div>
          {editable ? (
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {t("floorPlan.tabletPortraitHelp")}
            </Typography.Paragraph>
          ) : null}
          {!hasFloorPlan ? (
            <Empty description={t("floorPlan.noFloorPlan")} />
          ) : null}
          {hasFloorPlan && mobilePointRows.length ? (
            <Row gutter={[14, 14]}>
              <Col xs={24} md={10}>
                <Space direction="vertical" size={10} style={{ width: "100%" }}>
                  {mobilePointRows.map(({ point, latest, status }) => {
                    const active = inspectedPoint?.id === point.id;
                    return (
                      <Card
                        key={point.id}
                        aria-label={point.device?.displayName ?? point.name}
                        size="small"
                        onClick={() => selectPoint(point)}
                        onKeyDown={(event) =>
                          handlePointCardKeyDown(event, point)
                        }
                        role="button"
                        style={{
                          cursor: "pointer",
                          borderColor: active ? "var(--nmth-blue)" : undefined,
                        }}
                        tabIndex={0}
                      >
                        <Space
                          direction="vertical"
                          size={8}
                          style={{ width: "100%" }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 8,
                            }}
                          >
                            <Typography.Text
                              strong
                              ellipsis
                              style={{ maxWidth: 210 }}
                            >
                              {point.device?.displayName ?? point.name}
                            </Typography.Text>
                            <Tag color={pointStatusColor(status)}>
                              {pointStatusLabel(status)}
                            </Tag>
                          </div>
                          <Space wrap size={[6, 6]}>
                            <Tag>
                              {point.device?.deviceName ??
                                t("dashboard.noData")}
                            </Tag>
                            <Tag>{`${t("device.lastOnline")}: ${formatRelativeDelay(point.device?.lastSeenAt)}`}</Tag>
                          </Space>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: 8,
                            }}
                          >
                            <Typography.Text>{`${t("device.temperature")}: ${latest ? formatClimateValue(latest.temperatureC, "-") : "--"} C`}</Typography.Text>
                            <Typography.Text>{`${t("device.humidity")}: ${latest ? formatClimateValue(latest.humidityPercent, "-") : "--"} %RH`}</Typography.Text>
                          </div>
                        </Space>
                      </Card>
                    );
                  })}
                </Space>
              </Col>
              <Col xs={24} md={14}>
                <Card
                  size="small"
                  title={
                    inspectedPoint?.device?.displayName ??
                    inspectedPoint?.name ??
                    t("floorPlan.detail")
                  }
                  extra={
                    inspectedPoint ? (
                      <Tag
                        color={pointStatusColor(
                          resolveFloorPlanPointStatus(inspectedPoint),
                        )}
                      >
                        {pointStatusLabel(
                          resolveFloorPlanPointStatus(inspectedPoint),
                        )}
                      </Tag>
                    ) : null
                  }
                >
                  <Space wrap style={{ marginBottom: 14 }}>
                    <Tag color="blue">
                      {inspectedPoint?.device?.deviceName ?? "-"}
                    </Tag>
                    <Tag>
                      {t("device.setpoint")}:{" "}
                      {formatClimateValue(
                        inspectedLatest?.dehumidifySetpoint,
                        "-",
                      )}
                    </Tag>
                    <Tag>
                      {t("device.lastOnline")}:{" "}
                      {formatRelativeDelay(inspectedPoint?.device?.lastSeenAt)}
                    </Tag>
                  </Space>
                  {!inspectedDeviceId ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={t("floorPlan.noBoundDeviceTrend")}
                    />
                  ) : selectedTrend.isLoading ? (
                    <div
                      style={{
                        display: "grid",
                        placeItems: "center",
                        minHeight: 240,
                      }}
                    >
                      <Spin />
                    </div>
                  ) : selectedTrend.data?.length ? (
                    <ClimateTrendChart
                      data={selectedTrend.data}
                      height={300}
                      compact
                      axisPreset="reports"
                      resizeKey={`${inspectedPoint?.id ?? "point"}-${drawerResizeKey}-${selectedTrend.data.length}`}
                      labels={{
                        temperature: t("device.temperature"),
                        humidity: t("device.humidity"),
                        setpoint: t("report.humiditySetpoint"),
                      }}
                    />
                  ) : (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={t("floorPlan.noTrendData")}
                    />
                  )}
                  <Typography.Title level={5}>
                    {t("floorPlan.rawParsed")}
                  </Typography.Title>
                  <pre
                    style={{
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      overflowX: "auto",
                      maxHeight: 180,
                      background: "#F4F9FD",
                      padding: 12,
                      borderRadius: 8,
                    }}
                  >
                    {JSON.stringify(inspectedLatest ?? {}, null, 2)}
                  </pre>
                </Card>
              </Col>
            </Row>
          ) : hasFloorPlan ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("floorPlan.noPoints")}
            />
          ) : null}
        </Space>
      </div>
    );
  }

  return (
    <div ref={panelRef} className="nmth-panel" style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <Space>
          <RadioTower size={18} color="#004EA2" />
          <Typography.Text strong>{t("dashboard.floorPlan")}</Typography.Text>
        </Space>
        <Space wrap>
          <Button
            icon={<Pencil size={15} />}
            disabled={!editable}
            onClick={() => setEditMode((value) => !value)}
            size={isTabletLandscape ? "large" : "middle"}
          >
            {editMode ? t("floorPlan.editMode") : t("floorPlan.readOnlyMode")}
          </Button>
          <Button
            icon={<Maximize2 size={15} />}
            onClick={() => void toggleFullscreen()}
            size={isTabletLandscape ? "large" : "middle"}
          >
            {t("app.fullscreen")}
          </Button>
        </Space>
      </div>
      {!hasFloorPlan ? (
        <Empty description={t("floorPlan.noFloorPlan")} />
      ) : null}
      {hasFloorPlan ? (
        <div
          ref={setFloorPlanNode}
          data-testid="floor-plan-visual-surface"
          className={`nmth-floor-plan${
            editMode ? " nmth-floor-plan-callout-editing" : ""
          }`}
          style={{
            maxWidth: "100%",
            touchAction: editMode ? "none" : "manipulation",
          }}
        >
          {useRenderedImage ? (
            <RenderedFloorPlanImage
              ref={renderedImageRef}
              imageUrl={renderedImageUrl}
              label={t("dashboard.floorPlan")}
              floorPlanWidthBucket={displayWidthBucket}
              pageWidth={pageWidth}
              pageHeight={pageHeight}
              onRenderStateChange={setRenderedImageState}
              onDisplaySizeChange={handlePdfDisplaySizeChange}
            />
          ) : (
            <PdfFloorPlanCanvas
              ref={pdfCanvasRef}
              pdfUrl={pdfUrl}
              label={t("dashboard.floorPlan")}
              floorPlanWidthBucket={displayWidthBucket}
              pageNumber={pageNumberValue}
              pageWidth={pageWidth}
              pageHeight={pageHeight}
              renderScale={renderScaleValue}
              onRenderStateChange={handlePdfRenderStateChange}
              onDisplaySizeChange={handlePdfDisplaySizeChange}
            />
          )}
          {showFallbackPlan ? (
            <>
              <div
                className="nmth-floor-wing"
                style={{ left: "7%", top: "14%", width: "33%", height: "30%" }}
              />
              <div
                className="nmth-floor-wing"
                style={{ left: "46%", top: "20%", width: "38%", height: "46%" }}
              />
              <div
                className="nmth-floor-wing"
                style={{ left: "18%", top: "56%", width: "30%", height: "24%" }}
              />
            </>
          ) : null}
          {showBackgroundLoading ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                background: "rgba(255, 255, 255, 0.58)",
                zIndex: 3,
              }}
            >
              <Spin />
            </div>
          ) : null}
          {calloutLayouts.length ? (
            <svg
              className="nmth-floor-plan-callout-lines"
              width={interactionSurface.width}
              height={interactionSurface.height}
              viewBox={`0 0 ${interactionSurface.width} ${interactionSurface.height}`}
              aria-label={t("floorPlan.connectionLines")}
            >
              {calloutLayouts.map((layout) => {
                const active = selectedPointId === layout.point.id;
                return (
                  <Fragment key={layout.point.id}>
                    <path
                      className={`nmth-floor-plan-callout-line${
                        active ? " nmth-floor-plan-callout-line--selected" : ""
                      }${
                        layout.isDraft
                          ? " nmth-floor-plan-callout-line--draft"
                          : ""
                      }`}
                      d={layout.leaderPath}
                    />
                    <path
                      className="nmth-floor-plan-callout-line-hit"
                      d={layout.leaderPath}
                      role="button"
                      tabIndex={0}
                      aria-label={
                        layout.point.device?.displayName ?? layout.point.name
                      }
                      onClick={() =>
                        selectPoint(layout.point, layout.markerRatio)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectPoint(layout.point, layout.markerRatio);
                        }
                      }}
                    />
                  </Fragment>
                );
              })}
            </svg>
          ) : null}
          {calloutLayouts.map((layout) => {
            const point = layout.point;
            const active = selectedPointId === point.id;
            const hovered = hoveredPointId === point.id;
            const showAnchors = editMode && (active || hovered);
            const displayName = point.device?.displayName ?? point.name;
            const temperature = layout.latest
              ? `${formatClimateValue(layout.latest.temperatureC, "-")}C`
              : "--C";
            const humidity = layout.latest
              ? `${formatClimateValue(layout.latest.humidityPercent, "-")}%`
              : "--%";
            const statusClass = floorPlanCalloutStatusClassName(layout.status);
            return (
              <Fragment key={point.id}>
                <button
                  type="button"
                  className={`nmth-floor-plan-callout-marker ${statusClass}${
                    active ? " nmth-floor-plan-callout-marker--selected" : ""
                  }`}
                  style={
                    isTabletLandscape
                      ? {
                          ...pointStyle(layout.markerRatio),
                          minHeight: 44,
                          minWidth: 44,
                        }
                      : pointStyle(layout.markerRatio)
                  }
                  aria-label={displayName}
                  aria-pressed={active}
                  onPointerEnter={() => setHoveredPointId(point.id)}
                  onPointerLeave={() =>
                    setHoveredPointId((current) =>
                      current === point.id ? null : current,
                    )
                  }
                  onPointerDown={(event) =>
                    startDrag(point, "marker", event, layout)
                  }
                  onClick={() => {
                    if (suppressClickRef.current === point.id) {
                      suppressClickRef.current = null;
                      return;
                    }
                    selectPoint(point, layout.markerRatio);
                  }}
                />
                <div
                  className={`nmth-floor-plan-callout-card-shell nmth-floor-plan-callout-card-shell--${layout.density}${
                    active
                      ? " nmth-floor-plan-callout-card-shell--selected"
                      : ""
                  }${hovered ? " nmth-floor-plan-callout-card-shell--hovered" : ""}`}
                  style={pointStyle(layout.cardRatio)}
                  onPointerEnter={() => setHoveredPointId(point.id)}
                  onPointerLeave={() =>
                    setHoveredPointId((current) =>
                      current === point.id ? null : current,
                    )
                  }
                >
                  <button
                    type="button"
                    className={`nmth-floor-plan-callout-card nmth-floor-plan-callout-card--${layout.density} ${statusClass}`}
                    aria-label={displayName}
                    aria-pressed={active}
                    style={isTabletLandscape ? { minHeight: 44 } : undefined}
                    onPointerDown={(event) =>
                      startDrag(point, "card", event, layout)
                    }
                    onClick={() => {
                      if (suppressClickRef.current === point.id) {
                        suppressClickRef.current = null;
                        return;
                      }
                      selectPoint(point, layout.markerRatio);
                    }}
                  >
                    <span className="nmth-floor-plan-callout-heading">
                      <span className="nmth-floor-plan-callout-state" />
                      <span
                        className="nmth-floor-plan-callout-title"
                        title={displayName}
                      >
                        {displayName}
                      </span>
                    </span>
                    <span className="nmth-floor-plan-callout-reading">
                      <span>{temperature}</span>
                      <span>{humidity}</span>
                    </span>
                    <span className="nmth-floor-plan-callout-meta">
                      {point.device?.deviceName ?? t("dashboard.noData")} ·{" "}
                      {formatRelativeDelay(point.device?.lastSeenAt)}
                    </span>
                  </button>
                  {showAnchors
                    ? FLOOR_PLAN_CARD_ANCHOR_SIDES.map((side) => (
                        <button
                          type="button"
                          key={side}
                          className={`nmth-floor-plan-callout-anchor nmth-floor-plan-callout-anchor--${side}${
                            layout.requestedAnchorSide === side
                              ? " nmth-floor-plan-callout-anchor--active"
                              : ""
                          }`}
                          aria-label={anchorSideLabel(side)}
                          title={anchorSideLabel(side)}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            void saveAnchorSide(point, side);
                          }}
                        />
                      ))
                    : null}
                </div>
              </Fragment>
            );
          })}
        </div>
      ) : null}
      {hasFloorPlan && !points.length ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("floorPlan.noPoints")}
        />
      ) : null}
      <Drawer
        title={
          selectedPoint?.device?.displayName ??
          selectedPoint?.name ??
          t("floorPlan.detail")
        }
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        afterOpenChange={(open) => {
          if (open) setDrawerResizeKey((value) => value + 1);
        }}
        width={isTabletLandscape ? "min(760px, 88vw)" : "min(960px, 92vw)"}
        styles={{ body: { minWidth: 0 } }}
      >
        <Space wrap style={{ marginBottom: 16 }}>
          <Tag color="blue">{selectedPoint?.device?.deviceName ?? "-"}</Tag>
          <Tag>
            {t("device.setpoint")}:{" "}
            {formatClimateValue(inspectedLatest?.dehumidifySetpoint, "-")}
          </Tag>
          <Tag>
            {t("device.lastOnline")}:{" "}
            {formatRelativeDelay(selectedPoint?.device?.lastSeenAt)}
          </Tag>
        </Space>
        {!inspectedDeviceId ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("floorPlan.noBoundDeviceTrend")}
          />
        ) : selectedTrend.isLoading ? (
          <div
            style={{ display: "grid", placeItems: "center", minHeight: 260 }}
          >
            <Spin />
          </div>
        ) : selectedTrend.data?.length ? (
          <ClimateTrendChart
            data={selectedTrend.data}
            height={360}
            axisPreset="reports"
            resizeKey={`${selectedPoint?.id ?? "point"}-${drawerResizeKey}-${selectedTrend.data.length}`}
            labels={{
              temperature: t("device.temperature"),
              humidity: t("device.humidity"),
              setpoint: t("report.humiditySetpoint"),
            }}
          />
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("floorPlan.noTrendData")}
          />
        )}
        <Typography.Title level={5}>
          {t("floorPlan.rawParsed")}
        </Typography.Title>
        {editMode ? (
          <Form form={form} layout="vertical" onFinish={savePoint}>
            <Form.Item
              name="name"
              label={t("floorPlan.pointName")}
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="xRatio"
              label={t("floorPlan.sensorXRatio")}
              rules={[{ required: true }]}
            >
              <InputNumber min={0} max={1} step={0.01} />
            </Form.Item>
            <Form.Item
              name="yRatio"
              label={t("floorPlan.sensorYRatio")}
              rules={[{ required: true }]}
            >
              <InputNumber min={0} max={1} step={0.01} />
            </Form.Item>
            <Form.Item
              name="density"
              label={t("floorPlan.calloutDensity")}
              rules={[{ required: true }]}
            >
              <Select
                options={FLOOR_PLAN_CALLOUT_DENSITIES.map((value) => ({
                  value,
                  label: densityLabel(value),
                }))}
              />
            </Form.Item>
            <Form.Item
              name="anchorSide"
              label={t("floorPlan.connectionAnchor")}
              rules={[{ required: true }]}
            >
              <Select
                options={FLOOR_PLAN_CALLOUT_ANCHOR_SIDES.map((value) => ({
                  value,
                  label: anchorSideLabel(value),
                }))}
              />
            </Form.Item>
            <Button type="primary" htmlType="submit">
              {t("app.save")}
            </Button>
          </Form>
        ) : null}
        <pre
          style={{
            whiteSpace: "pre-wrap",
            background: "#F4F9FD",
            padding: 12,
            borderRadius: 8,
          }}
        >
          {JSON.stringify(inspectedLatest ?? {}, null, 2)}
        </pre>
      </Drawer>
    </div>
  );
}
