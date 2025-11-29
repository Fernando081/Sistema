// backend/src/dashboard/dashboard.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class DashboardService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async getMetrics() {
    const result = await this.dataSource.query('SELECT fn_get_dashboard_metrics() as datos');
    return result[0].datos;
  }
}