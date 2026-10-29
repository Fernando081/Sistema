// backend/src/dashboard/dashboard.module.ts
import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { SaludSalidasService } from './salud-salidas.service';

@Module({
  providers: [DashboardService, SaludSalidasService],
  controllers: [DashboardController],
})
export class DashboardModule {}
