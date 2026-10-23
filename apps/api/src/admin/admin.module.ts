import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminBootstrapService } from './admin-bootstrap.service.js';
import { AdminUsersService } from './admin-users.service.js';
import { AdminController } from './admin.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [AdminUsersService, AdminBootstrapService],
})
export class AdminModule {}
