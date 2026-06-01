import { describe, expect, it } from "vitest";
import {
  clampMobilePopoverPosition,
  resolveMobileFloorPlanSurfaceSize,
  resolveMobileMarkerPosition,
  shortenMobileMarkerLabel,
  shouldShowMobileMarkerLabels,
} from "./floorPlanMobileViewerModel";

describe("floorPlanMobileViewerModel", () => {
  it("maps xRatio and yRatio into the rendered floor-plan surface, not the shell", () => {
    const renderedSurface = { width: 640, height: 360 };
    const shell = { width: 844, height: 390 };
    const marker = resolveMobileMarkerPosition(
      { xRatio: 0.75, yRatio: 0.25 },
      renderedSurface,
    );

    expect(marker).toEqual({ x: 480, y: 90 });
    expect(marker.x).not.toBe(shell.width * 0.75);
    expect(marker.y).not.toBe(shell.height * 0.25);
  });

  it("clamps unsafe ratios without creating alternate mobile coordinates", () => {
    expect(
      resolveMobileMarkerPosition(
        { xRatio: -0.2, yRatio: 1.4 },
        { width: 500, height: 250 },
      ),
    ).toEqual({ x: 0, y: 250 });
  });

  it("fits the rendered floor-plan surface inside a phone landscape viewport while preserving aspect ratio", () => {
    const surface = resolveMobileFloorPlanSurfaceSize({
      containerWidth: 820,
      containerHeight: 300,
      pageWidth: 1200,
      pageHeight: 600,
    });

    expect(surface).toEqual({ width: 600, height: 300 });
  });

  it.each([
    {
      label: "844 x 390 phone landscape",
      containerWidth: 844 - 16,
      containerHeight: 390 - 52 - 16,
    },
    {
      label: "932 x 430 phone landscape",
      containerWidth: 932 - 16,
      containerHeight: 430 - 52 - 16,
    },
    {
      label: "narrow dynamic-height phone landscape",
      containerWidth: 844 - 24,
      containerHeight: 360 - 82 - 28,
    },
  ])(
    "contains the rendered surface inside the available viewer body for $label",
    ({ containerWidth, containerHeight }) => {
      const surface = resolveMobileFloorPlanSurfaceSize({
        containerWidth,
        containerHeight,
        pageWidth: 1200,
        pageHeight: 675,
      });

      expect(surface.width).toBeLessThanOrEqual(containerWidth);
      expect(surface.height).toBeLessThanOrEqual(containerHeight);
      expect(surface.width / surface.height).toBeCloseTo(1200 / 675, 2);
    },
  );

  it("uses a fallback aspect ratio when PDF page dimensions are missing", () => {
    expect(
      resolveMobileFloorPlanSurfaceSize({
        containerWidth: 320,
        containerHeight: 400,
        pageWidth: null,
        pageHeight: null,
      }),
    ).toEqual({ width: 320, height: 180 });
  });

  it("keeps marker labels only for non-dense readable surfaces", () => {
    expect(
      shouldShowMobileMarkerLabels({ pointCount: 8, surfaceWidth: 700 }),
    ).toBe(true);
    expect(
      shouldShowMobileMarkerLabels({ pointCount: 18, surfaceWidth: 700 }),
    ).toBe(false);
    expect(
      shouldShowMobileMarkerLabels({ pointCount: 8, surfaceWidth: 420 }),
    ).toBe(false);
  });

  it("shortens long labels for compact marker display", () => {
    expect(shortenMobileMarkerLabel("Entrance Environment Point", 12)).toBe(
      "Entrance ...",
    );
    expect(shortenMobileMarkerLabel("A-03", 12)).toBe("A-03");
  });

  it("clamps marker popovers inside the rendered floor-plan surface", () => {
    const surface = { width: 300, height: 180 };
    const popover = { width: 120, height: 80 };

    expect(
      clampMobilePopoverPosition({
        marker: { x: 292, y: 12 },
        surface,
        popoverSize: popover,
      }),
    ).toEqual({ x: 160, y: 24 });

    expect(
      clampMobilePopoverPosition({
        marker: { x: 8, y: 170 },
        surface,
        popoverSize: popover,
      }),
    ).toEqual({ x: 20, y: 78 });
  });
});
