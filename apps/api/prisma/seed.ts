import { PrismaClient, type Prisma } from "@prisma/client";
import * as argon2 from "argon2";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, type RoleName } from "@nmth/shared";

const prisma = new PrismaClient();
const demoPassword = "DemoPass123!";
const DEMO_PROFILE = "DEMO";

const demoUsers: Array<{ email: string; name: string; role: RoleName }> = [
  { email: "viewer@example.local", name: "Demo Viewer", role: "Viewer" },
  { email: "operator@example.local", name: "Demo Operator", role: "Operator" },
  { email: "manager@example.local", name: "Demo Manager", role: "Manager" },
  { email: "admin@example.local", name: "Demo Admin", role: "Admin" },
  { email: "superadmin@example.local", name: "NMTH Super Admin", role: "SuperAdmin" }
];

const exhibitions = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    code: "NMTH-CLIMATE-SEED",
    name: "常設展環境監測",
    owner: "Collection Care Team",
    preservationGoal: "Monitor relative humidity stability by exhibition zone, showcase type, and external weather context.",
    startDate: new Date("2026-01-01T00:00:00+08:00"),
    zones: [
      { id: "11000000-0000-4000-8000-000000000001", code: "A", name: "展區 A", description: "入口與大型展櫃" },
      { id: "11000000-0000-4000-8000-000000000002", code: "B", name: "展區 B", description: "中段文物展櫃" }
    ],
    floorPlan: {
      id: "12000000-0000-4000-8000-000000000001",
      versionId: "13000000-0000-4000-8000-000000000001",
      name: "常設展一樓平面圖",
      pdfOriginalPath: "demo/floorplans/permanent-gallery-placeholder.pdf"
    },
    devices: [
      {
        id: "14000000-0000-4000-8000-000000000001",
        deviceName: "00001",
        displayName: "入口環境點 00001",
        ipAddress: "192.0.2.11",
        macAddress: "00:1A:2B:00:00:01",
        zoneId: "11000000-0000-4000-8000-000000000001",
        pointType: "ambient",
        xRatio: 0.18,
        yRatio: 0.28
      },
      {
        id: "14000000-0000-4000-8000-000000000002",
        deviceName: "00003",
        displayName: "展櫃 A-03",
        ipAddress: "192.0.2.13",
        macAddress: "00:1A:2B:00:00:03",
        zoneId: "11000000-0000-4000-8000-000000000001",
        pointType: "showcase",
        xRatio: 0.43,
        yRatio: 0.37
      },
      {
        id: "14000000-0000-4000-8000-000000000003",
        deviceName: "00005",
        displayName: "展區 B 環境點",
        ipAddress: "192.0.2.15",
        macAddress: "00:1A:2B:00:00:05",
        zoneId: "11000000-0000-4000-8000-000000000002",
        pointType: "ambient",
        xRatio: 0.69,
        yRatio: 0.56
      }
    ]
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    code: "NMTH-SPECIAL-2026",
    name: "特展庫房借展環境監測",
    owner: "Exhibition Operations",
    preservationGoal: "Validate loan-object microclimate stability and quick response for temporary galleries.",
    startDate: new Date("2026-03-15T00:00:00+08:00"),
    zones: [
      { id: "11000000-0000-4000-8000-000000000003", code: "T1", name: "特展入口", description: "開放展區與人流入口" },
      { id: "11000000-0000-4000-8000-000000000004", code: "T2", name: "借展文物區", description: "高敏感度文物展櫃" }
    ],
    floorPlan: {
      id: "12000000-0000-4000-8000-000000000002",
      versionId: "13000000-0000-4000-8000-000000000002",
      name: "特展二樓平面圖",
      pdfOriginalPath: "demo/floorplans/special-gallery-placeholder.pdf"
    },
    devices: [
      {
        id: "14000000-0000-4000-8000-000000000004",
        deviceName: "10001",
        displayName: "特展入口環境點",
        ipAddress: "192.0.2.21",
        macAddress: "00:1A:2B:00:10:01",
        zoneId: "11000000-0000-4000-8000-000000000003",
        pointType: "ambient",
        xRatio: 0.2,
        yRatio: 0.64
      },
      {
        id: "14000000-0000-4000-8000-000000000005",
        deviceName: "10003",
        displayName: "借展展櫃 T2-03",
        ipAddress: "192.0.2.23",
        macAddress: "00:1A:2B:00:10:03",
        zoneId: "11000000-0000-4000-8000-000000000004",
        pointType: "showcase",
        xRatio: 0.51,
        yRatio: 0.34
      },
      {
        id: "14000000-0000-4000-8000-000000000006",
        deviceName: "10005",
        displayName: "借展展櫃 T2-05",
        ipAddress: "192.0.2.25",
        macAddress: "00:1A:2B:00:10:05",
        zoneId: "11000000-0000-4000-8000-000000000004",
        pointType: "showcase",
        xRatio: 0.78,
        yRatio: 0.46
      }
    ]
  }
] as const;

