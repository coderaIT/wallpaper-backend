-- Trigram extension backs the GIN index used by case-insensitive wallpaper title search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'EDITOR');

-- CreateEnum
CREATE TYPE "MediaVariantType" AS ENUM ('ORIGINAL', 'PREVIEW', 'THUMBNAIL');

-- CreateEnum
CREATE TYPE "WallpaperOrientation" AS ENUM ('PORTRAIT', 'LANDSCAPE', 'SQUARE');

-- CreateEnum
CREATE TYPE "BannerActionType" AS ENUM ('NONE', 'OPEN_WALLPAPER', 'OPEN_CATEGORY', 'OPEN_URL');

-- CreateEnum
CREATE TYPE "HomeSectionType" AS ENUM ('BANNERS', 'FEATURED_WALLPAPERS', 'POPULAR_WALLPAPERS', 'LATEST_WALLPAPERS', 'CATEGORY_WALLPAPERS', 'CUSTOM_WALLPAPERS', 'CATEGORIES');

-- CreateEnum
CREATE TYPE "WallpaperEventType" AS ENUM ('WALLPAPER_VIEW', 'WALLPAPER_DOWNLOAD_CLICK', 'WALLPAPER_DOWNLOAD');

-- CreateEnum
CREATE TYPE "ClientPlatform" AS ENUM ('ANDROID', 'IOS', 'OTHER');

-- CreateTable
CREATE TABLE "admins" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'EDITOR',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" VARCHAR(32),
    "replaced_by_id" UUID,
    "user_agent" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "admin_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" VARCHAR(64),
    "metadata" JSONB,
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "variant_type" "MediaVariantType" NOT NULL,
    "storage_key" VARCHAR(512) NOT NULL,
    "mime_type" VARCHAR(64) NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "checksum_sha256" VARCHAR(64) NOT NULL,
    "original_filename" VARCHAR(255),
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "cover_media_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallpapers" (
    "id" UUID NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "description" VARCHAR(2000),
    "slug" VARCHAR(180) NOT NULL,
    "original_media_id" UUID NOT NULL,
    "orientation" "WallpaperOrientation" NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "tags" VARCHAR(40)[] DEFAULT ARRAY[]::VARCHAR(40)[],
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "download_click_count" INTEGER NOT NULL DEFAULT 0,
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wallpapers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallpaper_categories" (
    "wallpaper_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallpaper_categories_pkey" PRIMARY KEY ("wallpaper_id","category_id")
);

