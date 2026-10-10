import { Module } from '@nestjs/common';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { BannersModule } from '../banners/banners.module';
import { MediaModule } from '../media/media.module';
import { PublicCatalogService } from './public-catalog.service';
import { PublicConfigService } from './public-config.service';
import { PublicController } from './public.controller';
import { PublicHomeService } from './public-home.service';

/** Read-only, unauthenticated endpoints for the mobile app (`/api/v1/public/*`). */
@Module({
  imports: [MediaModule, AppSettingsModule, BannersModule],
  controllers: [PublicController],
  providers: [PublicCatalogService, PublicConfigService, PublicHomeService],
})
export class PublicModule {}
