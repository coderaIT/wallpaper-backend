import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { MediaModule } from '../media/media.module';
import { multerOptionsFactory } from '../media/upload-options';
import { CategoryWallpapersController, WallpapersController } from './wallpapers.controller';
import { WallpapersService } from './wallpapers.service';

@Module({
  imports: [MediaModule, MulterModule.registerAsync({ inject: [ConfigService], useFactory: multerOptionsFactory })],
  controllers: [WallpapersController, CategoryWallpapersController],
  providers: [WallpapersService],
  exports: [WallpapersService],
})
export class WallpapersModule {}
