import { Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Post, Query, Req, BadRequestException } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { RolUsuario } from '../common/enums/app.enums';
import { CajaService } from './caja.service';
import { ConteoCajaDto } from './caja.dto';
import { Permissions } from '../auth/permissions.decorator';

@Controller('caja')
@Roles(RolUsuario.ADMIN)
export class CajaController {
  constructor(private readonly caja: CajaService) {}
  @Get() resumen() { return this.caja.resumen(); }
  @Post('abrir') @Permissions('caja.operar') abrir(@Body() dto: ConteoCajaDto, @Req() req: {user: {idUser?: number}}) { return this.caja.abrir(dto,req.user.idUser); }
  @Post(':id/cerrar') @Permissions('caja.cerrar') cerrar(@Param('id',ParseIntPipe) id: number,@Body() dto: ConteoCajaDto,@Req() req: {user: {idUser?: number}}) { return this.caja.cerrar(id,dto,req.user.idUser); }
  @Get(':id/movimientos') movimientos(@Param('id',ParseIntPipe) id: number,@Query('page',new DefaultValuePipe(1),ParseIntPipe) page: number) {
    if (page<1 || page>100000) throw new BadRequestException('Página fuera de rango');
    return this.caja.movimientos(id,page);
  }
}
