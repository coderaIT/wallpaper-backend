# Backend Progress

Status log for the Wallpaper CMS API. Updated at the end of every implementation phase.

## Phase 1 - Project initialization & global configuration ✅

- NestJS 11 project (TypeScript strict, CommonJS, `module: nodenext`), Prettier.
- Validated environment (`src/config/env.validation.ts`) - boot fails fast on invalid config; production guards (Swagger credentials, secure cookies).
- Global pipeline in `src/app.setup.ts`: helmet, CORS allowlist, cookie-parser, 1 MB JSON limit, `ValidationPipe` (whitelist / forbidNonWhitelisted / transform), safe exception filter, `{ data, meta }` response envelope, request id + access logging middleware, shutdown hooks, trust-proxy.
- Rate limiting via `@nestjs/throttler` with `default`, `auth`, `events` profiles.
- Health check `GET /api/v1/health` (DB probe).
- Verified: `tsc` clean, server boots, `/api/v1/health` -> 200, unknown route -> 404 JSON envelope, `/api/docs-json` -> 200.

## Phase 2 - PostgreSQL, Prisma, models, migrations ✅

- Prisma ORM 7.10 (`prisma-client` generator, CJS output in `src/generated/prisma`, `@prisma/adapter-pg`), `prisma.config.ts`.
- Schema: Admin, RefreshToken, AuditLog, MediaAsset (original + variants), Category, Wallpaper, WallpaperCategory, Banner, HomeSection, AppSetting, WallpaperEvent, WallpaperDailyStat.
- Migration `init` incl. `pg_trgm` extension, trigram GIN index on titles, GIN on tags, CHECK constraints.
- Idempotent seed (`prisma/seed.ts`): SUPER_ADMIN from `SEED_ADMIN_*` env vars (never hardcoded, password policy enforced), default settings, default home sections.
- Verified: migration applied to local PostgreSQL 18, seed executed successfully.

## Phase 3 - Admin authentication & authorization ✅

- `POST /admin/auth/login|refresh|logout`, `GET /admin/auth/me`, `GET /admin/auth/csrf`, `POST /admin/auth/change-password`.
- Argon2id hashing (OWASP params), password policy, account lockout (5 failures -> 15 min), timing equalization for unknown emails.
- Short-lived HS256 access JWT (issuer/audience pinned) in `Authorization: Bearer`.
- Rotating refresh tokens: opaque `<id>.<secret>`, only SHA-256 hash stored, token families, reuse detection revokes the family, 15 s concurrency grace, server-side revocation on logout / password change / admin disable.
- Refresh token in HttpOnly + Secure + SameSite cookie scoped to `/api/v1/admin/auth`; signed double-submit CSRF token (HMAC bound to the refresh token) required on refresh/logout.
- Global guards: Throttler -> JwtAuthGuard (deny by default, `@Public()` opt-out, DB re-check of `isActive` and role on every request) -> RolesGuard (`@Roles()`).
- AdminsModule (SUPER_ADMIN): list/get/create/update/reset password/delete with last-super-admin and self-protection rules.
- AuditLogsModule: sanitized metadata (passwords/tokens/secrets redacted), `GET /admin/audit-logs` (SUPER_ADMIN).
- Verified: `test/auth.e2e-spec.ts` 16/16 passing.

## Phase 4 - Media storage & image processing ✅

