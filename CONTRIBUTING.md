# Contributing

Thank you for considering a contribution to NMTH Climate Services. The project
focuses on reliable environmental monitoring workflows for museum exhibitions
and other cultural heritage spaces.

## Project Priorities

Contributions should preserve these qualities:

- Clear RBAC boundaries for operators, managers, administrators, and super
  administrators.
- Reliable ingestion, validation, alerting, audit, and reporting flows.
- Frontend behavior that works on desktop, tablet, and mobile.
- Safe defaults for configuration, examples, and deployment notes.
- Tests for business rules, permissions, and user-visible workflows.

## Before You Start

1. Search existing issues and pull requests.
2. For larger changes, open an issue first and describe the proposed approach.
3. Keep changes focused. Avoid unrelated refactors in feature or bug-fix PRs.
4. Do not include real operational data, credentials, internal hostnames,
   private IP addresses, or local deployment files.

## Local Setup

```bash
pnpm install
cp .env.example .env
pnpm db:generate
```

Fill `.env` with local development values only. Never commit real secrets.

## Verification

Run the checks that match your change:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

For RBAC or permission-sensitive changes:

```bash
pnpm test:rbac:web
pnpm test:rbac:api
```

For responsive UI changes:

```bash
pnpm test:responsive
```

## Pull Request Checklist

- The change has a clear purpose and scope.
- Tests were added or updated when behavior changed.
- RBAC and security-sensitive paths were considered.
- `.env.example` contains placeholders only.
- No private docs, production data, logs, database files, or build artifacts
  are included.
- README or other public documentation was updated when needed.

## Coding Style

- Prefer existing patterns in the API, web app, shared package, and tests.
- Keep domain rules in shared helpers when both API and web need them.
- Use typed schemas and explicit validation for inbound data.
- Keep UI states accessible, responsive, and readable under operational use.

## Security

Please read `SECURITY.md` before reporting vulnerabilities or submitting
security-sensitive changes.