async function seedRbac() {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission },
      update: { description: permission },
      create: { key: permission, description: permission }
    });
  }

  for (const roleName of ROLES) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: { description: roleName === "SuperAdmin" ? "Super Admin" : roleName },
      create: { name: roleName, description: roleName === "SuperAdmin" ? "Super Admin" : roleName }
    });
    const expectedPermissionIds: string[] = [];
    for (const permissionKey of ROLE_PERMISSIONS[roleName]) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { key: permissionKey } });
      expectedPermissionIds.push(permission.id);
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id }
      });
    }
    await prisma.rolePermission.deleteMany({
      where: { roleId: role.id, permissionId: { notIn: expectedPermissionIds } }
    });
  }

  const passwordHash = await argon2.hash(demoPassword);
  for (const demoUser of demoUsers) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: demoUser.role } });
    const user = await prisma.user.upsert({
      where: { email: demoUser.email },
      update: {
        name: demoUser.name,
        enabled: true,
        locale: "zh-TW",
        passwordHash
      },
      create: {
        email: demoUser.email,
        name: demoUser.name,
        locale: "zh-TW",
        passwordHash
      }
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id }
    });
    if (demoUser.email === "viewer@example.local") {
      await prisma.userAccessScope.upsert({
        where: { userId: user.id },
        update: { allowedDataProfiles: [DEMO_PROFILE], exhibitionIds: [], zoneIds: [] },
        create: { userId: user.id, allowedDataProfiles: [DEMO_PROFILE], exhibitionIds: [], zoneIds: [] }
      });
    }
  }
}

