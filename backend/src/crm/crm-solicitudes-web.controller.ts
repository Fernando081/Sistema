import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Equals, IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { Roles } from '../auth/roles.decorator';
import { RolUsuario } from '../common/enums/app.enums';
import { JwtPayload } from '../auth/auth.types';
import { CrmPageQuery } from './crm.dto';
import { CrmSolicitudesWebService } from './crm-solicitudes-web.service';
import type { WebResolutionReason } from './crm-solicitudes-web.service';
import { CrmSolicitudesWebMaintenance } from './crm-solicitudes-web-maintenance.service';
import { bridgeStatus } from './web-lead-bridge.config';
import { CrmWebMetricsService, WebMetricsQuery } from './crm-web-metrics.service';

export class ReviewWebLeadDto {
  @IsIn(['Revisada', 'Descartada']) estado: string;
  @IsInt() @Min(1) expectedVersion: number;
}
export class ConvertWebLeadDto {
  @IsInt() @Min(1) expectedVersion: number;
  @IsOptional() @IsInt() @Min(1) idResponsable?: number;
}
export class ResolveWebLeadDto {
  @IsUUID('4') operationId: string;
  @IsIn(['Contenido', 'Catalogo', 'Clave', 'Confirmacion']) motivo: WebResolutionReason;
  @IsInt() @Min(1) expectedVersion: number;
  @Equals(true) originalVerificado: boolean;
}

@Controller('crm/solicitudes-web')
@Roles(RolUsuario.ADMIN)
export class CrmSolicitudesWebController {
  constructor(private readonly service: CrmSolicitudesWebService, private readonly maintenance: CrmSolicitudesWebMaintenance,
    private readonly metrics: CrmWebMetricsService) {}
  @Get('metricas')
  @Header('Cache-Control', 'private, no-store')
  metricsReport(@Query() query: WebMetricsQuery) { return this.metrics.report(query.desde, query.hasta); }
  @Get('mantenimiento') maintenanceStatus() { return this.maintenance.status(); }
  @Get('puente')
  @Header('Cache-Control', 'no-store')
  bridgeStatus() { return bridgeStatus(); }
  @Get() list(@Query() query: CrmPageQuery) { return this.service.list(query.page, query.limit); }
  @Get(':id/estado')
  @Header('Cache-Control', 'no-store')
  receiptStatus(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.service.receiptStatus(id);
  }
  @Get(':id/resoluciones')
  @Header('Cache-Control', 'no-store')
  resolutions(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.service.resolutions(id);
  }
  @Post(':id/resolver')
  @Header('Cache-Control', 'no-store')
  resolve(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ResolveWebLeadDto, @Req() req: { user: JwtPayload }) {
    return this.service.resolve(id, dto.operationId, dto.motivo, dto.expectedVersion, req.user.idUser!);
  }
  @Patch(':id') review(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ReviewWebLeadDto, @Req() req: { user: JwtPayload }) {
    return this.service.review(id, dto.estado, dto.expectedVersion, req.user.idUser!);
  }
  @Post('purgar-vencidas') purge() { return this.service.purgeExpired(); }
  @Post(':id/convertir') convert(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ConvertWebLeadDto, @Req() req: { user: JwtPayload }) {
    return this.service.convert(id, dto.expectedVersion, req.user.idUser!, dto.idResponsable);
  }
}
