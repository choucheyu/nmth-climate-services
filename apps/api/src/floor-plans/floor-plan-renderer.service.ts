import { BadRequestException, Injectable } from "@nestjs/common";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const MAX_RENDERED_EDGE_PX = 4096;
const MAX_RENDERED_PIXELS = 14_000_000;
const RENDERED_DIR = "uploads/floor-plans/rendered";

export type FloorPlanRenderResult = {
  renderedImagePath: string;
  outputPath: string;
  width: number;
  height: number;
};

export type FloorPlanRenderInput = {
  versionId: string;
  pdfPath: string;
  pageNumber: number;
  renderScale?: number | null;
};

type PdfJsModule = {
  getDocument: (input: unknown) => {
    promise: Promise<{
      numPages: number;
      getPage: (pageNumber: number) => Promise<{
        getViewport: (input: { scale: number }) => { width: number; height: number };
        render: (input: {
          canvasContext: unknown;
          viewport: { width: number; height: number };
        }) => { promise: Promise<unknown> };
      }>;
      destroy: () => Promise<void>;
    }>;
  };
};

@Injectable()
export class FloorPlanRendererService {
  async renderPdfPage(input: FloorPlanRenderInput): Promise<FloorPlanRenderResult> {
    const pageNumber = Math.max(1, Math.floor(input.pageNumber));
    const renderScale = input.renderScale === 2 ? 2 : 1;
    const pdfData = await readFile(input.pdfPath);
    this.installCanvasGlobals();
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJsModule;

    const document = await pdfjs
      .getDocument({
        data: new Uint8Array(pdfData),
        disableFontFace: true,
        isEvalSupported: false,
        useSystemFonts: true,
      })
      .promise;

    try {
      if (pageNumber > document.numPages) {
        throw new BadRequestException(
          `Floor plan PDF page ${pageNumber} exceeds page count ${document.numPages}`,
        );
      }
      const page = await document.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = this.clampScale(baseViewport.width, baseViewport.height, renderScale * 2);
      const viewport = page.getViewport({ scale });
      const width = Math.max(1, Math.round(viewport.width));
      const height = Math.max(1, Math.round(viewport.height));
      const canvas = createCanvas(width, height);
      const context = canvas.getContext("2d");
      await page.render({ canvasContext: context, viewport }).promise;

      const png = await canvas.encode("png");
      const hash = createHash("sha256")
        .update(pdfData)
        .update(`${input.versionId}:${pageNumber}:${renderScale}`)
        .digest("hex")
        .slice(0, 16);
      const renderedImagePath = `${RENDERED_DIR}/floor-plan-version-${input.versionId}-${hash}.png`;
      const outputPath = resolve(process.cwd(), renderedImagePath);
      const tempPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
      await mkdir(dirname(outputPath), { recursive: true });
      try {
        await writeFile(tempPath, png);
        await rename(tempPath, outputPath);
      } catch (error) {
        await unlink(tempPath).catch(() => undefined);
        throw error;
      }
      return { renderedImagePath, outputPath, width, height };
    } finally {
      await document.destroy();
    }
  }

  renderedRoot() {
    return resolve(process.cwd(), RENDERED_DIR);
  }

  private installCanvasGlobals() {
    const target = globalThis as Record<string, unknown>;
    target.DOMMatrix ??= DOMMatrix;
    target.ImageData ??= ImageData;
    target.Path2D ??= Path2D;
  }

  private clampScale(width: number, height: number, requestedScale: number) {
    const edgeScale = Math.min(
      MAX_RENDERED_EDGE_PX / Math.max(width, 1),
      MAX_RENDERED_EDGE_PX / Math.max(height, 1),
    );
    const pixelScale = Math.sqrt(MAX_RENDERED_PIXELS / Math.max(width * height, 1));
    return Math.max(0.1, Math.min(requestedScale, edgeScale, pixelScale));
  }
}
