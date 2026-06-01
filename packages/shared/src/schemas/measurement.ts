import { z } from "zod";
import { DATA_PROFILES, DEFAULT_PARSE_VERSION, SOURCE_TYPES } from "../domain/constants.js";

export const parsedMeasurementSchema = z.object({
  deviceName: z.string().min(1),
  measuredAt: z.coerce.date().optional(),
  dehumidifySetpoint: z.number().finite().nullable().optional(),
  temperatureC: z.number().finite(),
  humidityPercent: z.number().finite(),
  qualityFlags: z.array(z.string()).default([])
});

export const ingestMeasurementSchema = z.object({
  dataProfile: z.enum(DATA_PROFILES).default("REAL"),
  registration: z.string().min(1),
  rawPacket: z.object({
    protocol: z.string().default("usr-c215"),
    receivedAt: z.coerce.date().optional(),
    frameHex: z.string().min(1).optional(),
    payload: z.record(z.unknown()).optional()
  }),
  parsed: parsedMeasurementSchema,
  parseVersion: z.string().default(DEFAULT_PARSE_VERSION),
  source: z.enum(SOURCE_TYPES).default("real"),
  metadata: z.record(z.unknown()).default({})
});

export const profileImportMeasurementRowSchema = z.object({
  deviceName: z.string().min(1),
  displayName: z.string().min(1).optional(),
  measuredAt: z.coerce.date(),
  temperatureC: z.coerce.number(),
  humidityPercent: z.coerce.number(),
  dehumidifySetpoint: z.coerce.number().nullable().optional(),
  source: z.enum(SOURCE_TYPES).default("imported"),
  parseVersion: z.string().default(DEFAULT_PARSE_VERSION),
  exhibitionCode: z.string().min(1).optional(),
  exhibitionName: z.string().min(1).optional(),
  exhibitionStatus: z.string().min(1).default("active"),
  zoneCode: z.string().min(1).optional(),
  zoneName: z.string().min(1).optional(),
  pointType: z.string().min(1).default("ambient"),
  qualityFlags: z.array(z.string()).default(["profile_import"])
});

export const profileImportSchema = z
  .object({
    dataProfile: z.enum(DATA_PROFILES),
    rows: z.array(profileImportMeasurementRowSchema).optional(),
    csv: z.string().optional()
  })
  .refine((value) => Boolean(value.rows?.length) || Boolean(value.csv?.trim()), {
    message: "rows or csv is required"
  });

export const transitionalCollectorMeasurementSchema = z.object({
  date: z.string(),
  time: z.string(),
  deviceName: z.string(),
  dehumidifySetpoint: z.coerce.number().nullable().optional(),
  temperatureC: z.coerce.number(),
  humidityPercent: z.coerce.number()
});

export type ParsedMeasurementInput = z.infer<typeof parsedMeasurementSchema>;
export type IngestMeasurementInput = z.infer<typeof ingestMeasurementSchema>;
export type ProfileImportInput = z.infer<typeof profileImportSchema>;
export type ProfileImportMeasurementRowInput = z.infer<typeof profileImportMeasurementRowSchema>;
