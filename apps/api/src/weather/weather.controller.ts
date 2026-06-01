import { Controller, Get, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser, type RequestUser } from "../common/current-user.decorator";
import { RequirePermissions } from "../common/permissions.decorator";
import { WeatherService } from "./weather.service";

@ApiTags("weather")
@Controller("weather")
@RequirePermissions("dashboard:read")
export class WeatherController {
  constructor(private readonly weatherService: WeatherService) {}

  @Get("stations")
  stations() {
    return this.weatherService.stations();
  }

  @Get("observations")
  observations(@Query("stationId") stationId?: string) {
    return this.weatherService.observations(stationId);
  }

  @Get("current")
  current(
    @Query("stationId") stationId?: string,
    @Query("county") county?: string,
    @Query("town") town?: string
  ) {
    return this.weatherService.currentOutdoorWeather({ stationId, county, town });
  }

  @Post("sync")
  @RequirePermissions("system:manage")
  sync(@CurrentUser() user?: RequestUser) {
    return this.weatherService.syncCwaOrFallback(user);
  }
}
