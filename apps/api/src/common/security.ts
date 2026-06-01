import type { ConfigService } from "@nestjs/config";
import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

type RateRule = {
  windowMs: number;
  limit: number;
  group: string;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const ONE_MINUTE_MS = 60_000;
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const DEMO_SECRET_MARKERS = [
  "replace-with",
  "fake-",
  "demo",
  "password",
  "secret",
  "DemoPass123!",
  "nmth_password"
] as const;

export const CSRF_HEADER = "x-nmth-csrf";
export const SESSION_COOKIE_NAME = "__Host-nmth_session";
export const LEGACY_SESSION_COOKIE_NAME = "nmth_session";

export function assertProductionSecurityConfig(config: ConfigService): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const required = [
    "COOKIE_SECRET",
    "INGEST_API_TOKEN",
    "DATABASE_URL",
    "REDIS_URL",
    "WEB_ORIGIN",
    "SERVER_API_BASE_URL"
  ] as const;
  const failures: string[] = [];

  for (const key of required) {
    const value = config.get<string>(key)?.trim();
    if (!value) {
      failures.push(`${key} is required`);
      continue;
    }
    if ((key === "COOKIE_SECRET" || key === "INGEST_API_TOKEN") && value.length < 32) {
      failures.push(`${key} must be at least 32 characters`);
    }
    if ((key === "COOKIE_SECRET" || key === "INGEST_API_TOKEN" || key === "DATABASE_URL") && looksLikeDemoSecret(value)) {
      failures.push(`${key} still looks like a demo value`);
    }
  }

  if (failures.length) {
    throw new Error(`Production security configuration failed: ${failures.join("; ")}`);
  }
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function securityHeadersMiddleware(config: ConfigService) {
  const isProduction = process.env.NODE_ENV === "production";
  const hsts = config.get<string>("SECURITY_HSTS") ?? "max-age=31536000; includeSubDomains";
  return (_request: Request, response: Response, next: NextFunction) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    response.setHeader("X-Frame-Options", "DENY");
    if (isProduction) {
      response.setHeader("Strict-Transport-Security", hsts);
      response.setHeader("Content-Security-Policy", "default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    }
    next();
  };
}

export function csrfMiddleware(config: ConfigService) {
  const enabled = config.get<string>("CSRF_PROTECTION_ENABLED") === "true" || process.env.NODE_ENV === "production";
  const allowedOrigins = allowedWebOrigins(config);
  return (request: Request, response: Response, next: NextFunction) => {
    if (!enabled || !UNSAFE_METHODS.has(request.method) || isBearerIngestRequest(request)) {
      next();
      return;
    }

    const token = request.get(CSRF_HEADER);
    if (!token) {
      response.status(403).json({ statusCode: 403, message: "Missing CSRF header" });
      return;
    }

    const origin = request.get("origin");
    const referer = request.get("referer");
    const requestOrigin = origin ?? originFromReferer(referer);
    if (requestOrigin && !allowedOrigins.has(requestOrigin)) {
      response.status(403).json({ statusCode: 403, message: "Invalid request origin" });
      return;
    }
    if (process.env.NODE_ENV === "production" && !requestOrigin) {
      response.status(403).json({ statusCode: 403, message: "Missing request origin" });
      return;
    }

    next();
  };
}

export function rateLimitMiddleware(config: ConfigService) {
  const disabled = config.get<string>("RATE_LIMIT_DISABLED") === "true" && process.env.NODE_ENV !== "production";
  const buckets = new Map<string, Bucket>();
  const tokenHash = hashKey(config.get<string>("INGEST_API_TOKEN") ?? "");
  return (request: Request, response: Response, next: NextFunction) => {
    if (disabled) {
      next();
      return;
    }
    const rule = rateRuleForRequest(request, tokenHash);
    const now = Date.now();
    const clientKey = `${rule.group}:${clientIdentity(request)}`;
    const existing = buckets.get(clientKey);
    const bucket = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + rule.windowMs };
    bucket.count += 1;
    buckets.set(clientKey, bucket);

    if (bucket.count > rule.limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      response.setHeader("Retry-After", String(retryAfter));
      response.status(429).json({ statusCode: 429, message: "Too many requests" });
      return;
    }
    next();
  };
}

function rateRuleForRequest(request: Request, expectedTokenHash: string): RateRule {
  const path = request.path;
  if (path === "/api/auth/login") {
    return { group: "auth-login", windowMs: ONE_MINUTE_MS, limit: 10 };
  }
  if (path === "/api/ingest/measurements") {
    const token = bearerToken(request);
    const validToken = Boolean(token && expectedTokenHash && hashKey(token) === expectedTokenHash);
    return validToken
      ? { group: "collector-ingest", windowMs: ONE_MINUTE_MS, limit: 12_000 }
      : { group: "public-ingest-invalid", windowMs: ONE_MINUTE_MS, limit: 60 };
  }
  if (path.includes("/floor-plans/") && path.endsWith("/versions") && request.method === "POST") {
    return { group: "floor-plan-upload", windowMs: ONE_MINUTE_MS, limit: 20 };
  }
  if (path === "/api/reports/export") {
    return { group: "report-export", windowMs: ONE_MINUTE_MS, limit: 30 };
  }
  if (UNSAFE_METHODS.has(request.method)) {
    return { group: "unsafe-api", windowMs: ONE_MINUTE_MS, limit: 600 };
  }
  return { group: "read-api", windowMs: ONE_MINUTE_MS, limit: 1800 };
}

function isBearerIngestRequest(request: Request): boolean {
  return request.path === "/api/ingest/measurements" && Boolean(bearerToken(request));
}

function bearerToken(request: Request): string | null {
  const header = request.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function clientIdentity(request: Request): string {
  const token = bearerToken(request);
  if (token) {
    return `token:${hashKey(token)}`;
  }
  return `ip:${request.ip || request.socket.remoteAddress || "unknown"}`;
}

function hashKey(value: string): string {
  return value ? createHash("sha256").update(value).digest("base64url") : "";
}

function allowedWebOrigins(config: ConfigService): Set<string> {
  const origins = [config.get<string>("WEB_ORIGIN") ?? "http://localhost:3000"]
    .flatMap((value) => value.split(","))
    .map((value) => normalizeOrigin(value))
    .filter((value): value is string => Boolean(value));
  return new Set(origins);
}

function originFromReferer(referer?: string): string | null {
  return normalizeOrigin(referer);
}

function normalizeOrigin(value?: string): string | null {
  if (!value?.trim()) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function looksLikeDemoSecret(value: string): boolean {
  const normalized = value.toLowerCase();
  return DEMO_SECRET_MARKERS.some((marker) => normalized.includes(marker.toLowerCase()));
}
