import { BadRequestException } from "@nestjs/common";
import type { Request } from "express";

export const FLOOR_PLAN_PDF_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const FLOOR_PLAN_PDF_UPLOAD_MAX_FIELD_BYTES = 1024;

const PDF_MIME_TYPES = new Set(["application/pdf", "application/x-pdf"]);

export function floorPlanPdfFileFilter(
  _request: Request,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void
): void {
  const extensionOk = file.originalname.toLowerCase().endsWith(".pdf");
  const mimeOk = PDF_MIME_TYPES.has(file.mimetype);
  if (!extensionOk || !mimeOk) {
    callback(new BadRequestException("Only PDF floor plan uploads are allowed"), false);
    return;
  }
  callback(null, true);
}
