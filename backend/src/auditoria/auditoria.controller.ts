import { Controller, Get, UseGuards } from '@nestjs/common';
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
  findAll() {
    return this.auditoriaService.findAll();
  }
}
