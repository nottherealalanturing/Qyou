import { Module } from '@nestjs/common';
import { ServiceLocationsAdminController } from './service-locations.admin.controller.js';
import { ServiceLocationsAdminService } from './service-locations.admin.service.js';
import { ServiceLocationsPublicController } from './service-locations.public.controller.js';
import { ServiceLocationsService } from './service-locations.service.js';

@Module({
  controllers: [ServiceLocationsPublicController, ServiceLocationsAdminController],
  providers: [ServiceLocationsService, ServiceLocationsAdminService],
  exports: [ServiceLocationsService],
})
export class ServiceLocationsModule {}
