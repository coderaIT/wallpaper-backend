export const AuditAction = {
  AuthLogin: 'AUTH_LOGIN',
  AuthLoginFailed: 'AUTH_LOGIN_FAILED',
  AuthAccountLocked: 'AUTH_ACCOUNT_LOCKED',
  AuthLogout: 'AUTH_LOGOUT',
  AuthRefreshTokenReuse: 'AUTH_REFRESH_TOKEN_REUSE',
  AuthPasswordChanged: 'AUTH_PASSWORD_CHANGED',

  AdminCreated: 'ADMIN_CREATED',
  AdminUpdated: 'ADMIN_UPDATED',
  AdminPasswordReset: 'ADMIN_PASSWORD_RESET',
  AdminDeleted: 'ADMIN_DELETED',

  MediaUploaded: 'MEDIA_UPLOADED',
  MediaDeleted: 'MEDIA_DELETED',
  MediaCleanup: 'MEDIA_CLEANUP',

  CategoryCreated: 'CATEGORY_CREATED',
  CategoryUpdated: 'CATEGORY_UPDATED',
  CategoryPublished: 'CATEGORY_PUBLISHED',
  CategoryUnpublished: 'CATEGORY_UNPUBLISHED',
  CategoryReordered: 'CATEGORY_REORDERED',
  CategoryDeleted: 'CATEGORY_DELETED',

  WallpaperCreated: 'WALLPAPER_CREATED',
  WallpaperUpdated: 'WALLPAPER_UPDATED',
  WallpaperPublished: 'WALLPAPER_PUBLISHED',
  WallpaperUnpublished: 'WALLPAPER_UNPUBLISHED',
  WallpaperDeleted: 'WALLPAPER_DELETED',
  WallpaperBulkCreated: 'WALLPAPER_BULK_CREATED',
  WallpaperBulkUpdated: 'WALLPAPER_BULK_UPDATED',

  BannerCreated: 'BANNER_CREATED',
  BannerUpdated: 'BANNER_UPDATED',
  BannerDeleted: 'BANNER_DELETED',
  BannerReordered: 'BANNER_REORDERED',

  HomeSectionCreated: 'HOME_SECTION_CREATED',
  HomeSectionUpdated: 'HOME_SECTION_UPDATED',
  HomeSectionDeleted: 'HOME_SECTION_DELETED',
  HomeSectionReordered: 'HOME_SECTION_REORDERED',

  SettingsUpdated: 'SETTINGS_UPDATED',
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];

export const AuditEntity = {
  Auth: 'AUTH',
  Admin: 'ADMIN',
  Media: 'MEDIA',
  Category: 'CATEGORY',
  Wallpaper: 'WALLPAPER',
  Banner: 'BANNER',
  HomeSection: 'HOME_SECTION',
  Settings: 'SETTINGS',
} as const;

export type AuditEntityValue = (typeof AuditEntity)[keyof typeof AuditEntity];
