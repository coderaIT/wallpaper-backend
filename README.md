# Wallpaper CMS API

Production-ready REST API for a wallpaper mobile app (anonymous, read-only public API) and its
Admin Dashboard (JWT auth with rotating refresh tokens, `SUPER_ADMIN` / `EDITOR` roles).

**Stack:**

- NestJS 11 (TypeScript strict), PostgreSQL 15+ (tested on 18), Prisma ORM 7.
- Argon2id, class-validator, Sharp, AWS SDK v3 (S3-compatible storage).
- Swagger/OpenAPI, Jest + Supertest, Docker.

- API reference: `/api/docs` (Swagger UI), `/api/docs-json`
- Client integration guide: [API_INTEGRATION.md](./API_INTEGRATION.md)
- Implementation log and verification results: [BACKEND_PROGRESS.md](./BACKEND_PROGRESS.md)

## Features

- **Public API** (`/api/v1/public/*`):
  - Resolved home feed with a bounded number of queries.
  - Remote app config with force/optional update status.
  - Categories, wallpapers with filtering, search and sorting.
  - Anonymous, deduplicated analytics events.
  - Only published content is returned; responses contain allowlisted fields only.
- **Admin API** (`/api/v1/admin/*`):
  - Auth and admin accounts.
  - Media uploads (original, WebP preview and thumbnail variants), categories, wallpapers with bulk operations, banners, home sections.
  - Remote settings with optimistic concurrency.
  - Analytics reports, dashboard, audit logs.
- **Security:**
  - Deny-by-default auth guard, per-request account/role/token-version check, RBAC.
  - Account lockout, CSRF-protected refresh cookie, refresh-token reuse detection.
  - Helmet, strict validation (unknown fields rejected), rate limiting (default / auth / events profiles).
  - Upload sniffing and decompression-bomb limits, SSRF-safe external URLs.
  - Secrets never logged or audited.

## Requirements

- Node.js ≥ 22.12, npm
- PostgreSQL ≥ 15 (the `pg_trgm` extension is created by the first migration, so the migrating role needs `CREATE` on the database, or install the extension beforehand)
- Optional: S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, …)