- Storage abstraction (`StorageProvider`) with `LocalStorageProvider` (dev, path-traversal safe, served at `/media`) and `S3StorageProvider` (AWS SDK v3, any S3-compatible endpoint, default credential chain supported).
- Sharp pipeline: real format sniffing vs declared MIME, JPEG/PNG/WebP only, `limitInputPixels` + dimension limits (decompression bombs), animated images rejected, EXIF auto-orientation, metadata stripped, aspect ratio preserved, no upscaling. Variants: ORIGINAL (full-res, source format), PREVIEW (WebP), THUMBNAIL (WebP).
- Unique keys `media/YYYY/MM/<uuid>/<variant>.<ext>`, immutable cache headers, URLs built only from `MEDIA_PUBLIC_BASE_URL`.
- Failure handling: partial storage failures roll back uploaded objects; DB failure deletes stored objects; orphan sweep (`POST /admin/media/cleanup`, plus optional interval) for crash leftovers.
- Endpoints: upload single / bulk (per-file results), list (pagination, unused filter), get, delete (409 if referenced; DB FKs are RESTRICT as a second line of defense).
- Verified: unit `image-processor.service.spec.ts` 10/10, `test/media.e2e-spec.ts` 8/8.

## Phase 5 - Categories ✅

- CRUD, unique slug generation/validation, cover set/remove (`PATCH /:id/cover`), publish/unpublish, reorder (`PATCH /reorder`, transactional), pagination/search/filter/allowlisted sorting, wallpaper counts (total + published, single grouped query), audit logging.
- Deleting a category removes only join rows (FK cascade on `wallpaper_categories`).
- Verified: `test/categories.e2e-spec.ts` 7/7.

## Phase 6 - Wallpapers ✅

- Create (from media), bulk create (per-item results), upload+create in one step (`POST /admin/wallpapers/upload`, compensating media deletion), get, list (search title/description/tags, filter category/uncategorized/published/featured/orientation, sort createdAt/publishedAt/popularity/downloads/views/sortOrder/title), update (metadata, image swap with orientation recompute, category replacement), publish/unpublish (`publishedAt` set on first publish), delete (optional media cleanup).
- `PATCH /admin/wallpapers/bulk`: PUBLISH, UNPUBLISH, FEATURE, UNFEATURE, ADD_CATEGORIES, REMOVE_CATEGORIES, REORDER, DELETE - set-based in one transaction, unknown ids reported per item.
- `GET /admin/categories/:id/wallpapers`.
- Verified: `test/wallpapers.e2e-spec.ts` 10/10 (incl. category deletion keeps wallpapers).

## Phases 7-9 - Public API, remote config, home sections & banners ✅

Built and verified together because the home feed aggregates sections, banners and settings.

