import { describe, expect, it } from "vitest";
import {
  resolveFloorPlanBackgroundMode,
  shouldUseRenderedFloorPlanImage,
} from "./floorPlanBackground";

describe("floorPlanBackground", () => {
  it("prefers rendered immutable images over PDF rendering", () => {
    expect(
      resolveFloorPlanBackgroundMode({
        renderedImageUrl: "/api/floor-plans/versions/v1/rendered-image",
        pdfUrl: "/api/floor-plans/versions/v1/file",
      }),
    ).toBe("rendered-image");
    expect(shouldUseRenderedFloorPlanImage("/rendered.png")).toBe(true);
  });

  it("falls back to PDF when rendered image is missing or failed", () => {
    expect(
      resolveFloorPlanBackgroundMode({
        renderedImageUrl: null,
        pdfUrl: "/api/floor-plans/versions/v1/file",
      }),
    ).toBe("pdf");
    expect(
      resolveFloorPlanBackgroundMode({
        renderedImageUrl: "/api/floor-plans/versions/v1/rendered-image",
        renderedImageFailed: true,
        pdfUrl: "/api/floor-plans/versions/v1/file",
      }),
    ).toBe("pdf");
  });

  it("uses the placeholder fallback when neither image nor PDF is available", () => {
    expect(resolveFloorPlanBackgroundMode({ pdfUrl: null })).toBe("fallback");
    expect(
      resolveFloorPlanBackgroundMode({
        renderedImageUrl: "/api/floor-plans/versions/v1/rendered-image",
        renderedImageFailed: true,
        pdfUrl: "/api/floor-plans/versions/v1/file",
        pdfFailed: true,
      }),
    ).toBe("fallback");
  });
});
