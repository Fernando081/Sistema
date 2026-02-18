// backend/src/dashboard/dashboard.service.ts
import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  getMetrics() {
    return this.dashboardService.getMetrics();
  }
}
