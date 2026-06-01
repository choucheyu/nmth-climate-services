# Security Policy

NMTH Climate Services handles operational telemetry, alerting, user access,
and deployment integrations. Security reports are taken seriously even when
the public repository contains only sanitized configuration.

## Supported Versions

The public `main` branch is the supported development line. Security fixes
will be applied there first.

## What To Report

Please report issues that could affect confidentiality, integrity, or
availability, including:

- Authentication or session bypass.
- RBAC permission mistakes.
- Unsafe file upload or PDF processing behavior.
- API endpoints that expose data across exhibitions, devices, or users.
- Injection, SSRF, path traversal, or deserialization risks.
- Secret leakage in examples, logs, test fixtures, or documentation.
- Alerting, audit-log, or reporting behavior that could hide incidents.

## How To Report

If GitHub Security Advisories are available for this repository, please use a
private advisory. If not, open a minimal issue that says you have a security
report, but do not include exploit steps, private data, secrets, or production
details in the public issue.

Please include:

- A short description of the affected component.
- The impact and who could trigger it.
- A safe reproduction outline using placeholder data.
- Any affected commit, branch, or file path.
- Suggested remediation, if known.

## Response Expectations

- Acknowledge the report as soon as practical.
- Triage severity and affected scope.
- Prepare a fix, test coverage, or mitigation plan.
- Credit the reporter when appropriate and requested.

## Operational Data

Do not submit real sensor data, user records, credentials, webhook URLs,
database dumps, internal hostnames, or private network addresses in public
issues or pull requests.
