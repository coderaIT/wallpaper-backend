# Wallpaper API — تطبيق فلاتر

هذا الملف لتطبيق الموبايل فقط. لا يوجد تسجيل دخول للمستخدم، ولا تستخدم أي مسار يبدأ بـ `/admin`.

- العنوان المحلي: `http://localhost:3000`
- كل المسارات تحت: `/api/v1/public`
- الرد الناجح: `{ "data": ... }`
- القوائم تضيف: `"meta": { "page", "limit", "total", "totalPages" }`
- الخطأ: `{ "statusCode", "error", "message", "details?", "path", "timestamp", "requestId" }`

| الحالة    | المعنى                            |
| --------- | --------------------------------- |
| 200 / 202 | نجح                               |
| 400       | بارامتر أو جسم طلب غير صالح       |
| 404       | غير موجود، أو غير منشور           |
| 429       | كثرة طلبات. أعد المحاولة بعد ثوان |

لا ترسل معرّف جهاز أو معرّف مستخدم. أي حقل زائد في جسم الطلب يُرفض.

## ترتيب التشغيل داخل التطبيق

1. عند الفتح: `GET /public/app-config?platform=ANDROID&appVersion=1.0.0`
   - `platform` هو `ANDROID` أو `IOS` أو `OTHER`.
   - `appVersion` بصيغة `1.4.2` (ثلاثة أرقام).
   - إذا `maintenance.enabled` اعرض شاشة الصيانة من `title` و `message`.
   - `update.status`:
     - `REQUIRED`: امنع الاستخدام وافتح `update.android.storeUrl` أو `update.ios.storeUrl`.
     - `AVAILABLE`: اقترح التحديث.
     - `NONE`: الإصدار محدّث.
   - `status` يظهر فقط إذا أرسلت `platform` و `appVersion` معاً.
   - اعرض `announcements` الفعّالة فقط (السيرفر يصفّيها مسبقاً).
2. الشاشة الرئيسية: `GET /public/home`
3. عند فتح تفاصيل خلفية: `GET /public/wallpapers/{id}` ثم أرسل حدث `WALLPAPER_VIEW`.
4. عند الضغط على تنزيل: أرسل `WALLPAPER_DOWNLOAD_CLICK`. بعد نجاح الحفظ أرسل `WALLPAPER_DOWNLOAD`.
5. ملف الحفظ هو `downloadUrl` من التفاصيل، وليس `previewUrl`.

## الصور

- الشبكة: `thumbnailUrl` (WebP، الضلع الأطول حتى 480).
- شاشة التفاصيل: `previewUrl` (WebP، الضلع الأطول حتى 2048).
- الحفظ على الجهاز: `downloadUrl`
  - رابط الأصل إذا التنزيل الكامل مسموح.
  - رابط المعاينة إذا الأصل معطّل.
  - `null` إذا التنزيل مغلق. اعرض `downloads.disabledMessage` ولا تظهر زر التنزيل.
- الروابط ثابتة ويمكن تخزينها في الكاش.

## الصفحة الرئيسية

`GET /public/home` يرجع الأقسام المفعّلة بالترتيب. الأقسام الفارغة لا تُرجَع. إذا ظهر `type` لا يعرفه التطبيق، تجاهل القسم ولا توقف الشاشة.

| `type`                | محتوى `items`                                                |
| --------------------- | ------------------------------------------------------------ |
| `BANNERS`             | بانرات                                                       |
| `FEATURED_WALLPAPERS` | خلفيات مختارة                                                |
| `POPULAR_WALLPAPERS`  | الأكثر تنزيلاً                                               |
| `LATEST_WALLPAPERS`   | الأحدث                                                       |
| `CATEGORY_WALLPAPERS` | خلفيات تصنيف واحد. يوجد أيضاً `category: { id, name, slug }` |
| `CUSTOM_WALLPAPERS`   | خلفيات يختارها الأدمن                                        |
| `CATEGORIES`          | تصنيفات                                                      |

