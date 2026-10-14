# API Integration Guide

How the **mobile app** and the **Admin Dashboard** talk to the Wallpaper CMS API. The interactive
reference (every route, schema and example) is the OpenAPI document at `/api/docs`
(`/api/docs-json` for code generation), when Swagger is enabled.

- Base URL: `https://<api-host>/api/v1`
- Public (mobile) routes: `/api/v1/public/*`. No login, read-only except `POST /public/events`.
- Admin routes: `/api/v1/admin/*`. Every route needs `Authorization: Bearer <accessToken>` except
  `auth/login`, `auth/refresh`, `auth/csrf` and `auth/logout`.
- Health: `GET /api/v1/health` returns `200 {"data":{"status":"ok","database":"up",...}}`, or `503`.

## Conventions

**Envelope.** Successful responses are `{ "data": ... }`. Paginated lists add `meta`:

```json
{ "data": [ ... ], "meta": { "page": 1, "limit": 20, "total": 134, "totalPages": 7 } }
```

Pagination params: `page` (≥ 1, default 1) and `limit` (1–100, default 20).

**Errors.** Errors always have this shape:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Validation failed",
  "details": ["title must be shorter than or equal to 150 characters"],
  "path": "/api/v1/admin/wallpapers",
  "timestamp": "2026-10-08T20:00:00.000Z",
  "requestId": "4f6c..."
}
```

| Status    | Meaning                                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| 400       | Validation error. Unknown body or query fields are also rejected.                                                          |
| 401       | Missing, invalid or expired access token; bad credentials. A locked account gets the same generic message on purpose.      |
| 403       | Wrong role, disabled account, or invalid CSRF token.                                                                       |
| 404       | Not found. Public routes also return 404 for unpublished items.                                                            |
| 409       | Conflict: duplicate slug or email, media in use, or a stale settings version.                                              |
| 413 / 415 | Upload too large / unsupported image type.                                                                                 |
| 429       | Rate limited. Wait the number of seconds in `Retry-After` (or `Retry-After-auth` / `Retry-After-events` for those limits). |
| 502       | Object storage failure during upload. Safe to retry.                                                                       |

Send `X-Request-Id` to correlate logs. The API echoes it back (or generates one).

**IDs** are UUIDv7 strings. **Timestamps** are ISO-8601 UTC. Analytics dates are `YYYY-MM-DD` (UTC).

---

## Mobile app (public API)

No authentication. Treat the API as public: everything returned is meant for every app user.
Unpublished wallpapers and categories are never returned. CORS does not apply to native apps, and
the API does not rely on it for protection.

### Startup

1. `GET /public/app-config?platform=ANDROID&appVersion=1.4.2` (`platform`: `ANDROID` | `IOS` | `OTHER`).
   - `maintenance.enabled`: show the maintenance screen with `title` / `message`.
   - `update.status`: `REQUIRED` means block and send the user to `update.android.storeUrl`; `AVAILABLE` means suggest an update; `NONE` means up to date. This field is only present when both `platform` and `appVersion` are sent.
   - `announcements[]`: messages that are active right now (`level`: `INFO` | `WARNING` | `PROMO`).
   - `downloads.enabled` / `allowOriginalDownload` / `disabledMessage`.
   - `home.layout`: the enabled home sections in order (id, title, type).
   - `links`: privacy policy, terms, support email, website and other links.
   - `features`: boolean feature flags.
   - `serverTime`.
2. `GET /public/home`: the home screen, fully resolved:

```json
{ "data": { "sections": [
  { "id": "…", "title": "Highlights", "type": "BANNERS", "items": [
    { "id": "…", "title": "Summer pack", "subtitle": null, "imageUrl": "https://cdn…/preview.webp",
      "thumbnailUrl": "https://cdn…/thumbnail.webp", "width": 2048, "height": 1024,
      "action": { "type": "OPEN_CATEGORY", "categoryId": "…", "categorySlug": "summer" } } ] },
  { "id": "…", "title": "Featured", "type": "FEATURED_WALLPAPERS", "items": [ <WallpaperSummary> ] },
  { "id": "…", "title": "Nature", "type": "CATEGORY_WALLPAPERS", "category": { "id": "…", "name": "Nature", "slug": "nature" }, "items": [ … ] },
  { "id": "…", "title": "Categories", "type": "CATEGORIES", "items": [ <Category> ] }
] } }
```

Section types: `BANNERS`, `FEATURED_WALLPAPERS`, `POPULAR_WALLPAPERS`, `LATEST_WALLPAPERS`,
`CATEGORY_WALLPAPERS`, `CUSTOM_WALLPAPERS`, `CATEGORIES`. Empty sections are omitted. Ignore
section types you don't recognize so that new types don't break older app versions.

Banner `action.type` values:

- `NONE`
- `OPEN_WALLPAPER` (`wallpaperId`)
- `OPEN_CATEGORY` (`categoryId`, `categorySlug`)
- `OPEN_URL` (`url`, always `https`)

### Browsing

| Route                                                    | Notes                                                                                                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /public/categories`                                 | Published categories in manual order. Each includes `wallpaperCount` (published only), `thumbnailUrl` and `previewUrl`.                                                         |
| `GET /public/categories/{slug}`                          | A single category.                                                                                                                                                              |
| `GET /public/wallpapers`                                 | Filters: `categoryId` or `categorySlug`, `orientation` (`PORTRAIT`/`LANDSCAPE`/`SQUARE`), `q`. Sort: `sort=latest` (default) / `popular` / `downloads` / `featured` / `manual`. |
| `GET /public/wallpapers/search?q=sunset`                 | `q` is 2–100 characters. Matches the title (substring) or a tag (exact). Accepts the same filters.                                                                              |
| `GET /public/wallpapers/featured`, `/latest`, `/popular` | Feeds. Optional `orientation`.                                                                                                                                                  |
| `GET /public/wallpapers/{id}`                            | Detail: description, tags, categories, `downloadUrl`.                                                                                                                           |

