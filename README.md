# Browser Agent Backend

Fastify + Sequelize backend API for the Browser Agent platform.

## Prerequisites

- Node.js 20+
- npm 10+
- MySQL 8+ (optional for local demo mode)
- Redis (required for queue workflows)

## Environment

```powershell
Copy-Item .env.example .env
```

Important variables:

- `FRONTEND_ORIGIN` (example: `http://localhost:3000`)
- `API_PUBLIC_URL` (example: `http://localhost:4000`)
- `INTERNAL_AGENT_TOKEN` (shared with agent service)
- `REDIS_URL`

Optional agent auto-run from backend:

- `AGENT_AUTO_RUN=true`
- `AGENT_WORKDIR` absolute/relative path to agent repo
- `AGENT_PYTHON_PATH` path to Python executable for agent venv

## Run

```powershell
npm install
npm run dev
```

Default URL: `http://localhost:4000`

## Migrations and seed

```powershell
npm run db:migrate
npm run db:seed
```

## Build and test

```powershell
npm run typecheck
npm run test:smoke
npm run build
```
