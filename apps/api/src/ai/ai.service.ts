import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { assertDataProfileAllowed, assertScopedResourceIds, resolveScopedDataProfile } from "../common/access-scope";
import { writeAuditLog } from "../common/audit.util";
import type { RequestUser } from "../common/current-user.decorator";
import { summarizeNumbers } from "../common/statistics";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  async generateMonthlyReport(input: { exhibitionId: string; month: string; locale?: string }, user?: RequestUser) {
    const [year, month] = input.month.split("-").map(Number);
    const start = new Date(Date.UTC(year ?? new Date().getUTCFullYear(), (month ?? 1) - 1, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const exhibition = await this.prisma.exhibition.findUniqueOrThrow({ where: { id: input.exhibitionId } });
    assertDataProfileAllowed(user, exhibition.dataProfile);
    assertScopedResourceIds(user, { exhibitionId: input.exhibitionId });
    const dataProfile = await resolveScopedDataProfile(this.prisma, user, exhibition.dataProfile);
    const provider = this.config.get<string>("OPENAI_API_KEY")?.startsWith("fake") === false ? "openai-ready" : "deterministic";

    const job = await this.prisma.aiReportJob.upsert({
      where: { exhibitionId_month_provider: { exhibitionId: input.exhibitionId, month: input.month, provider } },
      update: { status: "running", parameters: { start, end, dataProfile } },
      create: {
        exhibitionId: input.exhibitionId,
        month: input.month,
        provider,
        status: "running",
        parameters: { start, end, dataProfile }
      }
    });

    const measurements = await this.prisma.measurement.findMany({
      where: { dataProfile, exhibitionId: input.exhibitionId, measuredAt: { gte: start, lt: end } },
      include: { device: true, zone: true }
    });
    const alerts = await this.prisma.alert.findMany({
      where: { dataProfile, exhibitionId: input.exhibitionId, triggeredAt: { gte: start, lt: end } }
    });
    const weather = await this.prisma.weatherObservation.findMany({
      where: { observedAt: { gte: start, lt: end } },
      take: 5000,
      orderBy: { observedAt: "asc" }
    });

    const temperature = summarizeNumbers(measurements.map((item) => item.temperatureC));
    const humidity = summarizeNumbers(measurements.map((item) => item.humidityPercent));
    const byDevice = new Map<string, typeof measurements>();
    for (const measurement of measurements) {
      const items = byDevice.get(measurement.device.deviceName) ?? [];
      items.push(measurement);
      byDevice.set(measurement.device.deviceName, items);
    }
    const deviceEvidence = Array.from(byDevice.entries()).map(([deviceName, items]) => {
      const h = summarizeNumbers(items.map((item) => item.humidityPercent));
      const setpointGapValues = items
        .filter((item) => item.dehumidifySetpoint !== null)
        .map((item) => Math.abs(item.humidityPercent - Number(item.dehumidifySetpoint)));
      return {
        deviceName,
        samples: items.length,
        humidityMin: h.min,
        humidityMax: h.max,
        humidityStddev: h.stddev,
        averageSetpointGap: summarizeNumbers(setpointGapValues).average,
        offlineRate: this.estimateOfflineRate(items.length, start, end)
      };
    });
    const longGapDevices = deviceEvidence.filter((item) => (item.averageSetpointGap ?? 0) >= 5);
    const fixedHourAnomalies = this.detectFixedHourAnomalies(measurements);

    const content = {
      summary: {
        samples: measurements.length,
        alertCount: alerts.length,
        criticalAlertCount: alerts.filter((alert) => alert.level === "critical").length,
        temperature,
        humidity,
        weatherSamples: weather.length
      },
      exceedanceTotalHours: alerts.length,
      deviceOfflineRates: deviceEvidence.map((item) => ({ deviceName: item.deviceName, offlineRate: item.offlineRate })),
      fluctuation: { temperatureRange: this.range(temperature), humidityRange: this.range(humidity) },
      setpointGapDevices: longGapDevices,
      weatherCorrelation: this.describeWeatherCorrelation(weather.length),
      fixedHourAnomalies,
      possibleCauses: this.possibleCauses(longGapDevices, fixedHourAnomalies),
      recommendations: this.recommendations(longGapDevices, alerts.length),
      limitations: [
        "The deterministic fallback uses stored measurements, alerts, and weather observations only.",
        "Correlation statements are descriptive and require curator or facility-engineering review.",
        "Synthetic target-approach data is excluded unless it exists in the stored measurement source set."
      ]
    };
    const summary = this.localizedSummary(input.locale ?? "zh-TW", content.summary.samples, alerts.length, longGapDevices.length);

    await this.prisma.$transaction([
      this.prisma.aiReportOutput.upsert({
        where: { jobId_locale: { jobId: job.id, locale: input.locale ?? "zh-TW" } },
        update: { summary, content: content as unknown as Prisma.InputJsonValue },
        create: { jobId: job.id, locale: input.locale ?? "zh-TW", summary, content: content as unknown as Prisma.InputJsonValue }
      }),
      this.prisma.aiReportEvidence.create({
        data: {
          jobId: job.id,
          key: "device_evidence",
          label: "Device statistics",
          value: deviceEvidence as Prisma.InputJsonValue
        }
      }),
      this.prisma.aiReportJob.update({
        where: { id: job.id },
        data: { status: "completed" }
      })
    ]);
    await writeAuditLog(this.prisma, {
      userId: user?.id,
      action: "ai.monthly_report.generate",
      entityType: "ai_report_job",
      entityId: job.id,
      after: { exhibitionId: input.exhibitionId, month: input.month, provider, dataProfile }
    });

    return { jobId: job.id, provider, dataProfile, summary, content };
  }

  private estimateOfflineRate(samples: number, start: Date, end: Date): number {
    const expected = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
    return Math.max(0, 1 - samples / expected);
  }

  private detectFixedHourAnomalies(measurements: Array<{ measuredAt: Date; humidityPercent: number }>) {
    const byHour = new Map<number, number[]>();
    measurements.forEach((item) => {
      const values = byHour.get(item.measuredAt.getHours()) ?? [];
      values.push(item.humidityPercent);
      byHour.set(item.measuredAt.getHours(), values);
    });
    return Array.from(byHour.entries())
      .map(([hour, values]) => ({ hour, averageHumidity: summarizeNumbers(values).average, samples: values.length }))
      .filter((item) => item.samples >= 3)
      .sort((a, b) => (b.averageHumidity ?? 0) - (a.averageHumidity ?? 0))
      .slice(0, 3);
  }

  private range(stats: { min: number | null; max: number | null }) {
    return stats.min === null || stats.max === null ? null : stats.max - stats.min;
  }

  private describeWeatherCorrelation(samples: number): string {
    return samples > 0
      ? "Weather observations are available for side-by-side review with indoor humidity swings."
      : "No external weather observations were available for this period; fallback sync should be checked.";
  }

  private possibleCauses(longGapDevices: unknown[], fixedHourAnomalies: unknown[]) {
    const causes = [];
    if (longGapDevices.length) causes.push("Persistent setpoint gap may indicate cabinet sealing, airflow, or dehumidifier capacity issues.");
    if (fixedHourAnomalies.length) causes.push("Repeated hour-of-day anomalies may relate to opening schedule, visitor flow, HVAC cycles, or maintenance events.");
    return causes.length ? causes : ["No deterministic cause signal exceeded the configured review threshold."];
  }

  private recommendations(longGapDevices: unknown[], alertCount: number) {
    const recommendations = ["Review device calibration validity and recent maintenance notes."];
    if (longGapDevices.length) recommendations.push("Inspect locations with persistent humidity-to-setpoint gap and compare against cabinet or zone conditions.");
    if (alertCount > 0) recommendations.push("Review acknowledged alerts and add event annotations for construction, opening, or HVAC work.");
    return recommendations;
  }

  private localizedSummary(locale: string, samples: number, alerts: number, gapDevices: number): string {
    if (locale === "en") {
      return `Generated from ${samples} measurements, ${alerts} alerts, and ${gapDevices} devices with persistent setpoint gap.`;
    }
    if (locale === "ja") {
      return `${samples} 件の測定、${alerts} 件のアラート、設定値との差が継続する ${gapDevices} 台の機器に基づく分析です。`;
    }
    return `本月報依據 ${samples} 筆量測、${alerts} 筆警報，以及 ${gapDevices} 台長期追不上設定值的設備產生。`;
  }
}