`WallpaperSummary` = `{ id, title, slug, thumbnailUrl, previewUrl, width, height, orientation, isFeatured }`.

**Images.** Use `thumbnailUrl` (WebP, ≤ 480 px on the long side) in grids and `previewUrl` (WebP,
≤ 2048 px) on the detail screen. For the file the user saves, use `downloadUrl` from the detail
response:

- the full-resolution original when the admin allows it,
- the preview when only previews are allowed,
- `null` when downloads are disabled (show `downloads.disabledMessage`).

Media URLs are immutable and cacheable forever.

**Caching.** Public responses carry `Cache-Control: public, max-age=<PUBLIC_CACHE_TTL_SECONDS>`.
Clients can rely on HTTP caching, and a CDN can sit in front of `/api/v1/public/*`.

### Analytics events

`POST /public/events` → `202 { "data": { "accepted": 2, "duplicates": 0, "rejected": 0 } }`

```json
{
  "events": [
    { "wallpaperId": "…", "type": "WALLPAPER_VIEW", "platform": "ANDROID", "appVersion": "1.4.2" },
    { "wallpaperId": "…", "type": "WALLPAPER_DOWNLOAD_CLICK" },
    { "wallpaperId": "…", "type": "WALLPAPER_DOWNLOAD" }
  ]
}
```

- `WALLPAPER_VIEW`: the detail screen was opened.
- `WALLPAPER_DOWNLOAD_CLICK`: the user tapped download or apply.
- `WALLPAPER_DOWNLOAD`: the file was saved or applied successfully.

Batch events (1–50 per request) and send them every few seconds or when the app goes to the
background. Don't send them one at a time. The endpoint has its own rate limit (default 120
requests per minute per IP).

Repeats from the same client within a short window count once. Events for unpublished wallpapers
are ignored. Counters update a few seconds later because events are flushed in batches.

No personal data is collected. Don't send device IDs or user IDs; unknown fields are rejected.

---

## Admin Dashboard

### Authentication

```
POST /admin/auth/login   { "email": "...", "password": "..." }
→ 200 { data: { accessToken, tokenType: "Bearer", expiresIn: 900, csrfToken, admin: { id, name, email, role } } }
  Set-Cookie: refresh_token=…; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/admin/auth
  Set-Cookie: csrf_token=…;   Secure; SameSite=Strict; Path=/
```

