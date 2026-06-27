# CPA Nexus

CPA Nexus is a Next.js operations console for managing multiple CLIProxyAPI
instances, Codex auth files, quota snapshots, proxy assignment, and scheduler
operations.

## Features

- CPA instance management with enable/disable controls.
- Account management grouped by CPA instance, including quotas, subscription
  tags, availability, proxy configuration, disable/enable, delete, move, and
  per-account quota refresh.
- Manual account add flows through RT, Mobile RT, and OAuth login.
- Proxy management with CPA allow-listing, per-proxy account capacity, enable
  switch, and one-click proxy checks.
- Cron-style scheduler with simplified UI presets.
- Admin password login through `config.toml` or environment overrides.
- Docker Compose deployment with separate web and worker services.

## Tech Stack

- Next.js 16 + React 19 + TypeScript
- Tailwind CSS + shadcn/ui-style components
- Drizzle ORM + SQLite
- node-cron worker
- Docker Compose

## Requirements

- Node.js 24 or newer is recommended.
- npm
- Docker and Docker Compose for container deployment.

## Local Development

Install dependencies and initialize the SQLite database:

```bash
npm install
npm run db:init
```

Create local configuration:

```bash
cp config.example.toml config.toml
```

Change the admin password before exposing the app:

```toml
[auth]
admin_password = "change-me"
cookie_name = "cpa_nexus_session"
session_max_age_days = 7
```

Start the web app and worker together:

```bash
npm run dev
```

The default local database is:

```bash
DATABASE_URL=file:./data/cpa-nexus.db
```

The default development port is defined in `.env.example`.

## Configuration

CPA Nexus reads `config.toml` from the project root by default. Override the path
with:

```bash
CPA_NEXUS_CONFIG=/path/to/config.toml
```

Supported environment overrides:

```bash
CPA_NEXUS_ADMIN_PASSWORD=change-me
CPA_NEXUS_COOKIE_NAME=cpa_nexus_session
CPA_NEXUS_SESSION_MAX_AGE_DAYS=7
```

`config.toml` is ignored by git and Docker build context. Do not bake real
secrets into the image.

## Docker Compose

Create `config.toml` on the host first:

```bash
cp config.example.toml config.toml
```

Build and run locally:

```bash
docker compose up --build
```

The compose file starts:

- `web`: Next.js app on port `3000`.
- `worker`: node-cron scheduler using the same SQLite volume.

The SQLite database is stored in the named volume `cpa-nexus-data`.

## Server Deployment with Docker Compose

For a server deployment, build the image on your local machine or CI and let the
server only pull and run the published image.

Create a deployment directory on the server:

```bash
mkdir -p ~/cpa-nexus
cd ~/cpa-nexus
```

Create `config.toml`:

```toml
[auth]
admin_password = "change-me"
cookie_name = "cpa_nexus_session"
session_max_age_days = 7
```

Create `docker-compose.yml`:

```yaml
services:
  web:
    image: ${CPA_NEXUS_IMAGE:-zonghao/cpa-nexus:0.1.24-amd64}
    command: npm run start
    environment:
      DATABASE_URL: file:/app/data/cpa-nexus.db
      CPA_NEXUS_CONFIG: /app/config.toml
      PORT: 3000
    ports:
      - "127.0.0.1:9527:3000"
    volumes:
      - cpa-nexus-data:/app/data
      - ./config.toml:/app/config.toml:ro
    restart: unless-stopped

  worker:
    image: ${CPA_NEXUS_IMAGE:-zonghao/cpa-nexus:0.1.24-amd64}
    command: npm run worker
    environment:
      DATABASE_URL: file:/app/data/cpa-nexus.db
      CPA_NEXUS_CONFIG: /app/config.toml
    volumes:
      - cpa-nexus-data:/app/data
      - ./config.toml:/app/config.toml:ro
    restart: unless-stopped
    depends_on:
      - web

volumes:
  cpa-nexus-data:
```

Start or upgrade the service:

```bash
docker compose pull
docker compose up -d
```

Check status and logs:

```bash
docker compose ps
docker compose logs -f --tail=100
```

The example binds the app to `127.0.0.1:9527` so it can sit behind Nginx,
Caddy, Traefik, or another reverse proxy. If you want to expose it directly,
change the port mapping to `"9527:3000"`.

## Docker Hub Image

The current versioned image is:

```bash
zonghao/cpa-nexus:0.1.24-amd64
```

Use a specific image with Docker Compose:

```bash
CPA_NEXUS_IMAGE=zonghao/cpa-nexus:0.1.24-amd64 docker compose pull
CPA_NEXUS_IMAGE=zonghao/cpa-nexus:0.1.24-amd64 docker compose up -d
```

Build and push a new Linux amd64 image from your local machine:

```bash
docker buildx build --platform linux/amd64 \
  -t zonghao/cpa-nexus:0.1.24-amd64 \
  --push .
```

## CPA Integration

Each CPA instance stores a base URL and management password. Requests use:

```http
Authorization: Bearer <CPA password>
```

Supported management endpoints include:

- `GET /v0/management/auth-files`
- `GET /v0/management/auth-files/download?name=...`
- `POST /v0/management/auth-files?name=...`
- `DELETE /v0/management/auth-files?name=...`
- `PATCH /v0/management/auth-files/status`
- `PATCH /v0/management/auth-files/fields`
- `GET /v0/management/codex-auth-url?is_webui=true`
- `POST /v0/management/oauth-callback`

The quota refresh path is configurable per CPA instance. The default path is
`/v0/management/auth-files`. CPA Nexus normalizes common quota payload shapes and
matches quota rows back to local auth files by email or file name.

## OpenAPI

CPA Nexus exposes an admin OpenAPI endpoint for adding accounts to the local
candidate pool:

```http
POST /api/openapi/candidate-auth-files
Authorization: Bearer <admin_password>
```

JSON array upload, where each item is a CPA JSON or sub2api OpenAI OAuth JSON:

```bash
curl -X POST https://nexus.example.com/api/openapi/candidate-auth-files \
  -H "Authorization: Bearer $CPA_NEXUS_ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  --data '[
    {
      "type": "codex",
      "email": "name@example.com",
      "refresh_token": "rt_xxx",
      "expired": "1970-01-01T00:00:00Z"
    }
  ]'
```

Multipart batch file upload:

```bash
curl -X POST https://nexus.example.com/api/openapi/candidate-auth-files \
  -H "Authorization: Bearer $CPA_NEXUS_ADMIN_PASSWORD" \
  -F "files=@./codex-a.json" \
  -F "files=@./codex-b.json"
```

## Scripts

```bash
npm run dev          # start Next.js and worker together
npm run dev:web      # start only Next.js dev server
npm run worker       # start only the scheduler worker
npm run db:init      # run SQLite migrations
npm run lint         # run ESLint
npm test             # run Vitest
npm run build        # create production build
npm run start        # initialize DB and start production web server
```

## Deployment Notes

- Always change `admin_password` before deployment.
- Keep `config.toml`, `.env*`, `data/`, `.next/`, and `node_modules/` out of git.
- Back up the SQLite volume before upgrading production deployments.
- Use versioned Docker tags for repeatable deployments.