async function seedMuseumContext() {
  const group = await prisma.deviceGroup.upsert({
    where: { code: "USR-C215" },
    update: { name: "USR-C215 溫濕度設備" },
    create: { code: "USR-C215", name: "USR-C215 溫濕度設備" }
  });

  const threshold = await prisma.thresholdProfile.upsert({
    where: { id: "11111111-1111-4111-8111-111111111111" },
    update: {
      name: "Museum conservation demo threshold",
      warningTemperatureMin: 18,
      warningTemperatureMax: 25,
      criticalTemperatureMin: 15,
      criticalTemperatureMax: 30,
      warningHumidityMin: 50,
      warningHumidityMax: 60,
      criticalHumidityMin: 35,
      criticalHumidityMax: 70,
      triggerDurationMinutes: 10,
      repeatIntervalMinutes: 60,
      maxNotifications: 3,
      unresolvedReminderMinutes: 1440
    },
    create: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Museum conservation demo threshold",
      description: "Default warning/critical thresholds for local demonstration data.",
      warningTemperatureMin: 18,
      warningTemperatureMax: 25,
      criticalTemperatureMin: 15,
      criticalTemperatureMax: 30,
      warningHumidityMin: 50,
      warningHumidityMax: 60,
      criticalHumidityMin: 35,
      criticalHumidityMax: 70,
      triggerDurationMinutes: 10,
      recoveryDurationMinutes: 10,
      hysteresis: 1,
      repeatIntervalMinutes: 60,
      maxNotifications: 3,
      unresolvedReminderMinutes: 1440
    }
  });

  const superAdmin = await prisma.user.findUniqueOrThrow({ where: { email: "superadmin@example.local" } });
  const deviceMap = new Map<string, { id: string; exhibitionId: string; zoneId: string }>();

  for (const exhibitionSeed of exhibitions) {
    await prisma.exhibition.updateMany({
      where: { id: exhibitionSeed.id },
      data: { dataProfile: DEMO_PROFILE }
    });
    const exhibition = await prisma.exhibition.upsert({
      where: { dataProfile_code: { dataProfile: DEMO_PROFILE, code: exhibitionSeed.code } },
      update: {
        dataProfile: DEMO_PROFILE,
        name: exhibitionSeed.name,
        status: "active",
        owner: exhibitionSeed.owner,
        preservationGoal: exhibitionSeed.preservationGoal,
        startDate: exhibitionSeed.startDate
      },
      create: {
        id: exhibitionSeed.id,
        dataProfile: DEMO_PROFILE,
        code: exhibitionSeed.code,
        name: exhibitionSeed.name,
        status: "active",
        owner: exhibitionSeed.owner,
        preservationGoal: exhibitionSeed.preservationGoal,
        startDate: exhibitionSeed.startDate
      }
    });

    for (const zoneSeed of exhibitionSeed.zones) {
      await prisma.exhibitionZone.upsert({
        where: { exhibitionId_code: { exhibitionId: exhibition.id, code: zoneSeed.code } },
        update: { name: zoneSeed.name, description: zoneSeed.description },
        create: {
          id: zoneSeed.id,
          exhibitionId: exhibition.id,
          code: zoneSeed.code,
          name: zoneSeed.name,
          description: zoneSeed.description
        }
      });
    }

    await prisma.thresholdAssignment.upsert({
      where: { id: exhibitionSeed.id.replace("10000000", "15000000") },
      update: { profileId: threshold.id, exhibitionId: exhibition.id, priority: 100 },
      create: {
        id: exhibitionSeed.id.replace("10000000", "15000000"),
        profileId: threshold.id,
        exhibitionId: exhibition.id,
        priority: 100
      }
    });

    await prisma.floorPlan.updateMany({
      where: { id: exhibitionSeed.floorPlan.id },
      data: { dataProfile: DEMO_PROFILE }
    });
    const floorPlan = await prisma.floorPlan.upsert({
      where: { id: exhibitionSeed.floorPlan.id },
      update: { dataProfile: DEMO_PROFILE, exhibitionId: exhibition.id, name: exhibitionSeed.floorPlan.name },
      create: { id: exhibitionSeed.floorPlan.id, dataProfile: DEMO_PROFILE, exhibitionId: exhibition.id, name: exhibitionSeed.floorPlan.name }
    });
    const version = await prisma.floorPlanVersion.upsert({
      where: { floorPlanId_version: { floorPlanId: floorPlan.id, version: 1 } },
      update: {
        pdfOriginalPath: exhibitionSeed.floorPlan.pdfOriginalPath,
        renderedImagePath: null,
        width: 1600,
        height: 900,
        createdByUserId: superAdmin.id
      },
      create: {
        id: exhibitionSeed.floorPlan.versionId,
        floorPlanId: floorPlan.id,
        version: 1,
        pdfOriginalPath: exhibitionSeed.floorPlan.pdfOriginalPath,
        renderedImagePath: null,
        pageNumber: 1,
        width: 1600,
        height: 900,
        createdByUserId: superAdmin.id
      }
    });
    await prisma.floorPlan.update({ where: { id: floorPlan.id }, data: { activeVersionId: version.id } });

    for (const [pointIndex, deviceSeed] of exhibitionSeed.devices.entries()) {
      await prisma.device.updateMany({
        where: { id: deviceSeed.id },
        data: { dataProfile: DEMO_PROFILE }
      });
      const device = await prisma.device.upsert({
        where: { dataProfile_deviceName: { dataProfile: DEMO_PROFILE, deviceName: deviceSeed.deviceName } },
        update: {
          dataProfile: DEMO_PROFILE,
          displayName: deviceSeed.displayName,
          ipAddress: deviceSeed.ipAddress,
          macAddress: deviceSeed.macAddress,
          exhibitionId: exhibition.id,
          zoneId: deviceSeed.zoneId,
          groupId: group.id,
          pointType: deviceSeed.pointType,
          enabled: true,
          archivedAt: null,
          metadata: { protocol: "USR-C215", demo: true }
        },
        create: {
          id: deviceSeed.id,
          dataProfile: DEMO_PROFILE,
          deviceName: deviceSeed.deviceName,
          displayName: deviceSeed.displayName,
          ipAddress: deviceSeed.ipAddress,
          macAddress: deviceSeed.macAddress,
          exhibitionId: exhibition.id,
          zoneId: deviceSeed.zoneId,
          groupId: group.id,
          pointType: deviceSeed.pointType,
          enabled: true,
          metadata: { protocol: "USR-C215", demo: true }
        }
      });
      deviceMap.set(device.deviceName, { id: device.id, exhibitionId: exhibition.id, zoneId: deviceSeed.zoneId });

      await prisma.thresholdAssignment.upsert({
        where: { id: `15100000-0000-4000-8000-${device.id.slice(-12)}` },
        update: {
          profileId: threshold.id,
          exhibitionId: exhibition.id,
          zoneId: deviceSeed.zoneId,
          deviceId: device.id,
          priority: 1
        },
        create: {
          id: `15100000-0000-4000-8000-${device.id.slice(-12)}`,
          profileId: threshold.id,
          exhibitionId: exhibition.id,
          zoneId: deviceSeed.zoneId,
          deviceId: device.id,
          priority: 1
        }
      });

      await prisma.floorPlanPoint.upsert({
        where: { id: `16000000-0000-4000-8000-${String(Number(exhibitionSeed.id.slice(-1)) * 10 + pointIndex).padStart(12, "0")}` },
        update: {
          floorPlanId: floorPlan.id,
          versionId: version.id,
          zoneId: deviceSeed.zoneId,
          deviceId: device.id,
          name: device.displayName,
          xRatio: deviceSeed.xRatio,
          yRatio: deviceSeed.yRatio,
          thresholdProfileId: threshold.id,
          displayStyle: { labelPosition: pointIndex % 2 === 0 ? "right" : "left" }
        },
        create: {
          id: `16000000-0000-4000-8000-${String(Number(exhibitionSeed.id.slice(-1)) * 10 + pointIndex).padStart(12, "0")}`,
          floorPlanId: floorPlan.id,
          versionId: version.id,
          zoneId: deviceSeed.zoneId,
          deviceId: device.id,
          name: device.displayName,
          xRatio: deviceSeed.xRatio,
          yRatio: deviceSeed.yRatio,
          thresholdProfileId: threshold.id,
          displayStyle: { labelPosition: pointIndex % 2 === 0 ? "right" : "left" }
        }
      });
    }
  }

  return deviceMap;
}

