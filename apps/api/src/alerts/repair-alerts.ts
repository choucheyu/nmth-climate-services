import { PrismaClient } from "@prisma/client";
import { AlertsService } from "./alerts.service";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const prisma = new PrismaClient();
  const alerts = new AlertsService(prisma as never);
  try {
    const summary = await alerts.repairThresholdAlerts({
      dataProfile: argValue("dataProfile") ?? argValue("profile"),
      write: process.argv.includes("--write")
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