- **Public API** (`/api/v1/public/*`, `@Public()`, read-only): `home`, `app-config`, `categories`, `categories/:slug`, `wallpapers` (filters categoryId/categorySlug/orientation/q, sorts latest/popular/downloads/featured/manual), `wallpapers/search` (q 2-100 chars), `wallpapers/featured|latest|popular`, `wallpapers/:id`.
  - Every query is constrained to published wallpapers; category filters / detail categories only match published categories (unpublished -> 404). Responses are built from explicit allowlisted selects (no counters, storage keys, admin ids, publish flags).
  - `downloadUrl` follows settings: original, preview (originals disabled) or null (downloads disabled).
  - `Cache-Control: public, max-age=<PUBLIC_CACHE_TTL_SECONDS>, stale-while-revalidate` on successful GETs; settings/home cached in-process (`TtlCache`, single-flight, cleared on settings update).
  - Search escapes LIKE metacharacters (`%`, `_`, `\`) - found and fixed via an e2e test in this phase (also applies to admin search).
- **Remote config** (`GET/PATCH /admin/settings`, PATCH = SUPER_ADMIN): single JSON document (maintenance, per-platform version policy, announcements, home, downloads, external links, typed boolean feature flags). Partial updates are deep-merged (prototype-pollution keys dropped) and the merged document is fully validated (unknown keys rejected, safe URLs, semver, min <= latest). Optimistic concurrency with `expectedVersion` (409). Audit logged.
  - `GET /public/app-config?platform=&appVersion=` returns an allowlisted projection (no versions/admin data/secrets) plus computed `update.status` NONE/AVAILABLE/REQUIRED and only currently active announcements, and the enabled home layout.
- **Home sections** (`/admin/home-sections`): CRUD + reorder; `configuration` validated per section type (unknown keys rejected, referenced categories/wallpapers must exist).
- **Banners** (`/admin/banners`): CRUD + reorder, image via media (delete of referenced media -> 409), activation + schedule (`endsAt > startsAt`). Actions: NONE (no value), OPEN_WALLPAPER / OPEN_CATEGORY (target must exist), OPEN_URL (https only, no credentials, no private/loopback hosts, optional `BANNER_URL_ALLOWED_HOSTS`; re-checked on read).
- **Home feed** (`GET /public/home`): bounded query count independent of section count - one query per distinct feed (type + orientation), one `ROW_NUMBER()` window query per category-section sort, one batched id lookup, category and banner queries. Empty sections omitted; banners whose targets are unpublished, inactive or out of schedule are hidden.
- `TtlCache` fix: a load in flight during `clear()` can no longer repopulate the cache with stale data.
- Verified (actually executed):
  - `npx tsc --noEmit` clean.
  - Unit: 24/24 (3 suites; new `utils.spec.ts`, `public-cache.interceptor.spec.ts`).
  - E2E: 59/59 (7 suites; new `public.e2e-spec.ts` 6, `settings.e2e-spec.ts` 7, `home-banners.e2e-spec.ts` 5; earlier suites unchanged and passing).

## Phase 10 - Analytics ✅

- `POST /public/events` (public, `events` rate-limit profile, 202): batches of 1-50 `{ wallpaperId, type, platform?, appVersion? }`; strict enums, unknown fields rejected; server-assigned timestamps.
  - Only published wallpapers are counted (one lookup per batch); result `{ accepted, duplicates, rejected }`.
  - Dedupe by a salted per-process SHA-256 of (client IP, wallpaper, type) within a window (views 30 min, download click / download 5 min). The IP is never stored or logged; the stored raw event has no client identifier at all (verified by a schema-column assertion in tests).
  - In-memory buffer flushed every `ANALYTICS_FLUSH_INTERVAL_MS` (or at 5,000 events) in one transaction: raw rows + `wallpaper_daily_stats` upsert + wallpaper counter increments, all set-based via `unnest` (3 statements per flush regardless of batch size). Events for wallpapers deleted in the meantime are skipped. Failed flushes are retried (3 attempts), buffer bounded (50k).
  - Graceful shutdown flushes the buffer (`PrismaService` now disconnects in `onApplicationShutdown`, after all `onModuleDestroy` hooks).
  - Raw events pruned hourly after `ANALYTICS_RAW_EVENT_RETENTION_DAYS` in batches; daily aggregates kept.
- Admin reports (`/admin/analytics/*`, both roles, UTC dates, default last 30 days, max 366): `overview` (totals, previous period, all-time, zero-filled daily series), `downloads` (clicks vs confirmed downloads, conversion, platform split), `popular-wallpapers`, `popular-categories` (metric = views | downloadClicks | downloads). All read the daily aggregate table.
- Known trade-offs: dedupe/buffer state is per instance; a hard crash can lose up to one flush interval; clients behind one NAT IP share the dedupe key.

## Phase 11 - Dashboard & audit logs ✅

- `/admin/dashboard/overview` (content counts, analytics today/7/30 days, top wallpapers last 7 days), `recent-wallpapers`, `storage` (bytes/count per variant, unused originals, provider), `recent-activity` (SUPER_ADMIN, same rule as `/admin/audit-logs`).
- Audit log coverage verified end-to-end; sanitized output checked to contain no passwords, tokens or hashes.
- Fixed during this phase: query `limit` parsed via DTO (previously `DefaultValuePipe` silently mapped `limit=abc` to the default).
- Verified (actually executed): `tsc` clean; `analytics.e2e-spec.ts` 7/7, `dashboard.e2e-spec.ts` 3/3.

## Phase 12 - Hardening, Swagger, Docker, documentation ✅

- **Access-token revocation:** `admins.token_version` (migration `20261009120000_admin_token_version`, additive) is embedded in access tokens as `ver` and checked by `JwtAuthGuard`. Password change and SUPER_ADMIN password reset bump it, so outstanding access tokens stop working immediately (previously they stayed valid for up to 15 minutes). Covered by a new auth e2e test.
- **OpenAPI:** 71 operations, all with summaries, tags and examples. `test/openapi.e2e-spec.ts` builds the document and asserts:
  - every operation is documented;
  - admin operations declare bearer auth (except login/refresh/csrf/logout) and public ones don't;
  - **every protected admin route returns 401 without a token** (deny-by-default proven at runtime);
  - `/public` has no write endpoints other than `POST /public/events`.
- **Docker:**
  - `Dockerfile` (multi-stage `node:22-bookworm-slim`; `runtime` target non-root with HEALTHCHECK; `migrate` target for `prisma migrate deploy`).
  - `docker-compose.yml` (postgres:18 with healthcheck, one-off migrate job, api with `init` and a 30 s stop grace period, optional MinIO profile with bucket init).
  - `.dockerignore`.
  - `db:seed:prod` script (`node dist/prisma/seed.js`).
- **Docs:** `README.md` (setup, scripts, migration rules, Docker, production guidance, scaling, backup/restore strategy), `API_INTEGRATION.md` (mobile and dashboard flows, auth/refresh/CSRF, events, error codes, fetch snippet).
- **Dependency audit:** production dependencies were brought to `npm audit --omit=dev` = **0 vulnerabilities** by a scoped override (`@nestjs/swagger` → `js-yaml ^5.4.2`, a patch-level fix within the same major; the upstream fix requires NestJS 12).

### Verification (actually executed on this machine)

- `npx tsc --noEmit`: clean.
- `npm run build`: OK (`dist/src/main.js`, `dist/prisma/seed.js`).
- Production smoke test of the compiled build (`NODE_ENV=production`, `node dist/src/main.js`):
  - `/api/v1/health` returns 200 with the database up;
  - `/api/docs` returns 404 (Swagger off);
  - public responses carry `Cache-Control: public, max-age=30, stale-while-revalidate=60`.
- Compiled seed (`node dist/prisma/seed.js`): ran and was idempotent.
- `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma`: "No difference detected" after applying all migrations.
- Final run, after all changes including the dependency override:
  - `tsc` exit 0;
  - `npm run build` exit 0;
  - `npm test`: **24/24 passed** (3 suites);
  - `npm run test:e2e`: **74/74 passed** (10 suites: auth 17, media 8, categories 7, wallpapers 10, public 6, settings 7, home-banners 5, analytics 7, dashboard 3, openapi 4) against PostgreSQL 18.
  - The `ERROR ... Simulated storage failure` / 502 log lines in the e2e output come from the media test that deliberately injects a storage failure.

### Known limitations / blockers

- **Docker is not installed on this machine.** The Dockerfile and compose file were written but **not built or run here**. Only the compose YAML was parse-checked. Build them in CI or on a Docker host before relying on them.
- Graceful shutdown was verified via `app.close()` in e2e (analytics buffer flushed before disconnect). A real SIGTERM could not be sent on Windows.
- Remaining `npm audit` findings are **dev-only tooling** (23: 19 moderate, 4 high): the Prisma CLI (`deepmerge-ts`, `mysql2`, unused with PostgreSQL) and Jest coverage (`js-yaml@3`, `sprintf-js`). The fixes are breaking upgrades. None of these ship in the `runtime` image. The `migrate` image contains the Prisma CLI but only runs `migrate deploy` on committed files.
- Per-instance state (rate-limit counters, analytics dedupe and buffer, short TTL caches) is a deliberate trade-off that avoids Redis; see README "Scaling".
- Version choice: NestJS 11 and Prisma 7 are the current stable majors installed. Prisma 7 needs `--experimental-vm-modules` for Jest (WASM query compiler), and this is wired into the npm scripts.
