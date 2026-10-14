import { Injectable } from '@nestjs/common';
import { ClientPlatform } from '../../generated/prisma/enums';
import { ContentLocale, resolveLocalizedText } from '../../common/i18n/content-locale';
import { compareVersions } from '../../common/utils/semver.util';
import { AppSettings } from '../app-settings/app-settings.defaults';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { PlatformVersionPolicyDto } from '../app-settings/dto/app-settings.dto';

export type UpdateStatus = 'NONE' | 'AVAILABLE' | 'REQUIRED';

export interface HomeLayoutEntry {
  id: string;
  title: string;
  type: string;
}

/**
 * Builds the public app configuration from an explicit allowlist of settings fields. New
 * settings are NOT exposed publicly unless they are added here.
 */
@Injectable()
export class PublicConfigService {
  constructor(private readonly settings: AppSettingsService) {}

  async build(platform?: ClientPlatform, appVersion?: string, homeLayout: HomeLayoutEntry[] = [], locale: ContentLocale = 'en') {
    const s = await this.settings.getSettings();
    const now = Date.now();
    return {
      maintenance: {
        enabled: s.maintenance.enabled,
        title: s.maintenance.title,
        message: s.maintenance.message,
        estimatedEndAt: s.maintenance.estimatedEndAt,
      },
      update: {
        android: this.versionPolicy(s.appUpdate.android),
        ios: this.versionPolicy(s.appUpdate.ios),
        ...(platform && appVersion ? { status: this.updateStatus(s, platform, appVersion) } : {}),
      },
      announcements: s.announcements
        .filter(
          (a) =>
            a.isActive &&
            (!a.startsAt || Date.parse(a.startsAt) <= now) &&
            (!a.endsAt || Date.parse(a.endsAt) > now),
        )
        .map((a) => {
          const text = resolveLocalizedText(
            (a.translations ?? []).map((row) => ({ locale: row.locale, primary: row.title, secondary: row.message })),
            locale,
            { primary: a.title, secondary: a.message },
          );
          return {
            id: a.id,
            title: text.primary,
            message: text.secondary ?? '',
            level: a.level,
            actionUrl: a.actionUrl,
            dismissible: a.dismissible,
            endsAt: a.endsAt,
          };
        }),
      downloads: {
        enabled: s.downloads.enabled,
        allowOriginalDownload: s.downloads.allowOriginalDownload,
        disabledMessage: s.downloads.disabledMessage,
      },
      home: { bannersEnabled: s.home.bannersEnabled, layout: homeLayout },
      links: {
        privacyPolicyUrl: s.externalLinks.privacyPolicyUrl,
        termsOfServiceUrl: s.externalLinks.termsOfServiceUrl,
        supportEmail: s.externalLinks.supportEmail,
        websiteUrl: s.externalLinks.websiteUrl,
        other: s.externalLinks.links.map((l) => ({ key: l.key, label: l.label, url: l.url })),
      },
      features: { ...s.featureFlags },
      serverTime: new Date(now).toISOString(),
    };
  }

  updateStatus(s: AppSettings, platform: ClientPlatform, appVersion: string): UpdateStatus {
    const policy = platform === 'IOS' ? s.appUpdate.ios : platform === 'ANDROID' ? s.appUpdate.android : null;
    if (!policy) return 'NONE';
    if (compareVersions(appVersion, policy.minSupportedVersion) < 0) return 'REQUIRED';
    if (compareVersions(appVersion, policy.latestVersion) < 0) return 'AVAILABLE';
    return 'NONE';
  }

  private versionPolicy(p: PlatformVersionPolicyDto) {
    return {
      minSupportedVersion: p.minSupportedVersion,
      latestVersion: p.latestVersion,
      updateRequiredMessage: p.updateRequiredMessage,
      updateAvailableMessage: p.updateAvailableMessage,
      storeUrl: p.storeUrl,
    };
  }
}