async function seedMeasurements(deviceMap: Map<string, { id: string; exhibitionId: string; zoneId: string }>) {
  const baseNow = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
  const deviceNames = Array.from(deviceMap.keys());
  await prisma.measurement.updateMany({
    where: { deviceId: { in: Array.from(deviceMap.values()).map((device) => device.id) } },
    data: { dataProfile: DEMO_PROFILE }
  });
  const rows: Prisma.MeasurementCreateManyInput[] = [];
  const rawPackets: Prisma.DeviceRawPacketCreateManyInput[] = [];

  for (const [deviceIndex, deviceName] of deviceNames.entries()) {
    const device = deviceMap.get(deviceName)!;
    for (let index = 0; index <= 128; index += 1) {
      const measuredAt = new Date(baseNow.getTime() - (128 - index) * 15 * 60_000);
      if (deviceName === "10005" && index > 114) {
        continue;
      }
      const humidityBump = deviceName === "00003" && index > 112 ? 9 : 0;
      const temperatureC = 23.1 + Math.sin(index / 7 + deviceIndex) * 1.3 + deviceIndex * 0.12;
      const humidityPercent = 54 + Math.cos(index / 9 + deviceIndex) * 4.8 + humidityBump + (deviceName === "10003" ? 2.2 : 0);
      const dehumidifySetpoint = 52 + (deviceIndex % 3);
      rows.push({
        measuredAt,
        dataProfile: DEMO_PROFILE,
        deviceId: device.id,
        exhibitionId: device.exhibitionId,
        zoneId: device.zoneId,
        source: "real",
        temperatureC,
        humidityPercent,
        dehumidifySetpoint,
        qualityFlags: [],
        parseVersion: "usr-c215-v1",
        metadata: { seed: true, deviceName }
      });

      if (index % 32 === 0 || index === 128) {
        rawPackets.push({
          id: `17000000-0000-4000-8000-${String(deviceIndex * 1000 + index).padStart(12, "0")}`,
          receivedAt: measuredAt,
          deviceId: device.id,
          registration: deviceName,
          protocol: "usr-c215-demo-seed",
          payload: { deviceName, temperatureC, humidityPercent, dehumidifySetpoint },
          parseVersion: "usr-c215-v1",
          parseStatus: "parsed"
        });
      }
    }
  }

  await prisma.deviceRawPacket.createMany({ data: rawPackets, skipDuplicates: true });
  await prisma.measurement.createMany({ data: rows, skipDuplicates: true });

  for (const [deviceIndex, deviceName] of deviceNames.entries()) {
    const device = deviceMap.get(deviceName)!;
    await prisma.device.update({
      where: { id: device.id },
      data: {
        lastSeenAt: deviceName === "10005" ? new Date(baseNow.getTime() - 4 * 60 * 60_000) : new Date(baseNow.getTime() - (deviceIndex + 1) * 60_000),
        lastParseStatus: "parsed"
      }
    });
  }

  const importedDevice = deviceMap.get("00001")!;
  const importTime = new Date(baseNow.getTime() - 90 * 60_000);
  await prisma.measurement.upsert({
    where: {
      deviceId_measuredAt_dataProfile_source_parseVersion: {
        deviceId: importedDevice.id,
        measuredAt: importTime,
        dataProfile: DEMO_PROFILE,
        source: "imported",
        parseVersion: "usr-c215-v1"
      }
    },
    update: {},
    create: {
      measuredAt: importTime,
      dataProfile: DEMO_PROFILE,
      deviceId: importedDevice.id,
      exhibitionId: importedDevice.exhibitionId,
      zoneId: importedDevice.zoneId,
      source: "imported",
      temperatureC: 23.4,
      humidityPercent: 55.8,
      dehumidifySetpoint: 52,
      qualityFlags: ["imported_from_collector_api"],
      parseVersion: "usr-c215-v1",
      metadata: {
        original: {
          date: importTime.toISOString().slice(0, 10),
          time: importTime.toISOString().slice(11, 19),
          deviceName: "00001",
          dehumidifySetpoint: 52,
          temperatureC: 23.4,
          humidityPercent: 55.8
        }
      }
    }
  });

  const compensationDevice = deviceMap.get("10005")!;
  const superAdmin = await prisma.user.findUniqueOrThrow({ where: { email: "superadmin@example.local" } });
  const compensation = await prisma.measurementAdjustment.upsert({
    where: { id: "18000000-0000-4000-8000-000000000001" },
    update: {
      reason: "Demo offline gap compensation",
      operatorUserId: superAdmin.id,
      sourceRange: { start: new Date(baseNow.getTime() - 165 * 60_000), end: new Date(baseNow.getTime() - 135 * 60_000) }
    },
    create: {
      id: "18000000-0000-4000-8000-000000000001",
      type: "compensation",
      method: "linear_interpolation",
      reason: "Demo offline gap compensation",
      operatorUserId: superAdmin.id,
      sourceRange: { start: new Date(baseNow.getTime() - 165 * 60_000), end: new Date(baseNow.getTime() - 135 * 60_000) },
      parameters: { expectedIntervalSeconds: 900 }
    }
  });
  const compensatedRows: Prisma.MeasurementCreateManyInput[] = [165, 150, 135].map((minutes, index) => ({
    measuredAt: new Date(baseNow.getTime() - minutes * 60_000),
    dataProfile: DEMO_PROFILE,
    deviceId: compensationDevice.id,
    exhibitionId: compensationDevice.exhibitionId,
    zoneId: compensationDevice.zoneId,
    source: "compensated",
    temperatureC: 23.2 + index * 0.1,
    humidityPercent: 56.2 + index * 0.4,
    dehumidifySetpoint: 54,
    qualityFlags: ["compensated", "linear_interpolation"],
    parseVersion: "usr-c215-v1",
    operatorUserId: superAdmin.id,
    adjustmentId: compensation.id,
    reason: "Demo offline gap compensation",
    method: "linear_interpolation",
    metadata: { demo: true, traceableAdjustmentId: compensation.id }
  }));
  await prisma.measurement.createMany({ data: compensatedRows, skipDuplicates: true });

  const derivedDevice = deviceMap.get("00003")!;
  const derived = await prisma.measurementAdjustment.upsert({
    where: { id: "18000000-0000-4000-8000-000000000002" },
    update: {
      reason: "Demo humidity target approach derivation",
      operatorUserId: superAdmin.id,
      sourceRange: { start: new Date(baseNow.getTime() - 6 * 60 * 60_000), end: baseNow }
    },
    create: {
      id: "18000000-0000-4000-8000-000000000002",
      type: "derived",
      method: "humidity_moves_toward_dehumidify_setpoint",
      reason: "Demo humidity target approach derivation",
      operatorUserId: superAdmin.id,
      sourceRange: { start: new Date(baseNow.getTime() - 6 * 60 * 60_000), end: baseNow },
      parameters: { approachFactor: 0.65 }
    }
  });
  const sourceMeasurements = await prisma.measurement.findMany({
    where: {
      deviceId: derivedDevice.id,
      dataProfile: DEMO_PROFILE,
      measuredAt: { gte: new Date(baseNow.getTime() - 3 * 60 * 60_000), lte: baseNow },
      source: "real"
    },
    orderBy: { measuredAt: "asc" },
    take: 12
  });
  await prisma.measurement.createMany({
    data: sourceMeasurements.map((measurement) => {
      const target = measurement.dehumidifySetpoint ?? 52;
      return {
        measuredAt: measurement.measuredAt,
        dataProfile: DEMO_PROFILE,
        deviceId: derivedDevice.id,
        exhibitionId: derivedDevice.exhibitionId,
        zoneId: derivedDevice.zoneId,
        source: "derived",
        temperatureC: measurement.temperatureC,
        humidityPercent: measurement.humidityPercent + (target - measurement.humidityPercent) * 0.65,
        dehumidifySetpoint: measurement.dehumidifySetpoint,
        qualityFlags: ["derived_target_approach", "not_device_measurement"],
        parseVersion: "usr-c215-v1",
        operatorUserId: superAdmin.id,
        adjustmentId: derived.id,
        reason: "Demo humidity target approach derivation",
        method: "humidity_moves_toward_dehumidify_setpoint",
        metadata: { sourceMeasurementId: measurement.id, traceableAdjustmentId: derived.id }
      };
    }),
    skipDuplicates: true
  });
}

