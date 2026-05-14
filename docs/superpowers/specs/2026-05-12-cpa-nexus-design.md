# CPA Nexus Design

## Goal

Build a Docker-friendly CPA operations dashboard in `cpa-nexus` using Next.js, TypeScript, shadcn/ui, Tailwind, Drizzle ORM, SQLite, and node-cron.

## Product Scope

The app manages multiple CLIProxyAPI (CPA) instances, their auth files, quota snapshots, auto replenishment rules, proxy capacity, cron jobs, and backup Codex accounts. It is an internal operations tool, so the first screen is a dense dashboard rather than a marketing landing page.

## Architecture

The system has one Next.js app and one optional worker process built from the same codebase. The Next.js app owns UI and API routes. The worker process loads cron job settings from SQLite and runs periodic sync and replenishment jobs with `node-cron`.

SQLite is the source of truth for local state. CPA remains the source of truth for live auth files and quota refresh data. Sync jobs pull CPA data into local snapshot tables, while replenishment jobs upload generated Codex auth JSON files back to the selected CPA instance.

## CPA Integration

Each CPA instance stores:

- Display name
- Base URL
- Management password
- Optional quota refresh path
- Enabled flag

The client supports the known CPA management API:

- `GET /v0/management/auth-files`
- `GET /v0/management/auth-files/download?name=...`
- `POST /v0/management/auth-files?name=...`
- `DELETE /v0/management/auth-files?name=...`
- `PATCH /v0/management/auth-files/fields`

Authentication is sent as `Authorization: Bearer <management password>`. Quota refresh is intentionally configurable per instance because existing CPA deployments and panels expose this differently. The default path is `/v0/management/auth-files`, and the parser accepts multiple common payload shapes.

## Data Model

Core tables:

- `cpa_instances`
- `auth_files`
- `quota_snapshots`
- `replenishment_strategies`
- `proxies`
- `proxy_cpa_instances`
- `backup_accounts`
- `cron_jobs`
- `job_runs`

Auth files and quotas are snapshots, not manual truth. Backup accounts keep assignment state, source text, parsed email, parsed refresh token, current CPA ownership, and latest exception.

## Auto Replenishment

Each CPA instance has one strategy:

- Keep 5h usage average above a configured percent
- Keep weekly usage average above a configured percent
- Keep available account count at or above a configured number

The evaluator computes triggers from latest quota snapshots and available auth files. When triggered, it uploads unassigned backup accounts in small batches. The generated auth JSON is:

```json
{
  "type": "codex",
  "refresh_token": "rt_xxxx",
  "expired": "1970-01-01T00:00:00Z",
  "email": "xxx@xx.com"
}
```

The filename format is `codex-<email>-auto.json`. If a matching proxy is available, the app assigns it with `PATCH /v0/management/auth-files/fields` after upload, respecting each proxy's max auth-file usage and CPA allow-list.

## UI

The app uses shadcn-style primitives and a sidebar layout:

- CPA 大盘: summary cards and CPA instance CRUD
- 认证文件: grouped by CPA instance
- 配额管理: grouped by CPA instance
- 自动补号策略: per-instance strategy settings
- 代理管理: proxy CRUD and CPA allow-list
- 定时任务: job settings, manual run, run history
- 替补账号: textarea bulk import and table with ownership and exception fields

## Error Handling

CPA sync records per-instance errors in job runs and does not block other instances. Quota parsing preserves raw payload text when fields are unknown. Backup account exceptions are refreshed by matching quota/auth data by email.

## Testing

Automated tests cover:

- Backup account line parsing
- Generated auth filename sanitization
- Quota payload normalization and exception extraction
- Replenishment planning decisions

Manual verification covers:

- Next.js build
- API smoke paths
- Docker Compose config
