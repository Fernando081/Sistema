// backend/src/reportes/reportes.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReportesService } from './reportes.service';
import { UtilidadProductoResponse } from './reportes.types';
import { Roles } from '../auth/roles.decorator';
import { RolUsuario } from '../common/enums/app.enums';

@Controller('reportes')
@UseGuards(JwtAuthGuard)
@Roles(RolUsuario.ADMIN)
export class ReportesController {
  constructor(private readonly reportesService: ReportesService) {}

  @Get('utilidad')
  async getUtilidadProductos(): Promise<UtilidadProductoResponse[]> {
    return await this.reportesService.getUtilidadProductos();
  }
}