إجراءات البانر `action.type`:

- `NONE`
- `OPEN_WALLPAPER` مع `wallpaperId`
- `OPEN_CATEGORY` مع `categoryId` و `categorySlug`
- `OPEN_URL` مع `url` (دائماً https)

## النماذج

خلفية في القوائم:

```json
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
```

`orientation` هو `PORTRAIT` أو `LANDSCAPE` أو `SQUARE`.

تصنيف:

```json
{
  "id": "01928c1e-0000-7000-8000-00000000c001",
  "name": "Nature",
  "slug": "nature",
  "description": "Mountains, forests and oceans",
  "thumbnailUrl": "https://cdn.example.com/media/2026/01/c/thumbnail.webp",
  "previewUrl": "https://cdn.example.com/media/2026/01/c/preview.webp",
  "wallpaperCount": 40
}
```

`thumbnailUrl` و `previewUrl` قد تكون `null` إذا لم يُضبط غلاف للتصنيف.

## الإعدادات

`GET /public/app-config?platform=ANDROID&appVersion=1.4.2`

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
    "announcements": [
      {
        "id": "summer",
        "title": "Summer pack",
        "message": "50 new wallpapers",
        "level": "INFO",
        "actionUrl": null,
        "dismissible": true,
        "endsAt": null
      }
    ],
    "downloads": {
      "enabled": true,
      "allowOriginalDownload": true,
      "disabledMessage": "Downloads are temporarily unavailable"
    },
    "home": {
      "bannersEnabled": true,
      "layout": [{ "id": "01928c1e-...", "title": "Featured", "type": "FEATURED_WALLPAPERS" }]
    },
    "links": {
      "privacyPolicyUrl": null,
      "termsOfServiceUrl": null,
      "supportEmail": null,
      "websiteUrl": null,
      "other": [
        { "key": "instagram", "label": "Instagram", "url": "https://instagram.com/example" }
      ]
    },
    "features": { "newSearch": false },
    "serverTime": "2026-01-01T00:00:00.000Z"
  }
}
```

`announcements[].level` هو `INFO` أو `WARNING` أو `PROMO`. `features` خريطة مفاتيح إلى `true` أو `false`، وقد تكون فارغة.

## الصفحة الرئيسية — مثال

`GET /public/home`

```json
{
  "data": {
    "sections": [
      {
        "id": "01928c1e-...",
        "title": "Highlights",
        "type": "BANNERS",
        "items": [
          {
            "id": "01928c1e-...",
            "title": "Summer pack",
            "subtitle": null,
            "imageUrl": "https://cdn.example.com/media/2026/01/b/preview.webp",
            "thumbnailUrl": "https://cdn.example.com/media/2026/01/b/thumbnail.webp",
            "width": 2048,
            "height": 1024,
            "action": {
              "type": "OPEN_CATEGORY",
              "categoryId": "01928c1e-...",
              "categorySlug": "summer"
            }
          }
        ]
      },
      {
        "id": "01928c1e-...",
        "title": "Featured",
        "type": "FEATURED_WALLPAPERS",
        "items": []
      },
      {
        "id": "01928c1e-...",
        "title": "Nature",
        "type": "CATEGORY_WALLPAPERS",
        "category": { "id": "01928c1e-...", "name": "Nature", "slug": "nature" },
        "items": []
      },
      {
        "id": "01928c1e-...",
        "title": "Categories",
        "type": "CATEGORIES",
        "items": []
      }
    ]
  }
}
```

عناصر الخلفيات والتصنيفات داخل `items` لها نفس شكل النموذجين أعلاه.

## المسارات

ترقيم القوائم: `page` من 1، و `limit` من 1 إلى 100. الافتراضي `page=1` و `limit=20`.

### `GET /public/categories`

التصنيفات المنشورة بالترتيب اليدوي.

### `GET /public/categories/{slug}`

تصنيف واحد. الـ slug حروف صغيرة وأرقام وشرطات فقط، مثل `nature`. غير الموجود أو غير المنشور يرجع 404.

خلفيات هذا التصنيف: `GET /public/wallpapers?categorySlug=nature`

### `GET /public/wallpapers`

فلاتر اختيارية:

- `categoryId` أو `categorySlug`
- `orientation`: `PORTRAIT` أو `LANDSCAPE` أو `SQUARE`
- `q`: بحث اختياري
- `sort`: `latest` (الافتراضي) أو `popular` أو `downloads` أو `featured` أو `manual`

مثال: `/api/v1/public/wallpapers?page=1&limit=20&categorySlug=nature&sort=popular`

إذا كان التصنيف المطلوب غير منشور يرجع 404.

### `GET /public/wallpapers/search?q=sunset`

نفس فلاتر القائمة. `q` مطلوب وطوله من 2 إلى 100 حرف. يطابق جزءاً من العنوان أو الوسم كاملاً.

### `GET /public/wallpapers/featured`

### `GET /public/wallpapers/latest`

### `GET /public/wallpapers/popular`

الثلاثة قوائم جاهزة. الفلتر الوحيد الإضافي هو `orientation`.

### `GET /public/wallpapers/{id}`

تفاصيل خلفية منشورة. `id` هو UUID.

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
    "tags": ["mountain"],
    "categories": [
      { "id": "01928c1e-0000-7000-8000-00000000c001", "name": "Nature", "slug": "nature" }
    ],
    "downloadUrl": "https://cdn.example.com/media/2026/01/x/original.jpg",
    "publishedAt": "2026-01-02T10:00:00.000Z"
  }
}
```

