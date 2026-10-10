# Wallpaper CMS API — مرجع الفرونت

ملف واحد مأخوذ من Swagger الحي (`/api/docs`). كل قسم فيه كل عملياته: المسار، الصلاحية، البارامترات، مثال الطلب، ومثال الرد.

## قبل ما تبلش

- العنوان المحلي: `http://localhost:3000`
- كل المسارات تحت `/api/v1`.
- الرد الناجح دائماً `{ "data": ... }`. القوائم المرقمة تضيف `meta`: `{ page, limit, total, totalPages }`.
- الخطأ: `{ statusCode, error, message, details?, path, timestamp, requestId }`.
- لوحة الإدارة: بعد `POST /admin/auth/login` خذ `data.accessToken` وأرسله في كل طلب إداري: `Authorization: Bearer <accessToken>`.
- `refresh_token` كوكي HttpOnly على المسار `/api/v1/admin/auth`. التحديث وتسجيل الخروج يرسلان `X-CSRF-Token` بنفس قيمة `csrfToken`، مع `credentials: include`.
- مسارات `/public` لا تحتاج توكن.
- الأدوار: `EDITOR` يدير المحتوى. `SUPER_ADMIN` يدير الأدمن والإعدادات وسجل التدقيق والتنظيف.

## الأقسام