async function seedAlertsAndOperations(deviceMap: Map<string, { id: string; exhibitionId: string; zoneId: string }>) {
  const now = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const operator = await prisma.user.findUniqueOrThrow({ where: { email: "operator@example.local" } });
  const warningDevice = deviceMap.get("00003")!;
  const offlineDevice = deviceMap.get("10005")!;
  const criticalDevice = deviceMap.get("10003")!;

  const warningAlert = await prisma.alert.upsert({
    where: { id: "19000000-0000-4000-8000-000000000001" },
    update: {
      dataProfile: DEMO_PROFILE,
      status: "active",
      level: "warning",
      triggeredAt: new Date(now.getTime() - 55 * 60_000),
      message: "展櫃 A-03 humidity is above warning threshold.",
      metadata: {
        seed: true,
        thresholdMetric: "humidity",
        thresholdDirection: "above",
        thresholdLimit: 60,
        exceededMinutes: 55,
        notificationCount: 1,
        maxNotifications: 3,
        nextReminderAt: new Date(now.getTime() + 5 * 60_000).toISOString()
      }
    },
    create: {
      id: "19000000-0000-4000-8000-000000000001",
      dataProfile: DEMO_PROFILE,
      exhibitionId: warningDevice.exhibitionId,
      zoneId: warningDevice.zoneId,
      deviceId: warningDevice.id,
      type: "humidity_threshold",
      level: "warning",
      status: "active",
      title: "Humidity threshold exceeded",
      message: "展櫃 A-03 humidity is above warning threshold.",
      triggeredAt: new Date(now.getTime() - 55 * 60_000),
      metadata: {
        seed: true,
        thresholdMetric: "humidity",
        thresholdDirection: "above",
        thresholdLimit: 60,
        exceededMinutes: 55,
        notificationCount: 1,
        maxNotifications: 3,
        nextReminderAt: new Date(now.getTime() + 5 * 60_000).toISOString()
      }
    }
  });

  const criticalAlert = await prisma.alert.upsert({
    where: { id: "19000000-0000-4000-8000-000000000002" },
    update: {
      dataProfile: DEMO_PROFILE,
      status: "acknowledged",
      level: "critical",
      triggeredAt: new Date(now.getTime() - 4 * 60 * 60_000),
      message: "借展展櫃 T2-03 humidity exceeded critical demo threshold.",
      metadata: {
        seed: true,
        thresholdMetric: "humidity",
        thresholdDirection: "above",
        thresholdLimit: 60,
        exceededMinutes: 240,
        notificationCount: 2,
        maxNotifications: 3,
        nextReminderAt: new Date(now.getTime() + 60 * 60_000).toISOString()
      }
    },
    create: {
      id: "19000000-0000-4000-8000-000000000002",
      dataProfile: DEMO_PROFILE,
      exhibitionId: criticalDevice.exhibitionId,
      zoneId: criticalDevice.zoneId,
      deviceId: criticalDevice.id,
      type: "humidity_threshold",
      level: "critical",
      status: "acknowledged",
      title: "Critical humidity threshold exceeded",
      message: "借展展櫃 T2-03 humidity exceeded critical demo threshold.",
      triggeredAt: new Date(now.getTime() - 4 * 60 * 60_000),
      metadata: {
        seed: true,
        thresholdMetric: "humidity",
        thresholdDirection: "above",
        thresholdLimit: 60,
        exceededMinutes: 240,
        notificationCount: 2,
        maxNotifications: 3,
        nextReminderAt: new Date(now.getTime() + 60 * 60_000).toISOString()
      }
    }
  });

  const offlineAlert = await prisma.alert.upsert({
    where: { id: "19000000-0000-4000-8000-000000000003" },
    update: {
      dataProfile: DEMO_PROFILE,
      status: "active",
      triggeredAt: new Date(now.getTime() - 3 * 60 * 60_000),
      message: "借展展櫃 T2-05 has no recent measurement."
    },
    create: {
      id: "19000000-0000-4000-8000-000000000003",
      dataProfile: DEMO_PROFILE,
      exhibitionId: offlineDevice.exhibitionId,
      zoneId: offlineDevice.zoneId,
      deviceId: offlineDevice.id,
      type: "device_offline",
      level: "warning",
      status: "active",
      title: "Device offline",
      message: "借展展櫃 T2-05 has no recent measurement.",
      triggeredAt: new Date(now.getTime() - 3 * 60 * 60_000),
      metadata: { seed: true, cutoffMinutes: 3 }
    }
  });

  await prisma.alertEvent.createMany({
    data: [
      {
        id: "19100000-0000-4000-8000-000000000001",
        alertId: warningAlert.id,
        eventType: "triggered",
        level: "warning",
        message: warningAlert.message,
        payload: { seed: true }
      },
      {
        id: "19100000-0000-4000-8000-000000000002",
        alertId: criticalAlert.id,
        eventType: "acknowledged",
        level: "critical",
        message: "Operator acknowledged during seed demo.",
        payload: { seed: true }
      },
      {
        id: "19100000-0000-4000-8000-000000000003",
        alertId: offlineAlert.id,
        eventType: "triggered",
        level: "warning",
        message: offlineAlert.message,
        payload: { seed: true }
      }
    ],
    skipDuplicates: true
  });

  await prisma.alertAcknowledgement.upsert({
    where: { id: "19200000-0000-4000-8000-000000000001" },
    update: { note: "Demo acknowledgement: checked display case and notified duty staff.", userId: operator.id },
    create: {
      id: "19200000-0000-4000-8000-000000000001",
      alertId: criticalAlert.id,
      userId: operator.id,
      note: "Demo acknowledgement: checked display case and notified duty staff."
    }
  });

  await prisma.deviceStatusEvent.upsert({
    where: { id: "19300000-0000-4000-8000-000000000001" },
    update: {
      deviceId: offlineDevice.id,
      status: "offline",
      reason: "Seeded demo offline state",
      startedAt: new Date(now.getTime() - 4 * 60 * 60_000)
    },
    create: {
      id: "19300000-0000-4000-8000-000000000001",
      deviceId: offlineDevice.id,
      status: "offline",
      reason: "Seeded demo offline state",
      startedAt: new Date(now.getTime() - 4 * 60 * 60_000),
      metadata: { seed: true }
    }
  });

  for (const type of ["email", "line", "discord", "telegram"]) {
    await prisma.notificationChannel.upsert({
      where: { type_name: { type, name: `${type} demo channel` } },
      update: {
        enabled: type === "email",
        maskedIdentifier: type === "email" ? "demo-alerts@example.local" : `${type}: demo destination`,
        config: { demo: true }
      },
      create: {
        type,
        name: `${type} demo channel`,
        enabled: type === "email",
        maskedIdentifier: type === "email" ? "demo-alerts@example.local" : `${type}: demo destination`,
        config: { demo: true }
      }
    });
  }
}

