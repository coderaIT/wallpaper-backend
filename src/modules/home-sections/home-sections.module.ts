import { Module } from '@nestjs/common';
import { HomeSectionsController } from './home-sections.controller';
import { HomeSectionsService } from './home-sections.service';

@Module({
  controllers: [HomeSectionsController],
  providers: [HomeSectionsService],
  exports: [HomeSectionsService],
})
export class HomeSectionsModule {}