-- CreateTable
CREATE TABLE "banners" (
    "id" UUID NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "subtitle" VARCHAR(300),
    "image_media_id" UUID NOT NULL,
    "action_type" "BannerActionType" NOT NULL DEFAULT 'NONE',
    "action_value" VARCHAR(2048),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_sections" (
    "id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "section_type" "HomeSectionType" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "home_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "wallpaper_events" (
    "id" BIGSERIAL NOT NULL,
    "wallpaper_id" UUID NOT NULL,
    "type" "WallpaperEventType" NOT NULL,
    "platform" "ClientPlatform",
    "app_version" VARCHAR(32),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallpaper_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallpaper_daily_stats" (
    "wallpaper_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "download_clicks" INTEGER NOT NULL DEFAULT 0,
    "downloads" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "wallpaper_daily_stats_pkey" PRIMARY KEY ("wallpaper_id","date")
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE INDEX "refresh_tokens_admin_id_idx" ON "refresh_tokens"("admin_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_admin_id_created_at_idx" ON "audit_logs"("admin_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_storage_key_key" ON "media_assets"("storage_key");

-- CreateIndex
CREATE INDEX "media_assets_variant_type_created_at_idx" ON "media_assets"("variant_type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "media_assets_checksum_sha256_idx" ON "media_assets"("checksum_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_parent_id_variant_type_key" ON "media_assets"("parent_id", "variant_type");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_is_published_sort_order_idx" ON "categories"("is_published", "sort_order");

-- CreateIndex
CREATE INDEX "categories_sort_order_idx" ON "categories"("sort_order");

-- CreateIndex
CREATE INDEX "categories_cover_media_id_idx" ON "categories"("cover_media_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallpapers_slug_key" ON "wallpapers"("slug");

-- CreateIndex
CREATE INDEX "wallpapers_is_published_published_at_idx" ON "wallpapers"("is_published", "published_at" DESC);

-- CreateIndex
CREATE INDEX "wallpapers_is_published_is_featured_sort_order_idx" ON "wallpapers"("is_published", "is_featured", "sort_order");

-- CreateIndex
CREATE INDEX "wallpapers_is_published_download_count_view_count_idx" ON "wallpapers"("is_published", "download_count" DESC, "view_count" DESC);

-- CreateIndex
CREATE INDEX "wallpapers_is_published_sort_order_idx" ON "wallpapers"("is_published", "sort_order");

-- CreateIndex
CREATE INDEX "wallpapers_orientation_idx" ON "wallpapers"("orientation");

-- CreateIndex
CREATE INDEX "wallpapers_created_at_idx" ON "wallpapers"("created_at" DESC);

-- CreateIndex
CREATE INDEX "wallpapers_original_media_id_idx" ON "wallpapers"("original_media_id");

-- CreateIndex
CREATE INDEX "wallpapers_title_trgm_idx" ON "wallpapers" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "wallpapers_tags_idx" ON "wallpapers" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "wallpaper_categories_category_id_wallpaper_id_idx" ON "wallpaper_categories"("category_id", "wallpaper_id");

-- CreateIndex
CREATE INDEX "banners_is_active_sort_order_idx" ON "banners"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "banners_image_media_id_idx" ON "banners"("image_media_id");

-- CreateIndex
CREATE INDEX "home_sections_is_enabled_sort_order_idx" ON "home_sections"("is_enabled", "sort_order");

-- CreateIndex
CREATE INDEX "wallpaper_events_wallpaper_id_type_created_at_idx" ON "wallpaper_events"("wallpaper_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "wallpaper_events_created_at_idx" ON "wallpaper_events"("created_at");

-- CreateIndex
CREATE INDEX "wallpaper_daily_stats_date_idx" ON "wallpaper_daily_stats"("date");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_cover_media_id_fkey" FOREIGN KEY ("cover_media_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallpapers" ADD CONSTRAINT "wallpapers_original_media_id_fkey" FOREIGN KEY ("original_media_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallpaper_categories" ADD CONSTRAINT "wallpaper_categories_wallpaper_id_fkey" FOREIGN KEY ("wallpaper_id") REFERENCES "wallpapers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallpaper_categories" ADD CONSTRAINT "wallpaper_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banners" ADD CONSTRAINT "banners_image_media_id_fkey" FOREIGN KEY ("image_media_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallpaper_events" ADD CONSTRAINT "wallpaper_events_wallpaper_id_fkey" FOREIGN KEY ("wallpaper_id") REFERENCES "wallpapers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallpaper_daily_stats" ADD CONSTRAINT "wallpaper_daily_stats_wallpaper_id_fkey" FOREIGN KEY ("wallpaper_id") REFERENCES "wallpapers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity constraints not expressible in the Prisma schema language
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_dimensions_positive" CHECK ("width" > 0 AND "height" > 0 AND "size" > 0);
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_variant_parent" CHECK (("variant_type" = 'ORIGINAL' AND "parent_id" IS NULL) OR ("variant_type" <> 'ORIGINAL' AND "parent_id" IS NOT NULL));
ALTER TABLE "wallpapers" ADD CONSTRAINT "wallpapers_dimensions_positive" CHECK ("width" > 0 AND "height" > 0);
ALTER TABLE "wallpapers" ADD CONSTRAINT "wallpapers_counters_non_negative" CHECK ("view_count" >= 0 AND "download_count" >= 0 AND "download_click_count" >= 0);
ALTER TABLE "banners" ADD CONSTRAINT "banners_schedule_valid" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at");
