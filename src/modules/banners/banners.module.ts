import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { BannersController } from './banners.controller';
import { BannersService } from './banners.service';

@Module({
  imports: [MediaModule],
  controllers: [BannersController],
  providers: [BannersService],
  exports: [BannersService],
})
export class BannersModule {}
