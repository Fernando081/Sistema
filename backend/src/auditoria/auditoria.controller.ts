import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { AuditoriaService } from './auditoria.service';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RolUsuario } from '../common/enums/app.enums';

@Controller('auditoria')
@UseGuards(RolesGuard)
export class AuditoriaController {
  constructor(private readonly auditoriaService: AuditoriaService) {}

  @Get()
  @Roles(RolUsuario.ADMIN)
  @Header('Cache-Control','private, no-store')
  findAll() {
    return this.auditoriaService.findAll();
  }

  @Get('estado') @Roles(RolUsuario.ADMIN) @Header('Cache-Control','private, no-store')
  protection(){return this.auditoriaService.protection();}
}
