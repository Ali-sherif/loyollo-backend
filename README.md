# loyollo-backend

NestJS API for Loyollo Phase 2. Product schema and HTTP contracts live in the frontend docs — this repo implements them; it does not duplicate the plan.

- Contracts: [`loyollo-web/docs/backend/`](../loyollo-web/docs/backend/README.md) (`data-contract.md`, `api-contract.md`, `remediation-roadmap.md`)
- Stack: NestJS 11.x, Prisma 7.x, PostgreSQL 18.x, Node 24 LTS ([ADR-015](../loyollo-web/docs/architecture/decisions/ADR-015-backend-stack.md))

Local Docker runs **Postgres only**. Nest and Next.js stay on the host.

## Prerequisites

- Docker Desktop running
- Node.js 24 LTS and npm (this machine currently has Node 22; npm warns `EBADENGINE` but the API still boots)
- Sibling checkout of `loyollo-web` (for contracts; not required to boot this API)

Postgres 18 images store data under `/var/lib/postgresql` (not `/var/lib/postgresql/data`). The Compose volume already uses that path.

## Local setup

```bash
copy .env.example .env
docker compose up -d
npm install
npx prisma generate
npm run start:dev
```

- API: `http://localhost:4000`
- Health: `http://localhost:4000/health` → `{ "status": "ok", "db": "up" }`
- Postgres: `localhost:5432` (dev user/password/db: `loyollo`)

Frontend is unchanged: `cd ../loyollo-web && npm run dev` (port 3000).

## E2E tests

Requires Postgres (`docker compose up -d`). Each Jest worker gets its own `e2e_<run>_w<n>` database cloned from a migrated template; those databases are dropped after the run (including failures). The `loyollo` database is never used for test data.

```bash
npm run test:e2e
```

## Out of scope (this scaffold)

No product Prisma models, auth, Redis, workers, or Next.js wiring yet. First schema work follows the remediation roadmap in `loyollo-web/docs/backend/`.