`description` قد تكون `null`. `publishedAt` قد تكون `null`.

## الأحداث

`POST /public/events` يرجع **202** وليس 200. اجمع الأحداث وأرسلها دفعة واحدة (من 1 إلى 50)، لا طلباً لكل حدث.

```json
{
  "events": [
    {
      "wallpaperId": "01928c1e-0000-7000-8000-00000000a001",
      "type": "WALLPAPER_VIEW",
      "platform": "ANDROID",
      "appVersion": "1.4.2"
    },
    {
      "wallpaperId": "01928c1e-0000-7000-8000-00000000a001",
      "type": "WALLPAPER_DOWNLOAD_CLICK",
      "platform": "ANDROID",
      "appVersion": "1.4.2"
    },
    {
      "wallpaperId": "01928c1e-0000-7000-8000-00000000a001",
      "type": "WALLPAPER_DOWNLOAD",
      "platform": "ANDROID",
      "appVersion": "1.4.2"
    }
  ]
}
```

- `WALLPAPER_VIEW`: فُتحت شاشة التفاصيل.
- `WALLPAPER_DOWNLOAD_CLICK`: ضُغط زر التنزيل أو التطبيق.
- `WALLPAPER_DOWNLOAD`: اكتمل حفظ الملف أو تطبيقه كخلفية.
- `platform` و `appVersion` اختياريان. إذا أُرسلا فيجب أن يطابقا القيم المذكورة أعلاه.

```json
{ "data": { "accepted": 2, "duplicates": 0, "rejected": 0 } }
```

التكرار من نفس الجهاز خلال وقت قصير يُحسب مرة واحدة (`duplicates`). الخلفية غير المنشورة تُهمل (`rejected`). العدادات تتحدث بعد ثوان، لأن السيرفر يكتب الأحداث على دفعات. فشل الإرسال لا يمنع عرض الصورة.

## فحص السيرفر

`GET /api/v1/health` بدون توكن. `200` يعني السيرفر وقاعدة البيانات يعملان. `503` يعني قاعدة البيانات متوقفة. هذا المسار ليس جزءاً من شاشات التطبيق.
