import { BadRequestException, Body, Controller, Headers, Post, ServiceUnavailableException, Sse, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiTags } from "@nestjs/swagger";
import { Observable } from "rxjs";
import { CurrentUser, type RequestUser } from "../common/current-user.decorator";
import { RequirePermissions } from "../common/permissions.decorator";
import { Public } from "../common/public.decorator";
import { constantTimeEqual } from "../common/security";
import { IngestService } from "./ingest.service";

@ApiTags("ingest")
@Controller("ingest")
export class IngestController {
  constructor(
    private readonly ingestService: IngestService,
    private readonly config: ConfigService
  ) {}

  @Public()
  @Post("measurements")
  async ingest(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string
  ) {
    this.assertIngestToken(authorization);
    return this.ingestService.ingest(body);
  }

  @RequirePermissions("ingest:write")
  @Post("import/usr-c215")
  importCollector(@Body() body: { url?: string; dataProfile?: "DEMO" | "REAL" }, @CurrentUser() user?: RequestUser) {
    const baseUrl = this.config.get<string>("COLLECTOR_BASE_URL") ?? (process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:8088");
    if (!body.url && !baseUrl) {
      throw new BadRequestException("COLLECTOR_BASE_URL is required for collector import");
    }
    const url = body.url ?? `${baseUrl.replace(/\/$/, "")}/api/measurements`;
    return this.ingestService.importFromCollector(url, body.dataProfile ?? "REAL", user);
  }

  @RequirePermissions("ingest:write")
  @Post("import/profile-measurements")
  importProfileMeasurements(@Body() body: unknown, @CurrentUser() user?: RequestUser) {
    return this.ingestService.importProfileMeasurements(body, user);
  }

  @RequirePermissions("ingest:write")
  @Sse("stream")
  stream(): Observable<{ data: unknown }> {
    return this.ingestService.stream();
  }

  private assertIngestToken(authorization: string | undefined): void {
    const expected = this.config.get<string>("INGEST_API_TOKEN");
    if (!expected) {
      if (this.config.get<string>("ALLOW_UNAUTHENTICATED_INGEST") === "true" && process.env.NODE_ENV !== "production") {
        return;
      }
      throw new ServiceUnavailableException("Ingest token is not configured");
    }
    const token = authorization?.replace(/^Bearer\s+/i, "");
    if (!token || !constantTimeEqual(token, expected)) {
      throw new UnauthorizedException("Invalid ingest token");
    }
  }
}
