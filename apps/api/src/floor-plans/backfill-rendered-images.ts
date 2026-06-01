import { PrismaClient } from "@prisma/client";
import { FloorPlanRendererService } from "./floor-plan-renderer.service";
import { FloorPlansService } from "./floor-plans.service";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveIntegerArg(name: string): number | undefined {
  const value = argValue(name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function main() {
  const prisma = new PrismaClient();
  const service = new FloorPlansService(
    prisma as never,
    new FloorPlanRendererService(),
  );
  try {
    const summary = await service.backfillRenderedImages({
      write: process.argv.includes("--write"),
      includeArchived: process.argv.includes("--include-archived"),
      repairMissing: process.argv.includes("--repair-missing"),
      limit: positiveIntegerArg("limit"),
      versionId: argValue("versionId"),
    });
    console.log(JSON.stringify(summary, null, 2));
    if (summary.failed > 0 && process.argv.includes("--strict")) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
