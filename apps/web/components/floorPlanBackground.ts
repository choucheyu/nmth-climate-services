export type FloorPlanBackgroundMode = "rendered-image" | "pdf" | "fallback";

export function shouldUseRenderedFloorPlanImage(
  renderedImageUrl?: string | null,
  renderedImageFailed = false,
) {
  return Boolean(renderedImageUrl && !renderedImageFailed);
}

export function resolveFloorPlanBackgroundMode({
  renderedImageUrl,
  renderedImageFailed = false,
  pdfUrl,
  pdfFailed = false,
}: {
  renderedImageUrl?: string | null;
  renderedImageFailed?: boolean;
  pdfUrl?: string | null;
  pdfFailed?: boolean;
}): FloorPlanBackgroundMode {
  if (shouldUseRenderedFloorPlanImage(renderedImageUrl, renderedImageFailed)) {
    return "rendered-image";
  }
  if (pdfUrl && !pdfFailed) {
    return "pdf";
  }
  return "fallback";
}
