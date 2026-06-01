import "reflect-metadata";
import { createWriteStream } from "node:fs";
import { mkdtemp, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { describe, expect, it } from "vitest";
import { FloorPlanRendererService } from "./floor-plan-renderer.service";

async function createFixturePdf() {
  const dir = await mkdtemp(join(tmpdir(), "nmth-floor-plan-render-"));
  const file = join(dir, "plan.pdf");
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: [320, 180], margin: 0 });
    const stream = createWriteStream(file);
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.pipe(stream);
    doc.rect(0, 0, 320, 180).fill("#ffffff");
    doc.rect(24, 32, 120, 72).fill("#004EA2");
    doc.rect(168, 54, 96, 64).fill("#B9D7EA");
    doc.end();
  });
  return file;
}

describe("FloorPlanRendererService", () => {
  it("renders a PDF page to an immutable PNG asset", async () => {
    const service = new FloorPlanRendererService();
    const pdfPath = await createFixturePdf();

    const result = await service.renderPdfPage({
      versionId: "version-render-test",
      pdfPath,
      pageNumber: 1,
      renderScale: 1,
    });

    const fileStat = await stat(result.outputPath);
    expect(result.renderedImagePath).toMatch(
      /^uploads\/floor-plans\/rendered\/floor-plan-version-version-render-test-[a-f0-9]{16}\.png$/,
    );
    expect(result.width).toBeGreaterThan(300);
    expect(result.height).toBeGreaterThan(170);
    expect(fileStat.size).toBeGreaterThan(1000);
    await unlink(result.outputPath).catch(() => undefined);
  });

  it("rejects invalid page numbers", async () => {
    const service = new FloorPlanRendererService();
    const pdfPath = await createFixturePdf();

    await expect(
      service.renderPdfPage({
        versionId: "version-render-test",
        pdfPath,
        pageNumber: 2,
        renderScale: 1,
      }),
    ).rejects.toThrow("exceeds page count");
  });
});
