import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { Prisma } from '../../generated/prisma/client';
import { EnvironmentVariables } from '../../config/env.validation';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { deepMerge } from '../../common/utils/deep-merge.util';
import { compareVersions } from '../../common/utils/semver.util';
import { TtlCache } from '../../common/utils/ttl-cache';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction, AuditEntity } from '../audit-logs/audit-actions';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthenticatedAdmin } from '../auth/interfaces/authenticated-admin.interface';
import { APP_CONFIG_KEY, AppSettings, buildDefaultAppSettings } from './app-settings.defaults';
import { AppSettingsDto, UpdateAppSettingsDto } from './dto/app-settings.dto';

export interface StoredSettings {
  settings: AppSettings;
  version: number;
  updatedAt: Date | null;
  updatedBy: { id: string; name: string } | null;
}

@Injectable()
export class AppSettingsService {
  private readonly cache: TtlCache<StoredSettings>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.cache = new TtlCache(config.get('PUBLIC_CACHE_TTL_SECONDS', { infer: true }) * 1000, 1);
  }

  /** Cached, always-complete settings (stored document merged over current defaults). */
  async get(): Promise<StoredSettings> {
    return this.cache.getOrLoad(APP_CONFIG_KEY, () => this.load());
  }

  async getSettings(): Promise<AppSettings> {
    return (await this.get()).settings;
  }

  async update(dto: UpdateAppSettingsDto, actor: AuthenticatedAdmin, meta: RequestMeta): Promise<StoredSettings> {
    const current = await this.load();
    if (dto.expectedVersion !== undefined && dto.expectedVersion !== current.version) {
      throw new ConflictException({
        message: 'Settings were modified by someone else. Reload and retry.',
        details: { expectedVersion: dto.expectedVersion, currentVersion: current.version },
      });
    }
    const { expectedVersion: _ignored, ...patch } = dto;
    const merged = deepMerge(current.settings, patch);
    const validated = await this.validateSettings(merged);

    const changedSections = Object.keys(patch).filter(
      (k) => JSON.stringify((current.settings as unknown as Record<string, unknown>)[k]) !== JSON.stringify((validated as unknown as Record<string, unknown>)[k]),
    );
    const value = validated as unknown as Prisma.InputJsonValue;

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.appSetting.findUnique({ where: { key: APP_CONFIG_KEY }, select: { version: true } });
      if (!existing) {
        await tx.appSetting.create({ data: { key: APP_CONFIG_KEY, value, version: 1, updatedById: actor.id } });
      } else {
        const res = await tx.appSetting.updateMany({
          where: { key: APP_CONFIG_KEY, version: current.version },
          data: { value, version: { increment: 1 }, updatedById: actor.id },
        });
        if (res.count !== 1) throw new ConflictException('Settings were modified concurrently. Reload and retry.');
      }
      await this.audit.record(
        {
          adminId: actor.id,
          action: AuditAction.SettingsUpdated,
          entityType: AuditEntity.Settings,
          entityId: APP_CONFIG_KEY,
          metadata: { changedSections, patch },
          meta,
        },
        tx,
      );
    });
    this.cache.clear();
    return this.load();
  }

  /** Validates a full settings document; throws 400 with flattened messages on failure. */
  async validateSettings(candidate: unknown): Promise<AppSettings> {
    const instance = plainToInstance(AppSettingsDto, candidate);
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) {
      throw new BadRequestException({ message: 'Validation failed', details: flatten(errors) });
    }
    const versionErrors = (['android', 'ios'] as const)
      .filter((p) => compareVersions(instance.appUpdate[p].minSupportedVersion, instance.appUpdate[p].latestVersion) > 0)
      .map((p) => `appUpdate.${p}: minSupportedVersion must not be greater than latestVersion`);
    if (versionErrors.length > 0) {
      throw new BadRequestException({ message: 'Validation failed', details: versionErrors });
    }
    return JSON.parse(JSON.stringify(instance)) as AppSettings;
  }

  invalidate(): void {
    this.cache.clear();
  }

  private async load(): Promise<StoredSettings> {
    const row = await this.prisma.appSetting.findUnique({
      where: { key: APP_CONFIG_KEY },
      include: { updatedBy: { select: { id: true, name: true } } },
    });
    const defaults = buildDefaultAppSettings();
    if (!row) return { settings: defaults, version: 0, updatedAt: null, updatedBy: null };
    return {
      settings: deepMerge(defaults, row.value),
      version: row.version,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    };
  }
}

function flatten(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap((e) => {
    const path = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {}).map((m) => `${path}: ${m}`);
    return [...own, ...flatten(e.children ?? [], path)];
  });
}
