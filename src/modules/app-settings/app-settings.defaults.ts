import type { AppSettingsDto } from './dto/app-settings.dto';

export const APP_CONFIG_KEY = 'app_config';

export type AppSettings = AppSettingsDto;

export function buildDefaultAppSettings(): AppSettings {
  const versionPolicy = {
    minSupportedVersion: '1.0.0',
    latestVersion: '1.0.0',
    updateRequiredMessage: 'This version is no longer supported. Please update the app to continue.',
    updateAvailableMessage: 'A new version of the app is available.',
    storeUrl: null,
  };
  return {
    maintenance: {
      enabled: false,
      title: 'Under maintenance',
      message: 'We are performing scheduled maintenance. Please check back soon.',
      estimatedEndAt: null,
    },
    appUpdate: { android: { ...versionPolicy }, ios: { ...versionPolicy } },
    announcements: [],
    home: { bannersEnabled: true, defaultSectionLimit: 10 },
    downloads: {
      enabled: true,
      allowOriginalDownload: true,
      disabledMessage: 'Downloads are temporarily unavailable.',
    },
    externalLinks: {
      privacyPolicyUrl: null,
      termsOfServiceUrl: null,
      supportEmail: null,
      websiteUrl: null,
      links: [],
    },
    featureFlags: {},
  };
}
