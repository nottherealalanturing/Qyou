import { Module } from '@nestjs/common';
import { ServiceCategoriesAdminController } from './service-categories.admin.controller.js';
import { ServiceCategoriesAdminService } from './service-categories.admin.service.js';
import { ServiceCategoriesPublicController } from './service-categories.public.controller.js';
import { ServiceCategoriesService } from './service-categories.service.js';

@Module({
  controllers: [ServiceCategoriesPublicController, ServiceCategoriesAdminController],
  providers: [ServiceCategoriesService, ServiceCategoriesAdminService],
  exports: [ServiceCategoriesService],
})
export class ServiceCategoriesModule {}
