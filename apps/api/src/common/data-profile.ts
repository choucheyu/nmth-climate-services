import { DATA_PROFILES, type DataProfile } from "@nmth/shared";
import type { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";

export const DATA_PROFILE_SETTING_KEY = "data.activeProfile";

type PrismaLike = PrismaClient | PrismaService;

export function normalizeDataProfile(value: unknown): DataProfile {
  return DATA_PROFILES.includes(value as DataProfile) ? (value as DataProfile) : "REAL";
}

export async function getActiveDataProfile(prisma: PrismaLike): Promise<DataProfile> {
  const setting = await prisma.systemSetting.findUnique({ where: { key: DATA_PROFILE_SETTING_KEY } });
  if (!setting || typeof setting.value !== "object" || setting.value === null || Array.isArray(setting.value)) {
    return "REAL";
  }
  return normalizeDataProfile((setting.value as { profile?: unknown }).profile);
}

export function dataProfileMetadata(profile: DataProfile): { dataProfile: DataProfile } {
  return { dataProfile: profile };
}