No Redis is needed. Caches (settings, home feed) are small, in-process and short-lived; see
[Scaling](#scaling) for when to add one.

## Local development

```bash
npm ci
cp .env.example .env               # then edit: DATABASE_URL, JWT_ACCESS_SECRET, SEED_ADMIN_*
npm run prisma:generate
npm run db:migrate:deploy          # apply migrations
npm run db:seed                    # first SUPER_ADMIN + default settings/home sections (idempotent)
npm run start:dev                  # http://localhost:3000/api/v1, docs at /api/docs
```

Generate a JWT secret with:
`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.

The seed reads `SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME` and `SEED_ADMIN_PASSWORD` (no credentials are
hardcoded). It never resets the password of an existing admin. Remove `SEED_ADMIN_PASSWORD` from
the environment after seeding.

With `STORAGE_DRIVER=local`, images are written to `LOCAL_STORAGE_PATH` and served at `/media`.
That mode is for development only; use S3-compatible storage behind a CDN in production.

## Scripts

| Script                             | Purpose                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run build` / `start:prod`     | Compile to `dist/` and run `dist/src/main.js`                                       |
| `npm run start:dev`                | Watch mode                                                                          |
| `npm run typecheck`                | `tsc --noEmit`                                                                      |
| `npm test`                         | Unit tests                                                                          |
| `npm run test:e2e`                 | End-to-end tests (real PostgreSQL, in-memory object storage)                        |
| `npm run test:all` / `test:cov`    | Everything / with coverage                                                          |
| `npm run prisma:generate`          | Generate the Prisma client (`src/generated/prisma`)                                 |
| `npm run db:migrate:dev`           | **Development only**: create and apply a new migration from `schema.prisma` changes |
| `npm run db:migrate:deploy`        | Apply pending migrations (CI / production)                                          |
| `npm run db:migrate:status`        | Show migration status                                                               |
| `npm run db:seed` / `db:seed:prod` | Seed with `tsx` / from the compiled `dist/prisma/seed.js`                           |

### Tests

E2E tests need a dedicated PostgreSQL database. Copy `.env.test.example` to `.env.test` and point
`DATABASE_URL` at a database whose name contains `test`. The global setup refuses to run against
anything else, applies migrations, and each suite truncates tables between tests. Never point
`.env.test` at a shared or production database.

```bash
cp .env.test.example .env.test
npm run test:all
```

Jest runs with `node --experimental-vm-modules`, because the Prisma 7 client loads its WASM query
compiler via dynamic `import()`.

## Database migrations

- Schema changes: edit `prisma/schema.prisma`, run `npm run db:migrate:dev -- --name <change>`
  against a development database, review the generated SQL, and commit it.
- Deploy: `npm run db:migrate:deploy` (Docker: the `migrate` image target). It only applies
  committed migrations and never resets data.
- **Never run `prisma migrate reset`, `prisma db push --force-reset` or `migrate dev` against
  production.** They can drop data.
- Prefer backward-compatible (expand/contract) migrations so the old and new app versions can run
  side by side during rolling deploys: add nullable/defaulted columns first, backfill, then
  tighten or drop in a later release.
- Hand-written SQL in migrations: the `pg_trgm` extension, the trigram index on wallpaper titles,
  and CHECK constraints (dimensions, counters, banner schedules, media variant consistency).

## Docker

```bash
# .env next to docker-compose.yml (never commit it):
#   POSTGRES_PASSWORD=...  JWT_ACCESS_SECRET=...  CORS_ORIGINS=https://admin.example.com
docker compose up -d --build                       # postgres -> migrate (one-off) -> api
docker compose run --rm -e SEED_ADMIN_EMAIL=admin@example.com -e SEED_ADMIN_PASSWORD='...' api node dist/prisma/seed.js
docker compose --profile minio up -d --build       # optional local S3 (MinIO) + bucket init
```

- `Dockerfile` (multi-stage, `node:22-bookworm-slim`):
  - `runtime` target: production dependencies only, non-root `node` user, `HEALTHCHECK` on `/api/v1/health`.
  - `migrate` target: Prisma CLI for `prisma migrate deploy`.
- Compose starts the API only after Postgres is healthy and migrations have completed. It uses
  `init: true` for signal forwarding and gives a 30 s grace period for graceful shutdown.
- PostgreSQL is not published on the host by default.

## Production guidance

**Configuration.** All configuration comes from environment variables, which are validated at boot
(the process exits on invalid config). See `.env.example` for every variable.

- `NODE_ENV=production`, `COOKIE_SECURE=true` (enforced), HTTPS everywhere (terminate TLS at the
  load balancer).
- `JWT_ACCESS_SECRET`: ≥ 32 random characters, stored in a secret manager. Rotating it logs every
  admin out.
- `TRUST_PROXY`: set it to the number of proxy hops (e.g. `1`). Client IPs drive rate limiting and
  analytics dedupe; a wrong value either lets clients spoof IPs or rate-limits everyone as one IP.
- `CORS_ORIGINS`: the dashboard origin(s) only. CORS is not a security boundary for the mobile API,
  which is public by design and protected by validation and rate limits.
- Cookies:
  - Same-site dashboard (e.g. `admin.example.com` → `api.example.com`): `COOKIE_SAME_SITE=strict` or `lax`.
  - Cross-site dashboard: `COOKIE_SAME_SITE=none`.
- `SWAGGER_ENABLED`: either `false`, or set `SWAGGER_USER` / `SWAGGER_PASSWORD` (HTTP Basic on
  `/api/docs*`). In production, the app refuses to start when Swagger is enabled without
  credentials. The variable defaults to `true`, so set it explicitly.

**Storage and CDN.**

- `STORAGE_DRIVER=s3` with a private bucket, and a CDN (CloudFront, Cloudflare, …) in front of it for public reads of `media/*`.
- `MEDIA_PUBLIC_BASE_URL` = the CDN origin. URLs are built only from this value, never from request headers.
- Use IAM roles or scoped keys: `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on the bucket. The SDK default credential chain works if `S3_ACCESS_KEY_ID` is unset.
- Objects are immutable (unique key per upload) and served with long cache lifetimes.
- `MEDIA_ORPHAN_CLEANUP_INTERVAL_MINUTES` sweeps storage objects that have no database row, with a 1-hour grace period. Run it on one instance, or keep the interval long; the sweep is idempotent.

**Operations.**

- Health: `GET /api/v1/health` (DB probe, 503 when the DB is down). Use it for liveness and readiness probes.
- Graceful shutdown on SIGTERM:
  - in-flight requests finish,
  - the analytics buffer is flushed,
  - the database disconnects last.

  Allow ≥ 10 s of termination grace.

- Logs: one access line per request (method, path, status, duration, request ID). Bodies, query
  strings, cookies and tokens are never logged; 5xx errors are logged with stack traces.
- Rate limits are per instance (in-memory). Enforce global limits at the edge (CDN/WAF) as well.
- Run `npm audit` in CI and review the advisories noted in `BACKEND_PROGRESS.md`.

### Scaling

- The API is stateless apart from short-lived caches, so you can scale it horizontally behind a load balancer.
- Per-instance trade-offs:
  - rate-limit counters, analytics dedupe and the analytics buffer are per instance;
  - settings and home caches converge within `PUBLIC_CACHE_TTL_SECONDS`.
- Add Redis when you need exact global rate limits or cross-instance dedupe. `@nestjs/throttler` accepts a pluggable storage, for which Redis adapters exist.
- Put a CDN in front of `/api/v1/public/*`; responses carry `Cache-Control: public, max-age=…`.
- Database: wallpapers are indexed for every public sort and filter, search uses a trigram GIN index, and analytics charts read pre-aggregated daily rows. Add a read replica before sharding.

## Backup strategy

Data lives in two places: **PostgreSQL** (all metadata, settings, analytics and audit logs) and
**object storage** (image files). Back up both, with retention that matches.

1. **PostgreSQL**
   - Managed databases (RDS, Cloud SQL, Neon, …): enable automated backups with point-in-time recovery (PITR), keep ≥ 7–35 days, and enable deletion protection.
   - Self-hosted: continuous WAL archiving plus base backups with pgBackRest or WAL-G (PITR), or at minimum a nightly logical dump:
     ```bash
     pg_dump --format=custom --no-owner --file=wallpaper-$(date +%F).dump "$DATABASE_URL"
     # restore into an EMPTY database:
     pg_restore --no-owner --dbname="$RESTORE_DATABASE_URL" wallpaper-YYYY-MM-DD.dump
     ```
   - Store backups encrypted, in another region or account, with lifecycle expiry.
2. **Object storage**: enable bucket versioning, plus a lifecycle rule that expires non-current versions after N days (≥ the DB backup retention), plus cross-region replication for disaster recovery.
3. **Consistency:** media rows reference storage keys, and objects are written before rows. If the database is restored to an earlier point, newer objects simply become orphans; the cleanup sweep removes them after its grace period. If storage is restored to an earlier point, re-upload any missing images listed by `GET /admin/media`.
4. **Test restores** at least quarterly. Restore into a scratch database, run `npm run db:migrate:status`, and boot the API against it.
5. Secrets (`JWT_ACCESS_SECRET`, database and S3 credentials) live in the secret manager, not in backups or the repository.

## Project layout

```
prisma/                 schema.prisma, migrations/, seed.ts
src/
  config/               env validation, typed config
  common/               guards, decorators, filters, interceptors, pipes, validators, utils
  prisma/               PrismaService (driver adapter, health probe)
  health/               GET /health
  modules/
    auth/ admins/ audit-logs/          admin identity & security
    media/                             storage providers, Sharp pipeline, uploads
    categories/ wallpapers/            catalog management
    banners/ home-sections/ app-settings/   home & remote config
    public/                            mobile API (catalog, home, app-config)
    analytics/ dashboard/              events, reports, dashboard
test/                   e2e suites + helpers (in-memory storage, image fixtures)
```