- Keep the **access token in memory only** (not in localStorage). Send it as
  `Authorization: Bearer <token>`. It is valid for `expiresIn` seconds (default 15 minutes).
- The refresh token is an HttpOnly cookie. Dashboard JavaScript never sees it.
- **Refresh:** `POST /admin/auth/refresh` with `credentials: 'include'` and header
  `X-CSRF-Token: <csrfToken>` (from the login response or the `csrf_token` cookie). It returns a
  new access token and **rotates** the refresh cookie.
  - Refresh shortly before expiry, or on a 401, and then retry the request once.
  - Run a single refresh at a time. Parallel refreshes within a short grace window are tolerated, but reusing an old refresh token later revokes every session in that family.
- After a page reload, call `POST /admin/auth/refresh` to get a new access token. If the dashboard
  is on another site and can't read the `csrf_token` cookie, call `GET /admin/auth/csrf`
  (`credentials: 'include'`) first.
- **Logout:** `POST /admin/auth/logout` with the `X-CSRF-Token` header. Returns 204 and clears the cookies.
- `GET /admin/auth/me` returns the current profile.
- `POST /admin/auth/change-password` takes `{ currentPassword, newPassword }`. It ends **all**
  sessions, and existing access tokens stop working immediately, so the user must log in again.
- Passwords need 12+ characters with at least 3 of: lowercase, uppercase, digit, symbol. 5 failed
  logins lock the account for 15 minutes. While locked, logins return the generic 401; a
  SUPER_ADMIN password reset clears the lock.
- Cross-origin setup: the dashboard origin must be listed in `CORS_ORIGINS`. Use
  `credentials: 'include'` for the auth routes. If the dashboard and API are on different sites,
  set `COOKIE_SAME_SITE=none` (with `COOKIE_SECURE=true`).

**Roles.** `SUPER_ADMIN` can do everything. `EDITOR` manages content but cannot:

- manage admins,
- change settings (`PATCH /admin/settings`),
- read audit logs or `dashboard/recent-activity`,
- run media cleanup.

### Content workflow

1. **Upload images.**
   - `POST /admin/media` (multipart field `file`) or `POST /admin/media/bulk` (repeatable `files`, with per-file results).
   - JPEG, PNG and WebP only. Limits come from the `MEDIA_*` settings (default 25 MB per file, 200–12000 px).
   - Each upload stores the original plus WebP preview and thumbnail variants. The response includes the media `id` and URLs.
2. **Create wallpapers.**
   - `POST /admin/wallpapers` with `{ mediaId, title, description?, categoryIds?, tags?, isPublished?, isFeatured?, sortOrder? }`.
   - `POST /admin/wallpapers/bulk` creates many at once.
   - `POST /admin/wallpapers/upload` uploads and creates in one step (multipart `files` plus optional `categoryIds`, `isPublished`, `isFeatured`).
   - Width, height and orientation come from the image.
3. **Publish.** `PATCH /admin/wallpapers/{id}/publish` with `{ isPublished }`, or `PATCH /admin/wallpapers/bulk` with
   `{ action, ids, categoryIds?, items? }`. Bulk actions: `PUBLISH`, `UNPUBLISH`, `FEATURE`, `UNFEATURE`,
   `ADD_CATEGORIES`, `REMOVE_CATEGORIES`, `REORDER`, `DELETE`.
4. **Categories.** CRUD at `/admin/categories`. Cover image via `PATCH /admin/categories/{id}/cover`
   with `{ mediaId | null }`. Order via `PATCH /admin/categories/reorder` with
   `{ items: [{ id, sortOrder }] }`. Deleting a category keeps its wallpapers.
5. **Home screen.**
   - Manage sections at `/admin/home-sections`. `configuration` depends on the section type:

     | Type                                                               | `configuration`                                                                  |
     | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
     | `BANNERS`                                                          | `{ limit? }`                                                                     |
     | `FEATURED_WALLPAPERS` / `POPULAR_WALLPAPERS` / `LATEST_WALLPAPERS` | `{ limit?, orientation? }`                                                       |
     | `CATEGORY_WALLPAPERS`                                              | `{ categoryId, limit?, orientation?, sort?: "latest" \| "popular" \| "manual" }` |
     | `CUSTOM_WALLPAPERS`                                                | `{ wallpaperIds: [...] }`                                                        |
     | `CATEGORIES`                                                       | `{ categoryIds?: [...] \| null, limit? }`                                        |

   - `limit` is 1–50 and defaults to the `home.defaultSectionLimit` setting.
   - Banners: `/admin/banners` with `{ title, subtitle?, imageMediaId, actionType, actionValue, isActive, startsAt?, endsAt? }`.