async function seedReportsAndSystem() {
  const exhibition = await prisma.exhibition.findUniqueOrThrow({ where: { dataProfile_code: { dataProfile: DEMO_PROFILE, code: "NMTH-CLIMATE-SEED" } } });
  await prisma.report.upsert({
    where: { id: "20000000-0000-4000-8000-000000000001" },
    update: {
      exhibitionId: exhibition.id,
      title: "常設展每日溫濕度報表",
      parameters: { interval: "1h", includeCompensated: true, includeSynthetic: false }
    },
    create: {
      id: "20000000-0000-4000-8000-000000000001",
      exhibitionId: exhibition.id,
      title: "常設展每日溫濕度報表",
      description: "Seeded report definition for local report page validation.",
      parameters: { interval: "1h", includeCompensated: true, includeSynthetic: false }
    }
  });
  await prisma.scheduledReport.upsert({
    where: { id: "20000000-0000-4000-8000-000000000002" },
    update: {
      name: "每日 09:00 展場環境摘要",
      enabled: true,
      cron: "0 9 * * *",
      parameters: { exhibitionCode: exhibition.code, interval: "1h" },
      recipients: [{ type: "email", to: "demo-alerts@example.local" }]
    },
    create: {
      id: "20000000-0000-4000-8000-000000000002",
      name: "每日 09:00 展場環境摘要",
      enabled: true,
      cron: "0 9 * * *",
      locale: "zh-TW",
      parameters: { exhibitionCode: exhibition.code, interval: "1h" },
      recipients: [{ type: "email", to: "demo-alerts@example.local" }]
    }
  });

  for (const locale of ["zh-TW", "en", "ja"]) {
    await prisma.notificationTemplate.upsert({
      where: { key_locale: { key: "alert.triggered", locale } },
      update: {
        subject: locale === "en" ? "Climate alert triggered" : locale === "ja" ? "環境アラートが発生しました" : "溫濕度警報已觸發",
        body: "{{deviceName}} {{level}} {{message}}"
      },
      create: {
        key: "alert.triggered",
        locale,
        subject: locale === "en" ? "Climate alert triggered" : locale === "ja" ? "環境アラートが発生しました" : "溫濕度警報已觸發",
        body: "{{deviceName}} {{level}} {{message}}",
        variables: ["deviceName", "level", "message"]
      }
    });
  }

  await prisma.dataRetentionPolicy.upsert({
    where: { id: "55555555-5555-4555-8555-555555555555" },
    update: {
      name: "Default long-term conservation retention",
      rawPacketDays: 3650,
      measurementDays: 3650,
      reportExportDays: 1095,
      enabled: true
    },
    create: {
      id: "55555555-5555-4555-8555-555555555555",
      name: "Default long-term conservation retention",
      rawPacketDays: 3650,
      measurementDays: 3650,
      reportExportDays: 1095,
      enabled: true
    }
  });

  await prisma.systemSetting.upsert({
    where: { key: "demo.mode" },
    update: { value: { enabled: true, seededAt: new Date().toISOString() } },
    create: { key: "demo.mode", value: { enabled: true, seededAt: new Date().toISOString() } }
  });

  await prisma.systemSetting.upsert({
    where: { key: "data.activeProfile" },
    update: { value: { profile: DEMO_PROFILE } },
    create: { key: "data.activeProfile", value: { profile: DEMO_PROFILE } }
  });
}

async function main() {
  await seedRbac();
  const deviceMap = await seedMuseumContext();
  await seedMeasurements(deviceMap);
  await seedAlertsAndOperations(deviceMap);
  await seedReportsAndSystem();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
