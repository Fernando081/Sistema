import { Body, Controller, Get, Header, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/auth.types';
import { RolUsuario } from '../common/enums/app.enums';
import { MotivoExpedienteDto } from './unidad-expediente.dto';
import { CrearPiezaDto, PiezasQuery, RevisionPiezaDto, VincularGarantiaPiezaDto } from './unidad-piezas.dto';
import { UnidadPiezasService } from './unidad-piezas.service';

@Controller('crm/unidades/:unidad/piezas')
@Permissions('crm.unidades.consultar')
export class UnidadPiezasController {
 constructor(private readonly service: UnidadPiezasService) {}
 @Get() @Header('Cache-Control', 'private, no-store')
 list(@Param('unidad', ParseIntPipe) id: number, @Query() query: PiezasQuery, @Req() req: {user: JwtPayload}) { return this.service.list(id, query, req.user); }
 @Get('origenes') @Header('Cache-Control', 'private, no-store')
 sources(@Param('unidad', ParseIntPipe) id: number, @Query() query: PiezasQuery, @Req() req: {user: JwtPayload}) { return this.service.sources(id, query, req.user); }
 @Get(':pieza/garantias-candidatas') @Header('Cache-Control', 'private, no-store')
 claims(@Param('unidad', ParseIntPipe) id: number, @Param('pieza', ParseIntPipe) piece: number, @Query() query: PiezasQuery, @Req() req: {user: JwtPayload}) { return this.service.claims(id, piece, query, req.user); }
 @Get(':pieza/garantias-historial') @Header('Cache-Control', 'private, no-store')
 history(@Param('unidad', ParseIntPipe) id: number, @Param('pieza', ParseIntPipe) piece: number, @Query() query: PiezasQuery, @Req() req: {user: JwtPayload}) { return this.service.history(id, piece, query, req.user); }
 @Post() @Permissions('crm.unidades.consultar', 'crm.unidades.gestionar')
 create(@Param('unidad', ParseIntPipe) id: number, @Body() dto: CrearPiezaDto, @Req() req: {user: JwtPayload}) { return this.service.create(id, dto, req.user); }
 @Post(':pieza/revision') @Permissions('crm.unidades.consultar', 'crm.unidades.gestionar')
 review(@Param('unidad', ParseIntPipe) id: number, @Param('pieza', ParseIntPipe) piece: number, @Body() dto: RevisionPiezaDto, @Req() req: {user: JwtPayload}) { return this.service.review(id, piece, dto, req.user); }
 @Post(':pieza/anular') @Roles(RolUsuario.ADMIN) @Permissions('crm.unidades.consultar', 'crm.unidades.gestionar')
 annul(@Param('unidad', ParseIntPipe) id: number, @Param('pieza', ParseIntPipe) piece: number, @Body() dto: MotivoExpedienteDto, @Req() req: {user: JwtPayload}) { return this.service.annul(id, piece, dto, req.user); }
 @Post(':pieza/garantias') @Permissions('crm.unidades.consultar', 'crm.unidades.gestionar')
 link(@Param('unidad', ParseIntPipe) id: number, @Param('pieza', ParseIntPipe) piece: number, @Body() dto: VincularGarantiaPiezaDto, @Req() req: {user: JwtPayload}) { return this.service.link(id, piece, dto, req.user); }
 @Post(':pieza/garantias/:vinculo/retirar') @Roles(RolUsuario.ADMIN) @Permissions('crm.unidades.consultar', 'crm.unidades.gestionar')
 unlink(@Param('unidad', ParseIntPipe) id: number, @Param('pieza', ParseIntPipe) piece: number, @Param('vinculo', ParseIntPipe) link: number, @Body() dto: MotivoExpedienteDto, @Req() req: {user: JwtPayload}) { return this.service.unlink(id, piece, link, dto, req.user); }
}
