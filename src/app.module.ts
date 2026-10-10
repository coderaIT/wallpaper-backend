import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigService } from './config/app-config.type';
import { validateEnv } from './config/env.validation';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { getThrottleProfile } from './common/throttling/throttle-profile.decorator';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { HealthController } from './health/health.controller';
import { AdminsModule } from './modules/admins/admins.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AppSettingsModule } from './modules/app-settings/app-settings.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { AuthModule } from './modules/auth/auth.module';
import { BannersModule } from './modules/banners/banners.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { HomeSectionsModule } from './modules/home-sections/home-sections.module';
import { MediaModule } from './modules/media/media.module';
import { PublicModule } from './modules/public/public.module';
import { WallpapersModule } from './modules/wallpapers/wallpapers.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: process.env.NODE_ENV === 'test' ? ['.env.test'] : ['.env'],
      validate: validateEnv,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: AppConfigService) => ({
        throttlers: [
          {
            name: 'default',
            limit: config.get('THROTTLE_DEFAULT_LIMIT', { infer: true }),
            ttl: config.get('THROTTLE_DEFAULT_TTL_MS', { infer: true }),
          },
          {
            name: 'auth',
            limit: config.get('THROTTLE_AUTH_LIMIT', { infer: true }),
            ttl: config.get('THROTTLE_AUTH_TTL_MS', { infer: true }),
            skipIf: (ctx) => getThrottleProfile(ctx) !== 'auth',
          },
          {
            name: 'events',
            limit: config.get('THROTTLE_EVENTS_LIMIT', { infer: true }),
            ttl: config.get('THROTTLE_EVENTS_TTL_MS', { infer: true }),
            skipIf: (ctx) => getThrottleProfile(ctx) !== 'events',
          },
        ],
      }),
    }),
    PrismaModule,
    AuditLogsModule,
    AuthModule,
    AdminsModule,
    MediaModule,
    CategoriesModule,
    WallpapersModule,
    AppSettingsModule,
    HomeSectionsModule,
    BannersModule,
    PublicModule,
    AnalyticsModule,
    DashboardModule,
  ],
  controllers: [HealthController],
  // Global guards run in registration order: rate limit -> authenticate -> authorize.
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
