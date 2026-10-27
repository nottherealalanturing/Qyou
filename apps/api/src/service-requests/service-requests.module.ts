import { Module } from '@nestjs/common';
import { AssistantsModule } from '../assistants/assistants.module.js';
import { AssistantRequestsController } from './assistant-requests.controller.js';
import { AssistantRequestsService } from './assistant-requests.service.js';
import { ServiceRequestsController } from './service-requests.controller.js';
import { ServiceRequestsService } from './service-requests.service.js';

@Module({
  imports: [AssistantsModule],
  controllers: [ServiceRequestsController, AssistantRequestsController],
  providers: [ServiceRequestsService, AssistantRequestsService],
})
export class ServiceRequestsModule {}