6. **Remote config.**
   - `GET /admin/settings` returns `{ version, settings, updatedAt, updatedBy }`.
   - `PATCH /admin/settings` takes a partial document plus `expectedVersion`, which prevents overwriting someone else's change (a stale version returns 409).
   - Objects are merged, arrays are replaced, and the merged document is validated in full.
7. **Insights.**
   - `/admin/dashboard/overview`, `recent-wallpapers`, `storage`, `recent-activity`.
   - `/admin/analytics/overview|downloads|popular-wallpapers|popular-categories?from=YYYY-MM-DD&to=YYYY-MM-DD&metric=downloads&limit=10`.
   - Date ranges default to the last 30 days, with a maximum of 366.

Deleting media that is still referenced by a wallpaper, category cover or banner returns `409`.
Orphaned media can be listed with `GET /admin/media?unused=true` and cleaned with
`POST /admin/media/cleanup?dryRun=false` (SUPER_ADMIN only).

### Typical client snippet (fetch)

```ts
let accessToken: string | null = null;

async function api(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const res = await fetch(`${API}/api/v1${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });
  if (res.status === 401 && retry && (await refresh())) return api(path, init, false);
  return res;
}

let refreshing: Promise<boolean> | null = null;
function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    const csrf = document.cookie.match(/(?:^|; )csrf_token=([^;]+)/)?.[1] ?? '';
    const res = await fetch(`${API}/api/v1/admin/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': decodeURIComponent(csrf) },
    });
    if (!res.ok) {
      accessToken = null;
      return false;
    }
    accessToken = (await res.json()).data.accessToken;
    return true;
  })().finally(() => (refreshing = null));
  return refreshing;
}
```

## Localization, random order, related wallpapers, and category deletion

These contracts were added without changing existing identifiers. Image URLs and IDs are never translated.

**Locale.** Public catalog, home, banner, section, announcement, and app-config reads accept `lang=ar|tr|en`. Precedence is:

1. An explicit `lang` query when it is `ar`, `tr`, or `en`.
2. The first supported tag in `Accept-Language`, ordered by quality.
3. English.

Text fallback is the requested locale, then the English translation, then the legacy parent column, then any other stored translation (`ar`, then `tr`). Empty strings count as missing. The migration does not invent translations for existing names; those rows keep their legacy text until an administrator saves a translation. Responses set `Vary: Accept-Language`.

Admin create and update bodies accept `translations: [{ locale, name|title, description|subtitle|message }]`. When that array is present it replaces the stored rows. When it is omitted, a legacy `name` or `title` still updates the English row so older clients keep working.

**Random order.** `GET /api/v1/public/wallpapers?sort=random&seed=<8-64 url-safe characters>`. If `seed` is omitted the server generates one and returns it in `meta.seed`. Reuse that seed for later pages. Order is `md5(id || ':' || seed)`, then `id`, with the existing offset pagination. It is stable for one seed and does not use `ORDER BY random()`. Admin lists are not randomized. Featured, popular, latest, and search keep their existing sorts.

**Related wallpapers.** `GET /api/v1/public/wallpapers/:id/related?page=1&limit=20` is registered before `GET /wallpapers/:id`. Ranking uses shared categories, then shared tags, then the same orientation. Published wallpapers with no overlap remain as a fallback. The source wallpaper is excluded.

**Category deletion.** `GET /api/v1/admin/categories/:id/deletion-impact` returns associated, exclusive, and shared wallpaper counts plus media eligible for cleanup. `DELETE /api/v1/admin/categories/:id?deleteExclusiveWallpapers=true` deletes the category and, only when that flag is true, wallpapers whose only category is the one being deleted. Shared wallpapers stay. Media files are removed after the transaction only when nothing else references them. The operation is written to the audit log. The default remains `deleteExclusiveWallpapers=false`.

