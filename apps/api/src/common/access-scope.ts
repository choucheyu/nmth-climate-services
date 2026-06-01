import { ForbiddenException } from "@nestjs/common";
import { DATA_PROFILES, type DataProfile } from "@nmth/shared";
import type { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";
import type { RequestAccessScope, RequestUser } from "./current-user.decorator";
import { getActiveDataProfile, normalizeDataProfile } from "./data-profile";

type PrismaLike = PrismaClient | PrismaService;

const UNRESTRICTED_SCOPE: RequestAccessScope = {
  dataProfiles: null,
  exhibitionIds: [],
  zoneIds: []
};

export function normalizeAccessScope(input?: {
  allowedDataProfiles?: string[];
  dataProfiles?: string[] | null;
  exhibitionIds?: string[];
  zoneIds?: string[];
} | null): RequestAccessScope {
  if (!input) {
    return { ...UNRESTRICTED_SCOPE };
  }
  const rawProfiles = input.dataProfiles ?? input.allowedDataProfiles ?? null;
  const dataProfiles =
    rawProfiles && rawProfiles.length
      ? Array.from(new Set(rawProfiles.map((profile) => normalizeDataProfile(profile)).filter((profile) => DATA_PROFILES.includes(profile))))
      : null;
  return {
    dataProfiles,
    exhibitionIds: Array.from(new Set(input.exhibitionIds ?? [])),
    zoneIds: Array.from(new Set(input.zoneIds ?? []))
  };
}

export function accessScopeFor(user?: RequestUser): RequestAccessScope {
  return user?.accessScope ?? { ...UNRESTRICTED_SCOPE };
}

export function allowedDataProfilesFor(user?: RequestUser): DataProfile[] | null {
  return accessScopeFor(user).dataProfiles;
}

export function assertDataProfileAllowed(user: RequestUser | undefined, dataProfile: string): DataProfile {
  const normalized = normalizeDataProfile(dataProfile);
  const allowed = allowedDataProfilesFor(user);
  if (allowed?.length && !allowed.includes(normalized)) {
    throw new ForbiddenException("Data profile is outside the user's access scope");
  }
  return normalized;
}

export async function resolveScopedDataProfile(
  prisma: PrismaLike,
  user: RequestUser | undefined,
  requestedProfile?: string | null
): Promise<DataProfile> {
  const requested = requestedProfile ? normalizeDataProfile(requestedProfile) : null;
  const allowed = allowedDataProfilesFor(user);
  if (allowed?.length) {
    if (requested) {
      return assertDataProfileAllowed(user, requested);
    }
    const active = await getActiveDataProfile(prisma);
    return allowed.includes(active) ? active : allowed[0]!;
  }
  return requested ?? (await getActiveDataProfile(prisma));
}

export function assertScopedResourceIds(
  user: RequestUser | undefined,
  input: { exhibitionId?: string | null; zoneId?: string | null }
): void {
  const scope = accessScopeFor(user);
  if (input.exhibitionId && scope.exhibitionIds.length && !scope.exhibitionIds.includes(input.exhibitionId)) {
    throw new ForbiddenException("Exhibition is outside the user's access scope");
  }
  if (input.zoneId && scope.zoneIds.length && !scope.zoneIds.includes(input.zoneId)) {
    throw new ForbiddenException("Zone is outside the user's access scope");
  }
}

export function scopedIdFilter(
  user: RequestUser | undefined,
  field: "exhibitionId" | "zoneId",
  requested?: string | null
): string | { in: string[] } | undefined {
  const scope = accessScopeFor(user);
  const allowed = field === "exhibitionId" ? scope.exhibitionIds : scope.zoneIds;
  if (requested) {
    assertScopedResourceIds(user, field === "exhibitionId" ? { exhibitionId: requested } : { zoneId: requested });
    return requested;
  }
  if (!allowed.length) {
    return undefined;
  }
  return allowed.length === 1 ? allowed[0] : { in: allowed };
}