- [Public](#public) — 11 عملية
- [Health](#health) — 1 عملية
- [Admin / Auth](#admin-auth) — 6 عملية
- [Admin / Admins](#admin-admins) — 6 عملية
- [Admin / Media](#admin-media) — 6 عملية
- [Admin / Categories](#admin-categories) — 8 عملية
- [Admin / Wallpapers](#admin-wallpapers) — 9 عملية
- [Admin / Banners](#admin-banners) — 6 عملية
- [Admin / Home Sections](#admin-home-sections) — 6 عملية
- [Admin / Settings](#admin-settings) — 2 عملية
- [Admin / Analytics](#admin-analytics) — 4 عملية
- [Admin / Dashboard](#admin-dashboard) — 4 عملية
- [Admin / Audit Logs](#admin-audit-logs) — 1 عملية

## Public

تطبيق الموبايل. بدون تسجيل دخول. القراءة فقط ما عدا إرسال الأحداث. لا تُرجَع خلفيات أو تصنيفات غير منشورة.

### GET `/api/v1/public/home`

**Home feed**

Enabled home sections in order, each resolved to published content (banners, featured, popular, latest, category, custom, categories). Constant number of queries regardless of section count; cached briefly.

- الصلاحية: بدون توكن

**الردود**

- **200**

```json
{
  "data": {
    "sections": [
      {
        "id": "01928c1e-...",
        "title": "Featured",
        "type": "FEATURED_WALLPAPERS",
        "items": [
          {
            "id": "01928c1e-0000-7000-8000-00000000a001",
            "title": "Mountain Wallpaper",
            "slug": "mountain-wallpaper",
            "thumbnailUrl": "https://cdn.example.com/media/2026/01/x/thumbnail.webp",
            "previewUrl": "https://cdn.example.com/media/2026/01/x/preview.webp",
            "width": 1440,
            "height": 3200,
            "orientation": "PORTRAIT",
            "isFeatured": false
          }
        ]
      },
      {
        "id": "01928c1e-...",
        "title": "Categories",
        "type": "CATEGORIES",
        "items": [
          {
            "id": "01928c1e-0000-7000-8000-00000000c001",
            "name": "Nature",
            "slug": "nature",
            "description": "Mountains, forests and oceans",
            "thumbnailUrl": "https://cdn.example.com/media/2026/01/c/thumbnail.webp",
            "previewUrl": "https://cdn.example.com/media/2026/01/c/preview.webp",
            "wallpaperCount": 40
          }
        ]
      }
    ]
  }
}
```

- **429** — Rate limit exceeded

### GET `/api/v1/public/app-config`

**Remote app configuration**

Allowlisted, secret-free configuration: maintenance, version policy (pass platform + appVersion for a computed update status), announcements, download availability, home layout, links and feature flags.

- الصلاحية: بدون توكن

**البارامترات**

- `platform` — query — اختياري — string — أحد: ANDROID | IOS | OTHER — Enables the computed `updateStatus` field
- `appVersion` — query — اختياري — string

**الردود**

- **200**

```json
{
  "data": {
    "maintenance": {
      "enabled": false,
      "title": "Under maintenance",
      "message": "...",
      "estimatedEndAt": null
    },
    "update": {
      "android": {
        "minSupportedVersion": "1.0.0",
        "latestVersion": "1.2.0",
        "updateRequiredMessage": "...",
        "updateAvailableMessage": "...",
        "storeUrl": null
      },
      "ios": {
        "minSupportedVersion": "1.0.0",
        "latestVersion": "1.2.0",
        "updateRequiredMessage": "...",
        "updateAvailableMessage": "...",
        "storeUrl": null
      },
      "status": "AVAILABLE"
    },
    "announcements": [],
    "downloads": {
      "enabled": true,
      "allowOriginalDownload": true,
      "disabledMessage": "..."
    },
    "home": {
      "bannersEnabled": true,
      "layout": [
        {
          "id": "01928c1e-...",
          "title": "Featured",
          "type": "FEATURED_WALLPAPERS"
        }
      ]
    },
    "links": {
      "privacyPolicyUrl": null,
      "termsOfServiceUrl": null,
      "supportEmail": null,
      "websiteUrl": null,
      "other": []
    },
    "features": {},
    "serverTime": "2026-01-01T00:00:00.000Z"
  }
}
```

- **400** — Validation failed
- **429** — Rate limit exceeded

### GET `/api/v1/public/categories`

**Published categories (manual order)**

- الصلاحية: بدون توكن

**البارامترات**

- `page` — query — اختياري — number — افتراضي: 1 — أدنى: 1
- `limit` — query — اختياري — number — افتراضي: 20 — أدنى: 1 — أقصى: 100

**الردود**

- **200**

```json
{
  "data": [
    {
      "id": "01928c1e-0000-7000-8000-00000000c001",
      "name": "Nature",
      "slug": "nature",
      "description": "Mountains, forests and oceans",
      "thumbnailUrl": "https://cdn.example.com/media/2026/01/c/thumbnail.webp",
      "previewUrl": "https://cdn.example.com/media/2026/01/c/preview.webp",
      "wallpaperCount": 40
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

- **400** — Validation failed
- **429** — Rate limit exceeded

### GET `/api/v1/public/categories/{slug}`

**Published category by slug**

List its wallpapers with GET /public/wallpapers?categorySlug=<slug>.

- الصلاحية: بدون توكن

**البارامترات**

- `slug` — path — مطلوب — string

**الردود**

- **200**

```json
{
  "data": {
    "id": "01928c1e-0000-7000-8000-00000000c001",
    "name": "Nature",
    "slug": "nature",
    "description": "Mountains, forests and oceans",
    "thumbnailUrl": "https://cdn.example.com/media/2026/01/c/thumbnail.webp",
    "previewUrl": "https://cdn.example.com/media/2026/01/c/preview.webp",
    "wallpaperCount": 40
  }
}
```

- **400** — Malformed slug
- **404** — Category not found
- **429** — Rate limit exceeded

### GET `/api/v1/public/wallpapers`

**Published wallpapers**

Filter by categoryId / categorySlug / orientation / q; sort by latest, popular, downloads, featured or manual. Example: /public/wallpapers?page=1&limit=20&categoryId=...

- الصلاحية: بدون توكن

**البارامترات**

- `page` — query — اختياري — number — افتراضي: 1 — أدنى: 1
- `limit` — query — اختياري — number — افتراضي: 20 — أدنى: 1 — أقصى: 100
- `categoryId` — query — اختياري — string
- `categorySlug` — query — اختياري — string
- `orientation` — query — اختياري — string — أحد: PORTRAIT | LANDSCAPE | SQUARE
- `sort` — query — اختياري — string — أحد: latest | popular | downloads | featured | manual — افتراضي: "latest"
- `q` — query — اختياري — string — Optional keyword filter

**الردود**

- **200**

```json
{
  "data": [
    {
      "id": "01928c1e-0000-7000-8000-00000000a001",
      "title": "Mountain Wallpaper",
      "slug": "mountain-wallpaper",
      "thumbnailUrl": "https://cdn.example.com/media/2026/01/x/thumbnail.webp",
      "previewUrl": "https://cdn.example.com/media/2026/01/x/preview.webp",
      "width": 1440,
      "height": 3200,
      "orientation": "PORTRAIT",
      "isFeatured": false
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

- **400** — Validation failed
- **404** — Category not found
- **429** — Rate limit exceeded

### GET `/api/v1/public/wallpapers/search`

**Keyword search over published wallpapers (title and tags)**

`q` is required (2-100 chars). Accepts the same filters as /public/wallpapers.

- الصلاحية: بدون توكن

**البارامترات**

- `page` — query — اختياري — number — افتراضي: 1 — أدنى: 1
- `limit` — query — اختياري — number — افتراضي: 20 — أدنى: 1 — أقصى: 100
- `categoryId` — query — اختياري — string
- `categorySlug` — query — اختياري — string
- `orientation` — query — اختياري — string — أحد: PORTRAIT | LANDSCAPE | SQUARE
- `sort` — query — اختياري — string — أحد: latest | popular | downloads | featured | manual — افتراضي: "latest"
- `q` — query — مطلوب — string

**الردود**

- **200**

```json
{
  "data": [
    {
      "id": "01928c1e-0000-7000-8000-00000000a001",
      "title": "Mountain Wallpaper",
      "slug": "mountain-wallpaper",
      "thumbnailUrl": "https://cdn.example.com/media/2026/01/x/thumbnail.webp",
      "previewUrl": "https://cdn.example.com/media/2026/01/x/preview.webp",
      "width": 1440,
      "height": 3200,
      "orientation": "PORTRAIT",
      "isFeatured": false
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

- **400** — Validation failed
- **429** — Rate limit exceeded

### GET `/api/v1/public/wallpapers/featured`

**Featured wallpapers (manual order)**

- الصلاحية: بدون توكن

**البارامترات**

- `page` — query — اختياري — number — افتراضي: 1 — أدنى: 1
- `limit` — query — اختياري — number — افتراضي: 20 — أدنى: 1 — أقصى: 100
- `orientation` — query — اختياري — string — أحد: PORTRAIT | LANDSCAPE | SQUARE

**الردود**

- **200**

```json
{
  "data": [
    {
      "id": "01928c1e-0000-7000-8000-00000000a001",
      "title": "Mountain Wallpaper",
      "slug": "mountain-wallpaper",
      "thumbnailUrl": "https://cdn.example.com/media/2026/01/x/thumbnail.webp",
      "previewUrl": "https://cdn.example.com/media/2026/01/x/preview.webp",
      "width": 1440,
      "height": 3200,
      "orientation": "PORTRAIT",
      "isFeatured": false
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

- **429** — Rate limit exceeded

### GET `/api/v1/public/wallpapers/latest`

**Newest wallpapers (by publish date)**

- الصلاحية: بدون توكن

**البارامترات**

- `page` — query — اختياري — number — افتراضي: 1 — أدنى: 1
- `limit` — query — اختياري — number — افتراضي: 20 — أدنى: 1 — أقصى: 100
- `orientation` — query — اختياري — string — أحد: PORTRAIT | LANDSCAPE | SQUARE

**الردود**

- **200**

```json
{
  "data": [
    {
      "id": "01928c1e-0000-7000-8000-00000000a001",
      "title": "Mountain Wallpaper",
      "slug": "mountain-wallpaper",
      "thumbnailUrl": "https://cdn.example.com/media/2026/01/x/thumbnail.webp",
      "previewUrl": "https://cdn.example.com/media/2026/01/x/preview.webp",
      "width": 1440,
      "height": 3200,
      "orientation": "PORTRAIT",
      "isFeatured": false
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

- **429** — Rate limit exceeded

### GET `/api/v1/public/wallpapers/popular`

**Most popular wallpapers (confirmed downloads, then views)**

- الصلاحية: بدون توكن

**البارامترات**

- `page` — query — اختياري — number — افتراضي: 1 — أدنى: 1
- `limit` — query — اختياري — number — افتراضي: 20 — أدنى: 1 — أقصى: 100
- `orientation` — query — اختياري — string — أحد: PORTRAIT | LANDSCAPE | SQUARE

**الردود**

- **200**

```json
{
  "data": [
    {
      "id": "01928c1e-0000-7000-8000-00000000a001",
      "title": "Mountain Wallpaper",
      "slug": "mountain-wallpaper",
      "thumbnailUrl": "https://cdn.example.com/media/2026/01/x/thumbnail.webp",
      "previewUrl": "https://cdn.example.com/media/2026/01/x/preview.webp",
      "width": 1440,
      "height": 3200,
      "orientation": "PORTRAIT",
      "isFeatured": false
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

- **429** — Rate limit exceeded

### GET `/api/v1/public/wallpapers/{id}`

**Published wallpaper detail**

`downloadUrl` is the full-resolution original when allowed by settings, the preview when originals are disabled, or null when downloads are off.

- الصلاحية: بدون توكن

**البارامترات**

- `id` — path — مطلوب — string

**الردود**

- **200**

```json
{
  "data": {
    "id": "01928c1e-0000-7000-8000-00000000a001",
    "title": "Mountain Wallpaper",
    "slug": "mountain-wallpaper",
    "thumbnailUrl": "https://cdn.example.com/media/2026/01/x/thumbnail.webp",
    "previewUrl": "https://cdn.example.com/media/2026/01/x/preview.webp",
    "width": 1440,
    "height": 3200,
    "orientation": "PORTRAIT",
    "isFeatured": false,
    "description": "Golden light over the Alps",
    "tags": [
      "mountain"
    ],
    "categories": [
      {
        "id": "01928c1e-0000-7000-8000-00000000c001",
        "name": "Nature",
        "slug": "nature"
      }
    ],
    "downloadUrl": "https://cdn.example.com/media/2026/01/x/original.jpg",
    "publishedAt": "2026-01-02T10:00:00.000Z"
  }
}
```

- **400** — Invalid id
- **404** — Wallpaper not found
- **429** — Rate limit exceeded

### POST `/api/v1/public/events`

**Record anonymous wallpaper events**

Batch of 1-50 events. Only published wallpapers are counted; repeats from the same client within a short window are ignored. No personal data is stored. Events are recorded asynchronously (within a few seconds).

- الصلاحية: بدون توكن

**الطلب**

**application/json**

```json
{
  "events": [
    {
      "wallpaperId": "01928c1e-0000-7000-8000-00000000a001",
      "type": "WALLPAPER_VIEW",
      "platform": "ANDROID",
      "appVersion": "1.4.2"
    }
  ]
}
```

**الردود**

- **202**

```json
{
  "data": {
    "accepted": 2,
    "duplicates": 0,
    "rejected": 0
  }
}
```

- **400** — Validation failed
- **429** — Rate limit exceeded

## Health

فحص أن السيرفر وقاعدة البيانات شغّالان.

### GET `/api/v1/health`

**Liveness/readiness probe (checks database connectivity)**

- الصلاحية: بدون توكن

**الردود**

- **200**

```json
{
  "data": {
    "status": "ok",
    "database": "up",
    "uptimeSeconds": 123
  }
}
```

- **503** — Database unreachable

## Admin / Auth

تسجيل دخول لوحة الإدارة. التوكن القصير يُرسل في الهيدر، وتوكن التجديد يبقى كوكي HttpOnly. التحديث وتسجيل الخروج يحتاجان ترويسة X-CSRF-Token.

### POST `/api/v1/admin/auth/login`

**Admin login**

Validates credentials and returns a short-lived access token. Sets an HttpOnly `refresh_token` cookie (path `/api/v1/admin/auth`) and a readable `csrf_token` cookie. Accounts lock for 15 minutes after 5 consecutive failures.

- الصلاحية: بدون توكن

**الطلب**

**application/json** — default

```json
{
  "email": "admin@example.com",
  "password": "S3cure-Passw0rd!"
}
```

**الردود**

- **200**

```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIuLi4ifQ.signature",
    "tokenType": "Bearer",
    "expiresIn": 900,
    "csrfToken": "q2Vb3l0n9V0hR1m3m2l1nQk7d8Yp4s6t",
    "admin": {
      "id": "01928c1e-0000-7000-8000-000000000001",
      "name": "Super Admin",
      "email": "admin@example.com",
      "role": "SUPER_ADMIN"
    }
  }
}
```

- **400** — Validation failed
- **401** — Invalid email or password
- **403** — Account is disabled
- **429** — Rate limit exceeded

### POST `/api/v1/admin/auth/refresh`

**Rotate refresh token**

Exchanges the refresh-token cookie for a new access token and a new refresh token (rotation). Re-use of an already rotated token revokes the whole session family.

- الصلاحية: بدون توكن

**البارامترات**

- `X-CSRF-Token` — header — مطلوب — string — Value of the csrf_token cookie / last csrfToken

**الردود**

- **200**

```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIuLi4ifQ.signature",
    "tokenType": "Bearer",
    "expiresIn": 900,
    "csrfToken": "q2Vb3l0n9V0hR1m3m2l1nQk7d8Yp4s6t",
    "admin": {
      "id": "01928c1e-0000-7000-8000-000000000001",
      "name": "Super Admin",
      "email": "admin@example.com",
      "role": "SUPER_ADMIN"
    }
  }
}
```

- **401** — Missing, invalid, expired, or reused refresh token
- **403** — Invalid CSRF token
- **429** — Rate limit exceeded

### GET `/api/v1/admin/auth/csrf`

**Get CSRF token for the current refresh-token cookie**

For dashboards hosted on a different domain that cannot read the csrf_token cookie (e.g. after a page reload). Readable only by CORS-allowed origins.

- الصلاحية: بدون توكن

**الردود**

- **200**

```json
{
  "data": {
    "csrfToken": "q2Vb3l0n9V0hR1m3m2l1nQk7d8Yp4s6t"
  }
}
```

- **401** — No refresh-token cookie

### POST `/api/v1/admin/auth/logout`

**Logout**

Revokes the refresh-token session family and clears auth cookies. Idempotent.

- الصلاحية: بدون توكن

**البارامترات**

- `X-CSRF-Token` — header — مطلوب — string

**الردود**

- **204** — Logged out
- **403** — Invalid CSRF token

### GET `/api/v1/admin/auth/me`

**Current admin profile**

- الصلاحية: Bearer token

**الردود**

- **200**

```json
{
  "data": {
    "id": "01928c1e-0000-7000-8000-000000000001",
    "name": "Super Admin",
    "email": "admin@example.com",
    "role": "SUPER_ADMIN"
  }
}
```

- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

### POST `/api/v1/admin/auth/change-password`

**Change own password**

Requires the current password. Revokes all refresh tokens (all sessions must log in again).

- الصلاحية: Bearer token

**الطلب**

**application/json**

```json
{
  "currentPassword": "",
  "newPassword": ""
}
```

**الردود**

- **204** — Password changed
- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

## Admin / Admins

إدارة حسابات الأدمن. SUPER_ADMIN فقط.

### GET `/api/v1/admin/admins`

**List admin accounts (SUPER_ADMIN)**

- الصلاحية: Bearer token
- الدور: SUPER_ADMIN

**البارامترات**

- `page` — query — اختياري — number — افتراضي: 1 — أدنى: 1
- `limit` — query — اختياري — number — افتراضي: 20 — أدنى: 1 — أقصى: 100
- `search` — query — اختياري — string — Search by name or email
- `role` — query — اختياري — string — أحد: SUPER_ADMIN | EDITOR

**الردود**

- **200**

```json
{
  "data": [
    {
      "id": "01928c1e-0000-7000-8000-000000000001",
      "name": "Jane Editor",
      "email": "jane@example.com",
      "role": "EDITOR",
      "isActive": true,
      "lastLoginAt": null,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

### POST `/api/v1/admin/admins`

**Create an admin account (SUPER_ADMIN)**

- الصلاحية: Bearer token
- الدور: SUPER_ADMIN

**الطلب**

**application/json**

```json
{
  "name": "Jane Editor",
  "email": "jane@example.com",
  "password": "Str0ng-Initial-Pass!",
  "role": "EDITOR"
}
```

**الردود**

- **201**

```json
{
  "data": {
    "id": "01928c1e-0000-7000-8000-000000000001",
    "name": "Jane Editor",
    "email": "jane@example.com",
    "role": "EDITOR",
    "isActive": true,
    "lastLoginAt": null,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **409** — An admin with this email already exists

### GET `/api/v1/admin/admins/{id}`

**Get an admin account (SUPER_ADMIN)**

- الصلاحية: Bearer token
- الدور: SUPER_ADMIN

**البارامترات**

- `id` — path — مطلوب — string

**الردود**

- **200**

```json
{
  "data": {
    "id": "01928c1e-0000-7000-8000-000000000001",
    "name": "Jane Editor",
    "email": "jane@example.com",
    "role": "EDITOR",
    "isActive": true,
    "lastLoginAt": null,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Admin not found

### PATCH `/api/v1/admin/admins/{id}`

**Update name, role or active flag (SUPER_ADMIN)**

Cannot disable/demote yourself or remove the last active SUPER_ADMIN. Disabling revokes all sessions.

- الصلاحية: Bearer token
- الدور: SUPER_ADMIN

**البارامترات**

- `id` — path — مطلوب — string

**الطلب**

**application/json**

```json
{
  "name": "Jane Doe",
  "role": "SUPER_ADMIN",
  "isActive": false
}
```

**الردود**

- **200**

```json
{
  "data": {
    "id": "01928c1e-0000-7000-8000-000000000001",
    "name": "Jane Editor",
    "email": "jane@example.com",
    "role": "EDITOR",
    "isActive": true,
    "lastLoginAt": null,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Admin not found

### DELETE `/api/v1/admin/admins/{id}`

**Delete an admin account (SUPER_ADMIN)**

Audit history is preserved (admin reference set to null).

- الصلاحية: Bearer token
- الدور: SUPER_ADMIN

**البارامترات**

- `id` — path — مطلوب — string

**الردود**

- **204**
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Admin not found

### PATCH `/api/v1/admin/admins/{id}/password`

**Reset another admin's password (SUPER_ADMIN)**

Revokes all of their sessions and clears lockout.

- الصلاحية: Bearer token
- الدور: SUPER_ADMIN

**البارامترات**

- `id` — path — مطلوب — string

**الطلب**

**application/json**

```json
{
  "newPassword": ""
}
```

**الردود**

- **204**
- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Admin not found

## Admin / Media

رفع الصور. الحقل multipart اسمه file (أو files للرفع المتعدد). JPEG / PNG / WebP.

### GET `/api/v1/admin/media`

**List uploaded media (originals with derivatives and usage counts)**

- الصلاحية: Bearer token

**البارامترات**

- `page` — query — اختياري — number — افتراضي: 1 — أدنى: 1
- `limit` — query — اختياري — number — افتراضي: 20 — أدنى: 1 — أقصى: 100
- `unused` — query — اختياري — boolean — Only media not referenced by any wallpaper, category or banner
- `search` — query — اختياري — string — Search by original file name
- `mimeType` — query — اختياري — string — أحد: image/jpeg | image/png | image/webp

**الردود**

- **200**

```json
{
  "data": [
    {
      "id": "01928c1e-0000-7000-8000-00000000aaaa",
      "originalFilename": "mountain.jpg",
      "original": {
        "url": "https://cdn.example.com/media/2026/01/1f0c.../original.jpg",
        "width": 1440,
        "height": 3200,
        "size": 1840000,
        "mimeType": "image/jpeg"
      },
      "preview": {
        "url": "https://cdn.example.com/media/2026/01/1f0c.../preview.webp",
        "width": 922,
        "height": 2048,
        "size": 310000,
        "mimeType": "image/webp"
      },
      "thumbnail": {
        "url": "https://cdn.example.com/media/2026/01/1f0c.../thumbnail.webp",
        "width": 216,
        "height": 480,
        "size": 21000,
        "mimeType": "image/webp"
      },
      "usage": {
        "wallpapers": 1,
        "categories": 0,
        "banners": 0
      },
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

### POST `/api/v1/admin/media`

**Upload a single image**

Multipart field `file`. The content is decoded and validated (real format must match the declared type), auto-oriented and stripped of metadata. Generates an original, a WebP preview and a WebP thumbnail.

- الصلاحية: Bearer token

**الطلب**

**multipart/form-data**

```json
{
  "file": "<file>"
}
```

**الردود**

- **201**

```json
{
  "data": {
    "id": "01928c1e-0000-7000-8000-00000000aaaa",
    "originalFilename": "mountain.jpg",
    "original": {
      "url": "https://cdn.example.com/media/2026/01/1f0c.../original.jpg",
      "width": 1440,
      "height": 3200,
      "size": 1840000,
      "mimeType": "image/jpeg"
    },
    "preview": {
      "url": "https://cdn.example.com/media/2026/01/1f0c.../preview.webp",
      "width": 922,
      "height": 2048,
      "size": 310000,
      "mimeType": "image/webp"
    },
    "thumbnail": {
      "url": "https://cdn.example.com/media/2026/01/1f0c.../thumbnail.webp",
      "width": 216,
      "height": 480,
      "size": 21000,
      "mimeType": "image/webp"
    },
    "usage": {
      "wallpapers": 1,
      "categories": 0,
      "banners": 0
    },
    "createdAt": "2026-01-01T00:00:00.000Z"
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **413** — File exceeds MEDIA_MAX_FILE_SIZE_MB
- **415** — Not a JPEG/PNG/WebP image or content/type mismatch

### POST `/api/v1/admin/media/bulk`

**Upload multiple images**

Multipart field `files` (repeatable, max MEDIA_MAX_FILES_PER_UPLOAD). Each file is processed independently; the response reports per-file success or error.

- الصلاحية: Bearer token

**الطلب**

**multipart/form-data**

```json
{
  "files": [
    "<file>"
  ]
}
```

**الردود**

- **200**

```json
{
  "data": {
    "succeeded": 1,
    "failed": 1,
    "results": [
      {
        "index": 0,
        "filename": "a.jpg",
        "status": "success",
        "item": {
          "id": "01928c1e-0000-7000-8000-00000000aaaa",
          "originalFilename": "mountain.jpg",
          "original": {
            "url": "https://cdn.example.com/media/2026/01/1f0c.../original.jpg",
            "width": 1440,
            "height": 3200,
            "size": 1840000,
            "mimeType": "image/jpeg"
          },
          "preview": {
            "url": "https://cdn.example.com/media/2026/01/1f0c.../preview.webp",
            "width": 922,
            "height": 2048,
            "size": 310000,
            "mimeType": "image/webp"
          },
          "thumbnail": {
            "url": "https://cdn.example.com/media/2026/01/1f0c.../thumbnail.webp",
            "width": 216,
            "height": 480,
            "size": 21000,
            "mimeType": "image/webp"
          },
          "usage": {
            "wallpapers": 1,
            "categories": 0,
            "banners": 0
          },
          "createdAt": "2026-01-01T00:00:00.000Z"
        }
      },
      {
        "index": 1,
        "filename": "notes.txt",
        "status": "error",
        "error": {
          "statusCode": 415,
          "message": "Only JPEG, PNG and WebP images are allowed"
        }
      }
    ]
  }
}
```

- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **413** — A file exceeds the size limit or too many files

### POST `/api/v1/admin/media/cleanup`

**Remove orphaned storage objects (SUPER_ADMIN)**

Finds stored objects with no database record (older than 1 hour). Defaults to a dry run; pass dryRun=false to delete.

- الصلاحية: Bearer token
- الدور: SUPER_ADMIN

**البارامترات**

- `dryRun` — query — اختياري — boolean — افتراضي: true — Report what would be deleted without deleting

**الردود**

- **200**

```json
{
  "data": {
    "dryRun": true,
    "scannedObjects": 300,
    "orphanedObjects": 2,
    "deletedObjects": 0,
    "orphanedKeys": [
      "media/2026/01/x/original.jpg"
    ]
  }
}
```

- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

### GET `/api/v1/admin/media/{id}`

**Get media metadata**

- الصلاحية: Bearer token

**البارامترات**

- `id` — path — مطلوب — string

**الردود**

- **200**

```json
{
  "data": {
    "id": "01928c1e-0000-7000-8000-00000000aaaa",
    "originalFilename": "mountain.jpg",
    "original": {
      "url": "https://cdn.example.com/media/2026/01/1f0c.../original.jpg",
      "width": 1440,
      "height": 3200,
      "size": 1840000,
      "mimeType": "image/jpeg"
    },
    "preview": {
      "url": "https://cdn.example.com/media/2026/01/1f0c.../preview.webp",
      "width": 922,
      "height": 2048,
      "size": 310000,
      "mimeType": "image/webp"
    },
    "thumbnail": {
      "url": "https://cdn.example.com/media/2026/01/1f0c.../thumbnail.webp",
      "width": 216,
      "height": 480,
      "size": 21000,
      "mimeType": "image/webp"
    },
    "usage": {
      "wallpapers": 1,
      "categories": 0,
      "banners": 0
    },
    "createdAt": "2026-01-01T00:00:00.000Z"
  }
}
```

- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Media not found

### DELETE `/api/v1/admin/media/{id}`

**Delete unused media**

Fails with 409 if referenced by any wallpaper, category or banner.

- الصلاحية: Bearer token

**البارامترات**

- `id` — path — مطلوب — string

**الردود**

- **204**
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Media not found
- **409** — Media is in use and cannot be deleted

## Admin / Categories

تصنيفات لوحة الإدارة، بما فيها الغلاف والترتيب.

### GET `/api/v1/admin/categories`

**List categories (paginated, searchable, with wallpaper counts)**

- الصلاحية: Bearer token

**البارامترات**

- `page` — query — اختياري — number — افتراضي: 1 — أدنى: 1
- `limit` — query — اختياري — number — افتراضي: 20 — أدنى: 1 — أقصى: 100
- `search` — query — اختياري — string — Search in name and slug
- `isPublished` — query — اختياري — boolean
- `sortBy` — query — اختياري — string — أحد: sortOrder | name | createdAt | wallpaperCount — افتراضي: "sortOrder"
- `sortDir` — query — اختياري — string — أحد: asc | desc — افتراضي: "asc"

**الردود**

- **200**

```json
{
  "data": [
    {
      "id": "01928c1e-0000-7000-8000-00000000c001",
      "name": "Nature",
      "slug": "nature",
      "description": "Mountains, forests and oceans",
      "sortOrder": 0,
      "isPublished": true,
      "cover": {
        "mediaId": "01928c1e-0000-7000-8000-00000000aaaa",
        "thumbnailUrl": "https://cdn.example.com/media/2026/01/x/thumbnail.webp",
        "previewUrl": "https://cdn.example.com/media/2026/01/x/preview.webp",
        "originalUrl": "https://cdn.example.com/media/2026/01/x/original.jpg"
      },
      "wallpaperCount": 42,
      "publishedWallpaperCount": 40,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

### POST `/api/v1/admin/categories`

**Create a category**

Slug is generated from the name when omitted; must be unique.

- الصلاحية: Bearer token

**الطلب**

**application/json**

```json
{
  "name": "Nature",
  "slug": "nature",
  "description": "Mountains, forests and oceans",
  "coverMediaId": {},
  "isPublished": false,
  "sortOrder": 0
}
```

**الردود**

- **201**

```json
{
  "data": {
    "id": "01928c1e-0000-7000-8000-00000000c001",
    "name": "Nature",
    "slug": "nature",
    "description": "Mountains, forests and oceans",
    "sortOrder": 0,
    "isPublished": true,
    "cover": {
      "mediaId": "01928c1e-0000-7000-8000-00000000aaaa",
      "thumbnailUrl": "https://cdn.example.com/media/2026/01/x/thumbnail.webp",
      "previewUrl": "https://cdn.example.com/media/2026/01/x/preview.webp",
      "originalUrl": "https://cdn.example.com/media/2026/01/x/original.jpg"
    },
    "wallpaperCount": 42,
    "publishedWallpaperCount": 40,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Cover media not found
- **409** — Slug is already in use

### PATCH `/api/v1/admin/categories/reorder`

**Reorder categories**

Sets sortOrder for the given categories in one transaction.

- الصلاحية: Bearer token

**الطلب**

**application/json**

```json
{
  "items": [
    {
      "id": "01928c1e-0000-7000-8000-000000000001",
      "sortOrder": 0
    },
    {
      "id": "01928c1e-0000-7000-8000-000000000002",
      "sortOrder": 1
    }
  ]
}
```

**الردود**

- **200**

```json
{
  "data": {
    "updated": 2
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Category not found

### GET `/api/v1/admin/categories/{id}`

**Get a category**

- الصلاحية: Bearer token

**البارامترات**

- `id` — path — مطلوب — string

**الردود**

- **200**

```json
{
  "data": {
    "id": "01928c1e-0000-7000-8000-00000000c001",
    "name": "Nature",
    "slug": "nature",
    "description": "Mountains, forests and oceans",
    "sortOrder": 0,
    "isPublished": true,
    "cover": {
      "mediaId": "01928c1e-0000-7000-8000-00000000aaaa",
      "thumbnailUrl": "https://cdn.example.com/media/2026/01/x/thumbnail.webp",
      "previewUrl": "https://cdn.example.com/media/2026/01/x/preview.webp",
      "originalUrl": "https://cdn.example.com/media/2026/01/x/original.jpg"
    },
    "wallpaperCount": 42,
    "publishedWallpaperCount": 40,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Category not found

### PATCH `/api/v1/admin/categories/{id}`

**Update a category (name, slug, description, publish state, order)**

- الصلاحية: Bearer token

**البارامترات**

- `id` — path — مطلوب — string

**الطلب**

**application/json**

```json
{
  "name": "Nature & Landscapes",
  "slug": "nature-landscapes",
  "description": {},
  "isPublished": false,
  "sortOrder": 0
}
```

**الردود**

- **200**

```json
{
  "data": {
    "id": "01928c1e-0000-7000-8000-00000000c001",
    "name": "Nature",
    "slug": "nature",
    "description": "Mountains, forests and oceans",
    "sortOrder": 0,
    "isPublished": true,
    "cover": {
      "mediaId": "01928c1e-0000-7000-8000-00000000aaaa",
      "thumbnailUrl": "https://cdn.example.com/media/2026/01/x/thumbnail.webp",
      "previewUrl": "https://cdn.example.com/media/2026/01/x/preview.webp",
      "originalUrl": "https://cdn.example.com/media/2026/01/x/original.jpg"
    },
    "wallpaperCount": 42,
    "publishedWallpaperCount": 40,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Category not found
- **409** — Slug is already in use

### DELETE `/api/v1/admin/categories/{id}`

**Delete a category**

Only the category and its wallpaper links are removed; wallpapers are kept.

- الصلاحية: Bearer token

**البارامترات**

- `id` — path — مطلوب — string

**الردود**

- **204**
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Category not found

### PATCH `/api/v1/admin/categories/{id}/cover`

**Set or remove the category cover image**

Upload the image first via POST /admin/media, then pass its id. Pass null to remove the cover.

- الصلاحية: Bearer token

**البارامترات**

- `id` — path — مطلوب — string

**الطلب**

**application/json**

```json
{
  "mediaId": {}
}
```

**الردود**

- **200**

```json
{
  "data": {
    "id": "01928c1e-0000-7000-8000-00000000c001",
    "name": "Nature",
    "slug": "nature",
    "description": "Mountains, forests and oceans",
    "sortOrder": 0,
    "isPublished": true,
    "cover": {
      "mediaId": "01928c1e-0000-7000-8000-00000000aaaa",
      "thumbnailUrl": "https://cdn.example.com/media/2026/01/x/thumbnail.webp",
      "previewUrl": "https://cdn.example.com/media/2026/01/x/preview.webp",
      "originalUrl": "https://cdn.example.com/media/2026/01/x/original.jpg"
    },
    "wallpaperCount": 42,
    "publishedWallpaperCount": 40,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Category or media not found

### GET `/api/v1/admin/categories/{id}/wallpapers`

**List wallpapers belonging to a category**

Same filters/sorting as GET /admin/wallpapers.

- الصلاحية: Bearer token

**البارامترات**

- `id` — path — مطلوب — string
- `page` — query — اختياري — number — افتراضي: 1 — أدنى: 1
- `limit` — query — اختياري — number — افتراضي: 20 — أدنى: 1 — أقصى: 100
- `search` — query — اختياري — string — Search title, description and tags
- `categoryId` — query — اختياري — string
- `uncategorized` — query — اختياري — boolean — Only wallpapers without any category
- `isPublished` — query — اختياري — boolean
- `isFeatured` — query — اختياري — boolean
- `orientation` — query — اختياري — string — أحد: PORTRAIT | LANDSCAPE | SQUARE
- `sortBy` — query — اختياري — string — أحد: createdAt | publishedAt | popularity | downloads | views | sortOrder | title — افتراضي: "createdAt"
- `sortDir` — query — اختياري — string — أحد: asc | desc — افتراضي: "desc"

**الردود**

- **200**

```json
{
  "data": [
    {
      "id": "01928c1e-0000-7000-8000-00000000w001",
      "title": "Mountain Sunrise",
      "description": "Golden light over the Alps",
      "slug": "mountain-sunrise",
      "tags": [
        "mountain",
        "sunrise"
      ],
      "orientation": "PORTRAIT",
      "width": 1440,
      "height": 3200,
      "isFeatured": true,
      "isPublished": true,
      "sortOrder": 0,
      "publishedAt": "2026-01-02T10:00:00.000Z",
      "image": {
        "mediaId": "01928c1e-0000-7000-8000-00000000aaaa",
        "thumbnailUrl": "https://cdn.example.com/media/2026/01/x/thumbnail.webp",
        "previewUrl": "https://cdn.example.com/media/2026/01/x/preview.webp",
        "originalUrl": "https://cdn.example.com/media/2026/01/x/original.jpg"
      },
      "categories": [
        {
          "id": "01928c1e-0000-7000-8000-00000000c001",
          "name": "Nature",
          "slug": "nature"
        }
      ],
      "stats": {
        "views": 1200,
        "downloadClicks": 340,
        "downloads": 310
      },
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-02T10:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Category not found

## Admin / Wallpapers

إنشاء وتعديل ونشر الخلفيات، والعمليات الجماعية.

### GET `/api/v1/admin/wallpapers`

**List wallpapers**

Search, filter by category / publish state / featured / orientation, sort by date, popularity or manual order. Paginated.

- الصلاحية: Bearer token

**البارامترات**

- `page` — query — اختياري — number — افتراضي: 1 — أدنى: 1
- `limit` — query — اختياري — number — افتراضي: 20 — أدنى: 1 — أقصى: 100
- `search` — query — اختياري — string — Search title, description and tags
- `categoryId` — query — اختياري — string
- `uncategorized` — query — اختياري — boolean — Only wallpapers without any category
- `isPublished` — query — اختياري — boolean
- `isFeatured` — query — اختياري — boolean
- `orientation` — query — اختياري — string — أحد: PORTRAIT | LANDSCAPE | SQUARE
- `sortBy` — query — اختياري — string — أحد: createdAt | publishedAt | popularity | downloads | views | sortOrder | title — افتراضي: "createdAt"
- `sortDir` — query — اختياري — string — أحد: asc | desc — افتراضي: "desc"

**الردود**

- **200**

```json
{
  "data": [
    {
      "id": "01928c1e-0000-7000-8000-00000000w001",
      "title": "Mountain Sunrise",
      "description": "Golden light over the Alps",
      "slug": "mountain-sunrise",
      "tags": [
        "mountain",
        "sunrise"
      ],
      "orientation": "PORTRAIT",
      "width": 1440,
      "height": 3200,
      "isFeatured": true,
      "isPublished": true,
      "sortOrder": 0,
      "publishedAt": "2026-01-02T10:00:00.000Z",
      "image": {
        "mediaId": "01928c1e-0000-7000-8000-00000000aaaa",
        "thumbnailUrl": "https://cdn.example.com/media/2026/01/x/thumbnail.webp",
        "previewUrl": "https://cdn.example.com/media/2026/01/x/preview.webp",
        "originalUrl": "https://cdn.example.com/media/2026/01/x/original.jpg"
      },
      "categories": [
        {
          "id": "01928c1e-0000-7000-8000-00000000c001",
          "name": "Nature",
          "slug": "nature"
        }
      ],
      "stats": {
        "views": 1200,
        "downloadClicks": 340,
        "downloads": 310
      },
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-02T10:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

### POST `/api/v1/admin/wallpapers`

**Create a wallpaper from an uploaded image**

Upload the image via POST /admin/media first, then reference its id.

- الصلاحية: Bearer token

**الطلب**

**application/json** — default

```json
{
  "title": "Mountain Sunrise",
  "mediaId": "01928c1e-0000-7000-8000-00000000aaaa",
  "categoryIds": [
    "01928c1e-0000-7000-8000-00000000c001"
  ],
  "tags": [
    "mountain",
    "sunrise"
  ],
  "isPublished": true
}
```

**الردود**

- **201**

```json
{
  "data": {
    "id": "01928c1e-0000-7000-8000-00000000w001",
    "title": "Mountain Sunrise",
    "description": "Golden light over the Alps",
    "slug": "mountain-sunrise",
    "tags": [
      "mountain",
      "sunrise"
    ],
    "orientation": "PORTRAIT",
    "width": 1440,
    "height": 3200,
    "isFeatured": true,
    "isPublished": true,
    "sortOrder": 0,
    "publishedAt": "2026-01-02T10:00:00.000Z",
    "image": {
      "mediaId": "01928c1e-0000-7000-8000-00000000aaaa",
      "thumbnailUrl": "https://cdn.example.com/media/2026/01/x/thumbnail.webp",
      "previewUrl": "https://cdn.example.com/media/2026/01/x/preview.webp",
      "originalUrl": "https://cdn.example.com/media/2026/01/x/original.jpg"
    },
    "categories": [
      {
        "id": "01928c1e-0000-7000-8000-00000000c001",
        "name": "Nature",
        "slug": "nature"
      }
    ],
    "stats": {
      "views": 1200,
      "downloadClicks": 340,
      "downloads": 310
    },
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-02T10:00:00.000Z"
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Media or category not found
- **409** — Slug is already in use

### POST `/api/v1/admin/wallpapers/bulk`

**Create many wallpapers from uploaded images**

One wallpaper per item. Items succeed or fail independently; see `results` for per-item errors.

- الصلاحية: Bearer token

**الطلب**

**application/json**

```json
{
  "items": [
    {
      "mediaId": "01928c1e-0000-7000-8000-000000000001",
      "title": "",
      "description": "",
      "tags": [
        ""
      ]
    }
  ],
  "categoryIds": [
    ""
  ],
  "isPublished": false,
  "isFeatured": false
}
```

**الردود**

- **200**

```json
{
  "data": {
    "succeeded": 1,
    "failed": 1,
    "results": [
      {
        "index": 0,
        "filename": null,
        "status": "success",
        "item": {
          "id": "01928c1e-0000-7000-8000-00000000w001",
          "title": "Mountain Sunrise",
          "description": "Golden light over the Alps",
          "slug": "mountain-sunrise",
          "tags": [
            "mountain",
            "sunrise"
          ],
          "orientation": "PORTRAIT",
          "width": 1440,
          "height": 3200,
          "isFeatured": true,
          "isPublished": true,
          "sortOrder": 0,
          "publishedAt": "2026-01-02T10:00:00.000Z",
          "image": {
            "mediaId": "01928c1e-0000-7000-8000-00000000aaaa",
            "thumbnailUrl": "https://cdn.example.com/media/2026/01/x/thumbnail.webp",
            "previewUrl": "https://cdn.example.com/media/2026/01/x/preview.webp",
            "originalUrl": "https://cdn.example.com/media/2026/01/x/original.jpg"
          },
          "categories": [
            {
              "id": "01928c1e-0000-7000-8000-00000000c001",
              "name": "Nature",
              "slug": "nature"
            }
          ],
          "stats": {
            "views": 1200,
            "downloadClicks": 340,
            "downloads": 310
          },
          "createdAt": "2026-01-01T00:00:00.000Z",
          "updatedAt": "2026-01-02T10:00:00.000Z"
        }
      },
      {
        "index": 1,
        "filename": null,
        "status": "error",
        "error": {
          "statusCode": 404,
          "message": "Media 0192... not found"
        }
      }
    ]
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

### PATCH `/api/v1/admin/wallpapers/bulk`

**Bulk update wallpapers**

Actions: PUBLISH, UNPUBLISH, FEATURE, UNFEATURE, ADD_CATEGORIES, REMOVE_CATEGORIES (need `categoryIds`), DELETE (need `ids`), REORDER (needs `items`). Unknown ids are reported per item.

- الصلاحية: Bearer token

**الطلب**

**application/json** — publish

```json
{
  "action": "PUBLISH",
  "ids": [
    "01928c1e-0000-7000-8000-00000000w001"
  ]
}
```

**application/json** — addCategories

```json
{
  "action": "ADD_CATEGORIES",
  "ids": [
    "01928c1e-0000-7000-8000-00000000w001"
  ],
  "categoryIds": [
    "01928c1e-0000-7000-8000-00000000c001"
  ]
}
```

**application/json** — reorder

```json
{
  "action": "REORDER",
  "items": [
    {
      "id": "01928c1e-0000-7000-8000-00000000w001",
      "sortOrder": 3
    }
  ]
}
```

**الردود**

- **200**

```json
{
  "data": {
    "action": "PUBLISH",
    "succeeded": 1,
    "failed": 1,
    "results": [
      {
        "id": "01928c1e-0000-7000-8000-00000000w001",
        "status": "success"
      },
      {
        "id": "01928c1e-0000-7000-8000-00000000w999",
        "status": "error",
        "error": {
          "statusCode": 404,
          "message": "Wallpaper not found"
        }
      }
    ]
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

### POST `/api/v1/admin/wallpapers/upload`

**Upload images and create wallpapers in one step**

Multipart: repeatable `files` plus optional `categoryIds` (comma-separated), `isPublished`, `isFeatured`. Titles are derived from file names.

- الصلاحية: Bearer token

**الطلب**

**multipart/form-data**

```json
{
  "files": [
    "<file>"
  ],
  "categoryIds": "01928c1e-0000-7000-8000-00000000c001",
  "isPublished": "true",
  "isFeatured": "true"
}
```

**الردود**

- **200** — Per-file results (same shape as POST /bulk)
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

### GET `/api/v1/admin/wallpapers/{id}`

**Get a wallpaper (any publish state)**

- الصلاحية: Bearer token

**البارامترات**

- `id` — path — مطلوب — string

**الردود**

- **200**

```json
{
  "data": {
    "id": "01928c1e-0000-7000-8000-00000000w001",
    "title": "Mountain Sunrise",
    "description": "Golden light over the Alps",
    "slug": "mountain-sunrise",
    "tags": [
      "mountain",
      "sunrise"
    ],
    "orientation": "PORTRAIT",
    "width": 1440,
    "height": 3200,
    "isFeatured": true,
    "isPublished": true,
    "sortOrder": 0,
    "publishedAt": "2026-01-02T10:00:00.000Z",
    "image": {
      "mediaId": "01928c1e-0000-7000-8000-00000000aaaa",
      "thumbnailUrl": "https://cdn.example.com/media/2026/01/x/thumbnail.webp",
      "previewUrl": "https://cdn.example.com/media/2026/01/x/preview.webp",
      "originalUrl": "https://cdn.example.com/media/2026/01/x/original.jpg"
    },
    "categories": [
      {
        "id": "01928c1e-0000-7000-8000-00000000c001",
        "name": "Nature",
        "slug": "nature"
      }
    ],
    "stats": {
      "views": 1200,
      "downloadClicks": 340,
      "downloads": 310
    },
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-02T10:00:00.000Z"
  }
}
```

- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Wallpaper not found

### PATCH `/api/v1/admin/wallpapers/{id}`

**Update wallpaper metadata, image, categories, tags, flags or order**

- الصلاحية: Bearer token

**البارامترات**

- `id` — path — مطلوب — string

**الطلب**

**application/json**

```json
{
  "title": "Mountain Sunrise (HD)",
  "description": {},
  "slug": "",
  "mediaId": "01928c1e-0000-7000-8000-000000000001",
  "categoryIds": [
    ""
  ],
  "tags": [
    ""
  ],
  "isFeatured": false,
  "isPublished": false,
  "sortOrder": 0
}
```

**الردود**

- **200**

```json
{
  "data": {
    "id": "01928c1e-0000-7000-8000-00000000w001",
    "title": "Mountain Sunrise",
    "description": "Golden light over the Alps",
    "slug": "mountain-sunrise",
    "tags": [
      "mountain",
      "sunrise"
    ],
    "orientation": "PORTRAIT",
    "width": 1440,
    "height": 3200,
    "isFeatured": true,
    "isPublished": true,
    "sortOrder": 0,
    "publishedAt": "2026-01-02T10:00:00.000Z",
    "image": {
      "mediaId": "01928c1e-0000-7000-8000-00000000aaaa",
      "thumbnailUrl": "https://cdn.example.com/media/2026/01/x/thumbnail.webp",
      "previewUrl": "https://cdn.example.com/media/2026/01/x/preview.webp",
      "originalUrl": "https://cdn.example.com/media/2026/01/x/original.jpg"
    },
    "categories": [
      {
        "id": "01928c1e-0000-7000-8000-00000000c001",
        "name": "Nature",
        "slug": "nature"
      }
    ],
    "stats": {
      "views": 1200,
      "downloadClicks": 340,
      "downloads": 310
    },
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-02T10:00:00.000Z"
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Wallpaper, media or category not found
- **409** — Slug is already in use

### DELETE `/api/v1/admin/wallpapers/{id}`

**Delete a wallpaper**

The image is kept for reuse unless `deleteMedia=true` and it is no longer referenced.

- الصلاحية: Bearer token

**البارامترات**

- `id` — path — مطلوب — string
- `deleteMedia` — query — اختياري — boolean — افتراضي: false — Also delete the image if no longer used anywhere

**الردود**

- **204**
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Wallpaper not found

### PATCH `/api/v1/admin/wallpapers/{id}/publish`

**Publish or unpublish a wallpaper**

publishedAt is set the first time a wallpaper is published.

- الصلاحية: Bearer token

**البارامترات**

- `id` — path — مطلوب — string

**الطلب**

**application/json** — publish

```json
{
  "isPublished": true
}
```

**الردود**

- **200**

```json
{
  "data": {
    "id": "01928c1e-0000-7000-8000-00000000w001",
    "title": "Mountain Sunrise",
    "description": "Golden light over the Alps",
    "slug": "mountain-sunrise",
    "tags": [
      "mountain",
      "sunrise"
    ],
    "orientation": "PORTRAIT",
    "width": 1440,
    "height": 3200,
    "isFeatured": true,
    "isPublished": true,
    "sortOrder": 0,
    "publishedAt": "2026-01-02T10:00:00.000Z",
    "image": {
      "mediaId": "01928c1e-0000-7000-8000-00000000aaaa",
      "thumbnailUrl": "https://cdn.example.com/media/2026/01/x/thumbnail.webp",
      "previewUrl": "https://cdn.example.com/media/2026/01/x/preview.webp",
      "originalUrl": "https://cdn.example.com/media/2026/01/x/original.jpg"
    },
    "categories": [
      {
        "id": "01928c1e-0000-7000-8000-00000000c001",
        "name": "Nature",
        "slug": "nature"
      }
    ],
    "stats": {
      "views": 1200,
      "downloadClicks": 340,
      "downloads": 310
    },
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-02T10:00:00.000Z"
  }
}
```

- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Wallpaper not found

## Admin / Banners

بانرات الصفحة الرئيسية: صورة، إجراء، تفعيل، وجدول زمني.

### GET `/api/v1/admin/banners`

**List banners (display order)**

- الصلاحية: Bearer token

**البارامترات**

- `page` — query — اختياري — number — افتراضي: 1 — أدنى: 1
- `limit` — query — اختياري — number — افتراضي: 20 — أدنى: 1 — أقصى: 100
- `isActive` — query — اختياري — boolean

**الردود**

- **200**

```json
{
  "data": [
    {
      "id": "01928c1e-0000-7000-8000-00000000b001",
      "title": "Summer collection",
      "subtitle": "50 new wallpapers",
      "actionType": "OPEN_CATEGORY",
      "actionValue": "01928c1e-0000-7000-8000-00000000c001",
      "sortOrder": 0,
      "isActive": true,
      "startsAt": null,
      "endsAt": null,
      "image": {
        "mediaId": "01928c1e-0000-7000-8000-00000000aaaa",
        "thumbnailUrl": "https://cdn.example.com/media/2026/01/b/thumbnail.webp",
        "previewUrl": "https://cdn.example.com/media/2026/01/b/preview.webp",
        "originalUrl": "https://cdn.example.com/media/2026/01/b/original.jpg"
      },
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

### POST `/api/v1/admin/banners`

**Create a banner**

Upload the image via POST /admin/media first. OPEN_URL values must be public https URLs (and match BANNER_URL_ALLOWED_HOSTS if configured).

- الصلاحية: Bearer token

**الطلب**

**application/json** — category

```json
{
  "title": "Nature",
  "imageMediaId": "01928c1e-...",
  "actionType": "OPEN_CATEGORY",
  "actionValue": "01928c1e-...",
  "isActive": true
}
```

**application/json** — url

```json
{
  "title": "Our website",
  "imageMediaId": "01928c1e-...",
  "actionType": "OPEN_URL",
  "actionValue": "https://example.com/promo",
  "isActive": true
}
```

**الردود**

- **201**

```json
{
  "data": {
    "id": "01928c1e-0000-7000-8000-00000000b001",
    "title": "Summer collection",
    "subtitle": "50 new wallpapers",
    "actionType": "OPEN_CATEGORY",
    "actionValue": "01928c1e-0000-7000-8000-00000000c001",
    "sortOrder": 0,
    "isActive": true,
    "startsAt": null,
    "endsAt": null,
    "image": {
      "mediaId": "01928c1e-0000-7000-8000-00000000aaaa",
      "thumbnailUrl": "https://cdn.example.com/media/2026/01/b/thumbnail.webp",
      "previewUrl": "https://cdn.example.com/media/2026/01/b/preview.webp",
      "originalUrl": "https://cdn.example.com/media/2026/01/b/original.jpg"
    },
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Image media or action target not found

### PATCH `/api/v1/admin/banners/reorder`

**Reorder banners**

- الصلاحية: Bearer token

**الطلب**

**application/json**

```json
{
  "items": [
    {
      "id": "01928c1e-0000-7000-8000-000000000001",
      "sortOrder": 0
    },
    {
      "id": "01928c1e-0000-7000-8000-000000000002",
      "sortOrder": 1
    }
  ]
}
```

**الردود**

- **200**

```json
{
  "data": {
    "updated": 2
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

### GET `/api/v1/admin/banners/{id}`

**Get a banner**

- الصلاحية: Bearer token

**البارامترات**

- `id` — path — مطلوب — string

**الردود**

- **200**

```json
{
  "data": {
    "id": "01928c1e-0000-7000-8000-00000000b001",
    "title": "Summer collection",
    "subtitle": "50 new wallpapers",
    "actionType": "OPEN_CATEGORY",
    "actionValue": "01928c1e-0000-7000-8000-00000000c001",
    "sortOrder": 0,
    "isActive": true,
    "startsAt": null,
    "endsAt": null,
    "image": {
      "mediaId": "01928c1e-0000-7000-8000-00000000aaaa",
      "thumbnailUrl": "https://cdn.example.com/media/2026/01/b/thumbnail.webp",
      "previewUrl": "https://cdn.example.com/media/2026/01/b/preview.webp",
      "originalUrl": "https://cdn.example.com/media/2026/01/b/original.jpg"
    },
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Banner not found

### PATCH `/api/v1/admin/banners/{id}`

**Update a banner (content, action, activation, schedule, order)**

- الصلاحية: Bearer token

**البارامترات**

- `id` — path — مطلوب — string

**الطلب**

**application/json**

```json
{
  "title": "",
  "subtitle": {},
  "imageMediaId": "01928c1e-0000-7000-8000-000000000001",
  "actionType": "NONE",
  "actionValue": {},
  "isActive": false,
  "sortOrder": 0,
  "startsAt": {},
  "endsAt": {}
}
```

**الردود**

- **200**

```json
{
  "data": {
    "id": "01928c1e-0000-7000-8000-00000000b001",
    "title": "Summer collection",
    "subtitle": "50 new wallpapers",
    "actionType": "OPEN_CATEGORY",
    "actionValue": "01928c1e-0000-7000-8000-00000000c001",
    "sortOrder": 0,
    "isActive": true,
    "startsAt": null,
    "endsAt": null,
    "image": {
      "mediaId": "01928c1e-0000-7000-8000-00000000aaaa",
      "thumbnailUrl": "https://cdn.example.com/media/2026/01/b/thumbnail.webp",
      "previewUrl": "https://cdn.example.com/media/2026/01/b/preview.webp",
      "originalUrl": "https://cdn.example.com/media/2026/01/b/original.jpg"
    },
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Banner not found

### DELETE `/api/v1/admin/banners/{id}`

**Delete a banner (the image media is kept)**

- الصلاحية: Bearer token

**البارامترات**

- `id` — path — مطلوب — string

**الردود**

- **204**
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Banner not found

## Admin / Home Sections

أقسام الصفحة الرئيسية وترتيبها. configuration تختلف حسب نوع القسم.

### GET `/api/v1/admin/home-sections`

**List all home sections in display order (including disabled)**

- الصلاحية: Bearer token

**الردود**

- **200**

```json
{
  "data": [
    {
      "id": "01928c1e-0000-7000-8000-00000000h001",
      "title": "Nature picks",
      "sectionType": "CATEGORY_WALLPAPERS",
      "sortOrder": 2,
      "isEnabled": true,
      "configuration": {
        "categoryId": "01928c1e-0000-7000-8000-00000000c001",
        "limit": 10,
        "sort": "latest"
      },
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

### POST `/api/v1/admin/home-sections`

**Add a home section**

Configuration per type: BANNERS {limit?}; FEATURED/POPULAR/LATEST_WALLPAPERS {limit?, orientation?}; CATEGORY_WALLPAPERS {categoryId, limit?, sort?: latest|popular|manual, orientation?}; CUSTOM_WALLPAPERS {wallpaperIds[]}; CATEGORIES {categoryIds?: uuid[]|null, limit?}. limit 1-50 (defaults to settings.home.defaultSectionLimit).

- الصلاحية: Bearer token

**الطلب**

**application/json** — BANNERS

```json
{
  "title": "BANNERS",
  "sectionType": "BANNERS",
  "configuration": {
    "limit": 5
  }
}
```

**application/json** — FEATURED_WALLPAPERS

```json
{
  "title": "FEATURED_WALLPAPERS",
  "sectionType": "FEATURED_WALLPAPERS",
  "configuration": {
    "limit": 10,
    "orientation": "PORTRAIT"
  }
}
```

**application/json** — POPULAR_WALLPAPERS

```json
{
  "title": "POPULAR_WALLPAPERS",
  "sectionType": "POPULAR_WALLPAPERS",
  "configuration": {
    "limit": 10
  }
}
```

**application/json** — LATEST_WALLPAPERS

```json
{
  "title": "LATEST_WALLPAPERS",
  "sectionType": "LATEST_WALLPAPERS",
  "configuration": {
    "limit": 10
  }
}
```

**application/json** — CATEGORY_WALLPAPERS

```json
{
  "title": "CATEGORY_WALLPAPERS",
  "sectionType": "CATEGORY_WALLPAPERS",
  "configuration": {
    "categoryId": "01928c1e-0000-7000-8000-00000000c001",
    "limit": 10,
    "sort": "latest"
  }
}
```

**application/json** — CUSTOM_WALLPAPERS

```json
{
  "title": "CUSTOM_WALLPAPERS",
  "sectionType": "CUSTOM_WALLPAPERS",
  "configuration": {
    "wallpaperIds": [
      "01928c1e-0000-7000-8000-00000000a001"
    ]
  }
}
```

**application/json** — CATEGORIES

```json
{
  "title": "CATEGORIES",
  "sectionType": "CATEGORIES",
  "configuration": {
    "categoryIds": null,
    "limit": 12
  }
}
```

**الردود**

- **201**

```json
{
  "data": {
    "id": "01928c1e-0000-7000-8000-00000000h001",
    "title": "Nature picks",
    "sectionType": "CATEGORY_WALLPAPERS",
    "sortOrder": 2,
    "isEnabled": true,
    "configuration": {
      "categoryId": "01928c1e-0000-7000-8000-00000000c001",
      "limit": 10,
      "sort": "latest"
    },
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Referenced category or wallpaper not found

### PATCH `/api/v1/admin/home-sections/reorder`

**Reorder home sections**

- الصلاحية: Bearer token

**الطلب**

**application/json**

```json
{
  "items": [
    {
      "id": "01928c1e-0000-7000-8000-000000000001",
      "sortOrder": 0
    },
    {
      "id": "01928c1e-0000-7000-8000-000000000002",
      "sortOrder": 1
    }
  ]
}
```

**الردود**

- **200**

```json
{
  "data": {
    "updated": 3
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

### GET `/api/v1/admin/home-sections/{id}`

**Get a home section**

- الصلاحية: Bearer token

**البارامترات**

- `id` — path — مطلوب — string

**الردود**

- **200**

```json
{
  "data": {
    "id": "01928c1e-0000-7000-8000-00000000h001",
    "title": "Nature picks",
    "sectionType": "CATEGORY_WALLPAPERS",
    "sortOrder": 2,
    "isEnabled": true,
    "configuration": {
      "categoryId": "01928c1e-0000-7000-8000-00000000c001",
      "limit": 10,
      "sort": "latest"
    },
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Home section not found

### PATCH `/api/v1/admin/home-sections/{id}`

**Update title, type, visibility, order or configuration**

- الصلاحية: Bearer token

**البارامترات**

- `id` — path — مطلوب — string

**الطلب**

**application/json**

```json
{
  "title": "",
  "sectionType": "BANNERS",
  "isEnabled": false,
  "sortOrder": 0,
  "configuration": {}
}
```

**الردود**

- **200**

```json
{
  "data": {
    "id": "01928c1e-0000-7000-8000-00000000h001",
    "title": "Nature picks",
    "sectionType": "CATEGORY_WALLPAPERS",
    "sortOrder": 2,
    "isEnabled": true,
    "configuration": {
      "categoryId": "01928c1e-0000-7000-8000-00000000c001",
      "limit": 10,
      "sort": "latest"
    },
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Home section not found

### DELETE `/api/v1/admin/home-sections/{id}`

**Delete a home section**

- الصلاحية: Bearer token

**البارامترات**

- `id` — path — مطلوب — string

**الردود**

- **204**
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **404** — Home section not found

## Admin / Settings

إعدادات التطبيق عن بُعد. القراءة للأدمن، والتعديل لـ SUPER_ADMIN مع expectedVersion.

### GET `/api/v1/admin/settings`

**Get the full remote app configuration**

Includes the document version for optimistic concurrency.

- الصلاحية: Bearer token

**الردود**

- **200**

```json
{
  "data": {
    "version": 3,
    "updatedAt": "2026-01-01T00:00:00.000Z",
    "updatedBy": {
      "id": "01928c1e-...",
      "name": "Super Admin"
    },
    "settings": {
      "maintenance": {
        "enabled": false,
        "title": "Under maintenance",
        "message": "We are performing scheduled maintenance. Please check back soon.",
        "estimatedEndAt": null
      },
      "appUpdate": {
        "android": {
          "minSupportedVersion": "1.0.0",
          "latestVersion": "1.0.0",
          "updateRequiredMessage": "This version is no longer supported. Please update the app to continue.",
          "updateAvailableMessage": "A new version of the app is available.",
          "storeUrl": null
        },
        "ios": {
          "minSupportedVersion": "1.0.0",
          "latestVersion": "1.0.0",
          "updateRequiredMessage": "This version is no longer supported. Please update the app to continue.",
          "updateAvailableMessage": "A new version of the app is available.",
          "storeUrl": null
        }
      },
      "announcements": [],
      "home": {
        "bannersEnabled": true,
        "defaultSectionLimit": 10
      },
      "downloads": {
        "enabled": true,
        "allowOriginalDownload": true,
        "disabledMessage": "Downloads are temporarily unavailable."
      },
      "externalLinks": {
        "privacyPolicyUrl": null,
        "termsOfServiceUrl": null,
        "supportEmail": null,
        "websiteUrl": null,
        "links": []
      },
      "featureFlags": {}
    }
  }
}
```

- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

### PATCH `/api/v1/admin/settings`

**Update remote app configuration (SUPER_ADMIN)**

Partial update: groups are deep-merged into the stored document (arrays are replaced) and the merged result is fully validated before saving. Send `expectedVersion` to reject concurrent edits with 409.

- الصلاحية: Bearer token
- الدور: SUPER_ADMIN

**الطلب**

**application/json** — maintenance

```json
{
  "expectedVersion": 3,
  "maintenance": {
    "enabled": true,
    "message": "Back at 18:00 UTC"
  }
}
```

**application/json** — forceUpdate

```json
{
  "appUpdate": {
    "android": {
      "minSupportedVersion": "2.0.0",
      "latestVersion": "2.1.0"
    }
  }
}
```

**application/json** — disableDownloads

```json
{
  "downloads": {
    "enabled": false
  }
}
```

**application/json** — announcement

```json
{
  "announcements": [
    {
      "id": "summer",
      "title": "Summer pack",
      "message": "50 new wallpapers",
      "level": "PROMO",
      "actionUrl": null,
      "dismissible": true,
      "isActive": true,
      "startsAt": null,
      "endsAt": null
    }
  ]
}
```

**الردود**

- **200**

```json
{
  "data": {
    "version": 3,
    "updatedAt": "2026-01-01T00:00:00.000Z",
    "updatedBy": {
      "id": "01928c1e-...",
      "name": "Super Admin"
    },
    "settings": {
      "maintenance": {
        "enabled": false,
        "title": "Under maintenance",
        "message": "We are performing scheduled maintenance. Please check back soon.",
        "estimatedEndAt": null
      },
      "appUpdate": {
        "android": {
          "minSupportedVersion": "1.0.0",
          "latestVersion": "1.0.0",
          "updateRequiredMessage": "This version is no longer supported. Please update the app to continue.",
          "updateAvailableMessage": "A new version of the app is available.",
          "storeUrl": null
        },
        "ios": {
          "minSupportedVersion": "1.0.0",
          "latestVersion": "1.0.0",
          "updateRequiredMessage": "This version is no longer supported. Please update the app to continue.",
          "updateAvailableMessage": "A new version of the app is available.",
          "storeUrl": null
        }
      },
      "announcements": [],
      "home": {
        "bannersEnabled": true,
        "defaultSectionLimit": 10
      },
      "downloads": {
        "enabled": true,
        "allowOriginalDownload": true,
        "disabledMessage": "Downloads are temporarily unavailable."
      },
      "externalLinks": {
        "privacyPolicyUrl": null,
        "termsOfServiceUrl": null,
        "supportEmail": null,
        "websiteUrl": null,
        "links": []
      },
      "featureFlags": {}
    }
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
- **409** — Settings were modified by someone else

## Admin / Analytics

تقارير المشاهدات والتنزيلات. التواريخ UTC بصيغة YYYY-MM-DD.

### GET `/api/v1/admin/analytics/overview`

**Totals, previous-period comparison, all-time counters and a daily series (UTC dates, default last 30 days)**

- الصلاحية: Bearer token

**البارامترات**

- `from` — query — اختياري — string — Inclusive UTC date. Defaults to 29 days before `to`.
- `to` — query — اختياري — string — Inclusive UTC date. Defaults to today.

**الردود**

- **200**

```json
{
  "data": {
    "range": {
      "from": "2026-01-01",
      "to": "2026-01-30"
    },
    "totals": {
      "views": 1200,
      "downloadClicks": 300,
      "downloads": 260
    },
    "previousPeriod": {
      "from": "2025-12-02",
      "to": "2025-12-31",
      "views": 900,
      "downloadClicks": 200,
      "downloads": 180
    },
    "allTime": {
      "views": 50000,
      "downloadClicks": 9000,
      "downloads": 8000
    },
    "series": [
      {
        "date": "2026-01-01",
        "views": 40,
        "downloadClicks": 10,
        "downloads": 9
      }
    ]
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

### GET `/api/v1/admin/analytics/downloads`

**Download clicks vs confirmed downloads per day, conversion rate and platform split**

- الصلاحية: Bearer token

**البارامترات**

- `from` — query — اختياري — string — Inclusive UTC date. Defaults to 29 days before `to`.
- `to` — query — اختياري — string — Inclusive UTC date. Defaults to today.

**الردود**

- **200**

```json
{
  "data": {
    "range": {
      "from": "2026-01-01",
      "to": "2026-01-30"
    },
    "totals": {
      "downloadClicks": 300,
      "downloads": 260,
      "conversionRate": 0.8667
    },
    "series": [
      {
        "date": "2026-01-01",
        "downloadClicks": 10,
        "downloads": 9,
        "conversionRate": 0.9
      }
    ],
    "byPlatform": [
      {
        "platform": "ANDROID",
        "downloadClicks": 200,
        "downloads": 180
      }
    ]
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

### GET `/api/v1/admin/analytics/popular-wallpapers`

**Top wallpapers in a date range by views, download clicks or downloads**

- الصلاحية: Bearer token

**البارامترات**

- `from` — query — اختياري — string — Inclusive UTC date. Defaults to 29 days before `to`.
- `to` — query — اختياري — string — Inclusive UTC date. Defaults to today.
- `metric` — query — اختياري — string — أحد: views | downloadClicks | downloads — افتراضي: "downloads"
- `limit` — query — اختياري — number — افتراضي: 10 — أقصى: 100

**الردود**

- **200**

```json
{
  "data": {
    "range": {
      "from": "2026-01-01",
      "to": "2026-01-30"
    },
    "metric": "downloads",
    "items": [
      {
        "wallpaper": {
          "id": "01928c1e-...",
          "title": "Mountain",
          "slug": "mountain",
          "isPublished": true,
          "thumbnailUrl": "https://cdn.example.com/..."
        },
        "views": 500,
        "downloadClicks": 120,
        "downloads": 100
      }
    ]
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

### GET `/api/v1/admin/analytics/popular-categories`

**Top categories in a date range (sums of their wallpapers)**

- الصلاحية: Bearer token

**البارامترات**

- `from` — query — اختياري — string — Inclusive UTC date. Defaults to 29 days before `to`.
- `to` — query — اختياري — string — Inclusive UTC date. Defaults to today.
- `metric` — query — اختياري — string — أحد: views | downloadClicks | downloads — افتراضي: "downloads"
- `limit` — query — اختياري — number — افتراضي: 10 — أقصى: 100

**الردود**

- **200**

```json
{
  "data": {
    "range": {
      "from": "2026-01-01",
      "to": "2026-01-30"
    },
    "metric": "downloads",
    "items": [
      {
        "category": {
          "id": "01928c1e-...",
          "name": "Nature",
          "slug": "nature"
        },
        "views": 900,
        "downloadClicks": 200,
        "downloads": 170
      }
    ]
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

## Admin / Dashboard

ملخص لوحة التحكم. recent-activity لـ SUPER_ADMIN فقط.

### GET `/api/v1/admin/dashboard/overview`

**Content counts, analytics totals (today / 7 / 30 days, UTC) and top wallpapers of the last 7 days**

- الصلاحية: Bearer token

**الردود**

- **200**

```json
{
  "data": {
    "content": {
      "wallpapers": {
        "total": 120,
        "published": 100,
        "unpublished": 20,
        "featured": 12
      },
      "categories": {
        "total": 10,
        "published": 8
      },
      "banners": {
        "total": 4,
        "activeNow": 2
      },
      "mediaOriginals": 130
    },
    "analytics": {
      "today": {
        "views": 50,
        "downloadClicks": 12,
        "downloads": 10
      },
      "last7Days": {
        "views": 400,
        "downloadClicks": 90,
        "downloads": 80
      },
      "last30Days": {
        "views": 1500,
        "downloadClicks": 320,
        "downloads": 290
      }
    },
    "topWallpapersLast7Days": []
  }
}
```

- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

### GET `/api/v1/admin/dashboard/recent-wallpapers`

**Most recently created wallpapers**

- الصلاحية: Bearer token

**البارامترات**

- `limit` — query — اختياري — number — افتراضي: 10 — أدنى: 1 — أقصى: 100

**الردود**

- **200**

```json
{
  "data": [
    {
      "id": "01928c1e-...",
      "title": "Mountain",
      "slug": "mountain",
      "isPublished": true,
      "isFeatured": false,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "publishedAt": "2026-01-01T00:00:00.000Z",
      "thumbnailUrl": "https://cdn.example.com/..."
    }
  ]
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

### GET `/api/v1/admin/dashboard/recent-activity`

**Latest audit log entries (SUPER_ADMIN)**

- الصلاحية: Bearer token
- الدور: SUPER_ADMIN

**البارامترات**

- `limit` — query — اختياري — number — افتراضي: 10 — أدنى: 1 — أقصى: 100

**الردود**

- **200**

```json
{
  "data": [
    {
      "id": "01928c1e-...",
      "action": "WALLPAPER_PUBLISHED",
      "entityType": "WALLPAPER",
      "entityId": "01928c1e-...",
      "metadata": {
        "title": "Mountain"
      },
      "createdAt": "2026-01-01T00:00:00.000Z",
      "admin": {
        "id": "01928c1e-...",
        "name": "Editor"
      }
    }
  ]
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

### GET `/api/v1/admin/dashboard/storage`

**Storage usage by variant (bytes as recorded at upload) and unused original count**

- الصلاحية: Bearer token

**الردود**

- **200**

```json
{
  "data": {
    "provider": "s3",
    "totalBytes": 734003200,
    "variants": {
      "ORIGINAL": {
        "count": 130,
        "bytes": 600000000
      },
      "PREVIEW": {
        "count": 130,
        "bytes": 100000000
      },
      "THUMBNAIL": {
        "count": 130,
        "bytes": 34003200
      }
    },
    "unusedOriginals": 3
  }
}
```

- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled

## Admin / Audit Logs

سجل العمليات الإدارية. SUPER_ADMIN فقط.

### GET `/api/v1/admin/audit-logs`

**List audit log entries (SUPER_ADMIN)**

Newest first, filterable and paginated.

- الصلاحية: Bearer token
- الدور: SUPER_ADMIN

**البارامترات**

- `page` — query — اختياري — number — افتراضي: 1 — أدنى: 1
- `limit` — query — اختياري — number — افتراضي: 20 — أدنى: 1 — أقصى: 100
- `adminId` — query — اختياري — string
- `action` — query — اختياري — string — أحد: AUTH_LOGIN | AUTH_LOGIN_FAILED | AUTH_ACCOUNT_LOCKED | AUTH_LOGOUT | AUTH_REFRESH_TOKEN_REUSE | AUTH_PASSWORD_CHANGED | ADMIN_CREATED | ADMIN_UPDATED | ADMIN_PASSWORD_RESET | ADMIN_DELETED | MEDIA_UPLOADED | MEDIA_DELETED | MEDIA_CLEANUP | CATEGORY_CREATED | CATEGORY_UPDATED | CATEGORY_PUBLISHED | CATEGORY_UNPUBLISHED | CATEGORY_REORDERED | CATEGORY_DELETED | WALLPAPER_CREATED | WALLPAPER_UPDATED | WALLPAPER_PUBLISHED | WALLPAPER_UNPUBLISHED | WALLPAPER_DELETED | WALLPAPER_BULK_CREATED | WALLPAPER_BULK_UPDATED | BANNER_CREATED | BANNER_UPDATED | BANNER_DELETED | BANNER_REORDERED | HOME_SECTION_CREATED | HOME_SECTION_UPDATED | HOME_SECTION_DELETED | HOME_SECTION_REORDERED | SETTINGS_UPDATED
- `entityType` — query — اختياري — string — أحد: AUTH | ADMIN | MEDIA | CATEGORY | WALLPAPER | BANNER | HOME_SECTION | SETTINGS
- `entityId` — query — اختياري — string
- `from` — query — اختياري — string
- `to` — query — اختياري — string

**الردود**

- **200**

```json
{
  "data": [
    {
      "id": "01928c1e-0000-7000-8000-000000000001",
      "adminId": "01928c1e-0000-7000-8000-000000000002",
      "action": "WALLPAPER_PUBLISHED",
      "entityType": "WALLPAPER",
      "entityId": "01928c1e-0000-7000-8000-000000000003",
      "metadata": {
        "title": "Mountain"
      },
      "ipAddress": "203.0.113.10",
      "userAgent": "Mozilla/5.0",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "admin": {
        "id": "01928c1e-0000-7000-8000-000000000002",
        "name": "Jane",
        "email": "jane@example.com"
      }
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

- **400** — Validation failed
- **401** — Missing, invalid or expired access token
- **403** — Authenticated admin lacks the required role or is disabled
