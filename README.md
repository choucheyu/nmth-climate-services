# NMTH Climate Services

NMTH Climate Services is a monorepo for an exhibition temperature and humidity monitoring platform. It includes a NestJS API, a Next.js web application, shared domain schemas, RBAC policy, reporting logic, alerting, floor-plan monitoring, and integration points for real sensor ingestion.

This repository is a sanitized GitHub export. It contains source code and safe placeholder configuration only. Private operational docs, local runtime data, and real secrets are intentionally excluded.

## What This Project Does

- Ingests temperature and humidity measurements.
- Supports demo and real data profiles.
- Tracks devices, exhibitions, zones, floor plans, alerts, reports, and audit events.
- Provides role-based access control for operators, managers, administrators, and super administrators.
- Renders exhibition floor plans with sensor points and status callouts.
- Supports alert workflows including threshold and offline-device states.
- Provides report generation and trend visualization.
- Includes adapters for notification channels such as email, LINE, Discord, and Telegram.

## Repository Layout

- `apps/api/` - NestJS API, Prisma schema, migrations, services, and tests.
- `apps/web/` - Next.js web UI, pages, components, E2E tests, and styles.
- `packages/shared/` - Shared schemas, RBAC policy, i18n messages, and reporting helpers.
- `scripts/` - Local helper scripts.
- `.env.example` - Environment variable names with no real values.
- `pnpm-workspace.yaml` - Workspace package definition.
- `turbo.json` - Turborepo task configuration.

## What Is Intentionally Not Included

The original local project contains private documentation and runtime artifacts. Those are intentionally excluded from this GitHub export.

- Private docs and product planning files.
- Local backups and memory snapshots.
- Real `.env` values.
- Real database files.
- Runtime logs and temporary files.
- Build/cache output such as `.turbo`, `.next`, and `dist`.
- GitHub Actions and local git hooks from the private working copy.
- Production deployment-specific Docker Compose values.

## Requirements

- Node.js `>=20.11.0`
- pnpm `9.15.4`
- PostgreSQL / TimescaleDB
- Redis

## Local Setup

```bash
pnpm install
cp .env.example .env
```

Fill `.env` with local values before running the system. Required variables include:

- `DATABASE_URL`
- `REDIS_URL`
- `API_PORT`
- `WEB_PORT`
- `WEB_ORIGIN`
- `COOKIE_SECRET`
- `JWT_SECRET`
- `INGEST_API_TOKEN`
- `SERVER_API_BASE_URL`
- `SERVER_HEALTH_URL`

Optional integrations should stay blank unless configured locally:

- `SMTP_HOST`
- `SMTP_USER`
- `SMTP_PASS`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `DISCORD_WEBHOOK_URL`
- `TELEGRAM_BOT_TOKEN`
- `CWA_API_KEY`
- `OPENAI_API_KEY`
- `COLLECTOR_BASE_URL`

Do not commit real values.

## Database Workflow

```bash
pnpm db:validate
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

The seed creates demo data for local validation. Replace or remove demo users and demo secrets before any real deployment.

## Development

Run all workspace development tasks:

```bash
pnpm dev
```

Common local endpoints:

- Web: `http://localhost:3000`
- API: `http://localhost:4000/api`
- Health: `http://localhost:4000/health`

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

RBAC-focused checks:

```bash
pnpm test:rbac:web
pnpm test:rbac:api
pnpm test:rbac:e2e
pnpm test:rbac
```

Responsive UI checks:

```bash
pnpm test:responsive
```

## Security Notes

- `.env.example` contains only empty placeholders in this export.
- Keep database credentials, ingest tokens, notification tokens, API keys, and webhook URLs out of git.
- Keep production deployment files private unless they are reviewed and sanitized.
- Do not expose the API or dashboard publicly without authentication, rate limiting, CSRF, origin, and reverse-proxy review.

## Related Repositories

Local operations dashboard:

https://github.com/choucheyu/macmini-service-dashboard

Local monitoring stack:

https://github.com/choucheyu/monitoring-stack
