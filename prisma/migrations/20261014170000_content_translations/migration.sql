-- Content translations for categories, wallpapers, banners, and home sections.
-- Existing name/title/description columns are preserved and remain the legacy fallback.
-- This migration does not copy those values into a locale row: the original language
-- is not known, so Arabic and Turkish (and English) translations are left empty
-- until an administrator saves them.

CREATE TYPE "ContentLocale" AS ENUM ('ar', 'tr', 'en');

CREATE TABLE "category_translations" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "locale" "ContentLocale" NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(1000),

    CONSTRAINT "category_translations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wallpaper_translations" (
    "id" UUID NOT NULL,
    "wallpaper_id" UUID NOT NULL,
    "locale" "ContentLocale" NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "description" VARCHAR(2000),

    CONSTRAINT "wallpaper_translations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "banner_translations" (
    "id" UUID NOT NULL,
    "banner_id" UUID NOT NULL,
    "locale" "ContentLocale" NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "subtitle" VARCHAR(300),

    CONSTRAINT "banner_translations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "home_section_translations" (
    "id" UUID NOT NULL,
    "home_section_id" UUID NOT NULL,
    "locale" "ContentLocale" NOT NULL,
    "title" VARCHAR(120) NOT NULL,

    CONSTRAINT "home_section_translations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "category_translations_category_id_locale_key" ON "category_translations"("category_id", "locale");
CREATE INDEX "category_translations_locale_idx" ON "category_translations"("locale");

CREATE UNIQUE INDEX "wallpaper_translations_wallpaper_id_locale_key" ON "wallpaper_translations"("wallpaper_id", "locale");
CREATE INDEX "wallpaper_translations_locale_idx" ON "wallpaper_translations"("locale");

CREATE UNIQUE INDEX "banner_translations_banner_id_locale_key" ON "banner_translations"("banner_id", "locale");
CREATE INDEX "banner_translations_locale_idx" ON "banner_translations"("locale");

CREATE UNIQUE INDEX "home_section_translations_home_section_id_locale_key" ON "home_section_translations"("home_section_id", "locale");
CREATE INDEX "home_section_translations_locale_idx" ON "home_section_translations"("locale");

ALTER TABLE "category_translations" ADD CONSTRAINT "category_translations_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallpaper_translations" ADD CONSTRAINT "wallpaper_translations_wallpaper_id_fkey" FOREIGN KEY ("wallpaper_id") REFERENCES "wallpapers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "banner_translations" ADD CONSTRAINT "banner_translations_banner_id_fkey" FOREIGN KEY ("banner_id") REFERENCES "banners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "home_section_translations" ADD CONSTRAINT "home_section_translations_home_section_id_fkey" FOREIGN KEY ("home_section_id") REFERENCES "home_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
