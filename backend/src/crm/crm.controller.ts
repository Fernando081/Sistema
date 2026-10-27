import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { CrmService } from './crm.service';
import { BusquedaGlobalQuery, CreateCampanaDto, CreateCrmComunicacionDto, CreateCrmTareaDto, CreateEncuestaDto, CreateMetaDto, CreateOportunidadDto, CreatePlantillaDto, CreateSegmentoDto, CreateSeguimientoDto, CreateUnidadClienteDto, CreateVentaPerdidaDto, CrmPageQuery, CrmTareasQuery, OportunidadesQuery, UpdateCrmTareaDto, UpdateOportunidadDto, UpdateUnidadClienteDto, VentasPerdidasQuery } from './crm.dto';
import { JwtPayload } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { RolUsuario } from '../common/enums/app.enums';
import { CrmSolicitudesWebService } from './crm-solicitudes-web.service';

@Controller('crm')
export class CrmController {
  constructor(private readonly service: CrmService, private readonly web: CrmSolicitudesWebService) {}
  @Get('oportunidades/:id/consulta-web') consultaWeb(@Param('id', ParseIntPipe) id: number, @Req() req: { user: JwtPayload }) {
    return this.web.snapshot(id, req.user.idUser!, req.user.role === RolUsuario.ADMIN);
  }

  @Get('resumen') resumen() { return this.service.resumen(); }
  @Get('busqueda') busqueda(@Query() query: BusquedaGlobalQuery) { return this.service.busquedaGlobal(query.q); }
  @Get('oportunidades') findAll(@Query() query: OportunidadesQuery) { return this.service.findAll(query); }
  @Get('oportunidades/:id') findOne(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }
  @Post('oportunidades') create(@Body() dto: CreateOportunidadDto, @Req() req: { user: JwtPayload }) {
    return this.service.create(dto, req.user?.idUser);
  }
  @Patch('oportunidades/:id') update(
    @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOportunidadDto, @Req() req: { user: JwtPayload },
  ) { return this.service.update(id, dto, req.user?.idUser); }
  @Get('oportunidades/:id/seguimientos') seguimientos(@Param('id', ParseIntPipe) id: number, @Query() query: CrmPageQuery) {
    return this.service.getSeguimientos(id, query);
  }
  @Post('oportunidades/:id/seguimientos') addSeguimiento(
    @Param('id', ParseIntPipe) id: number, @Body() dto: CreateSeguimientoDto, @Req() req: { user: JwtPayload },
  ) { return this.service.addSeguimiento(id, dto, req.user?.idUser); }
  @Get('ventas-perdidas') ventasPerdidas(@Query() query: VentasPerdidasQuery) {
    return this.service.getVentasPerdidas(query);
  }
  @Post('ventas-perdidas') ventaPerdida(@Body() dto: CreateVentaPerdidaDto, @Req() req: { user: JwtPayload }) {
    return this.service.registrarVentaPerdida(dto, req.user?.idUser);
  }
  @Get('clientes/:id/unidades') unidadesCliente(@Param('id', ParseIntPipe) id: number) {
    return this.service.getUnidadesCliente(id);
  }
  @Post('clientes/:id/unidades') addUnidadCliente(
    @Param('id', ParseIntPipe) id: number, @Body() dto: CreateUnidadClienteDto,
  ) { return this.service.addUnidadCliente(id, dto); }
  @Get('oportunidades/:id/unidades') unidades(@Param('id', ParseIntPipe) id: number) {
    return this.service.getUnidades(id);
  }
  @Post('oportunidades/:id/unidades') addUnidad(
    @Param('id', ParseIntPipe) id: number, @Body() dto: CreateUnidadClienteDto, @Req() req: { user: JwtPayload },
  ) { return this.service.addUnidad(id, dto, req.user?.idUser); }
  @Patch('unidades/:id') updateUnidad(
    @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUnidadClienteDto, @Req() req: { user: JwtPayload },
  ) { return this.service.updateUnidad(id, dto, req.user?.idUser); }
  @Delete('unidades/:id') deleteUnidad(
    @Param('id', ParseIntPipe) id: number, @Req() req: { user: JwtPayload },
  ) { return this.service.deleteUnidad(id, req.user?.idUser); }
  @Get('segmentos') segmentos() { return this.service.segmentos(); }
  @Post('segmentos') @Roles(RolUsuario.ADMIN) createSegmento(@Body() dto: CreateSegmentoDto, @Req() req: { user: JwtPayload }) { return this.service.createSegmento(dto, req.user?.idUser); }
  @Get('plantillas') plantillas() { return this.service.plantillas(); }
  @Post('plantillas') @Roles(RolUsuario.ADMIN) createPlantilla(@Body() dto: CreatePlantillaDto, @Req() req: { user: JwtPayload }) { return this.service.createPlantilla(dto, req.user?.idUser); }
  @Get('campanas') campanas() { return this.service.campanas(); }
  @Post('campanas') @Roles(RolUsuario.ADMIN) createCampana(@Body() dto: CreateCampanaDto, @Req() req: { user: JwtPayload }) { return this.service.createCampana(dto, req.user?.idUser); }
  @Get('encuestas') encuestas() { return this.service.encuestas(); }
  @Post('encuestas') createEncuesta(@Body() dto: CreateEncuestaDto, @Req() req: { user: JwtPayload }) { return this.service.createEncuesta(dto, req.user?.idUser); }
  @Get('metas') metas() { return this.service.metas(); }
  @Post('metas') @Roles(RolUsuario.ADMIN) createMeta(@Body() dto: CreateMetaDto) { return this.service.createMeta(dto); }
  @Get('tareas') tareas(@Query() query: CrmTareasQuery, @Req() req: { user: JwtPayload }) { return this.service.tareas(query, req.user.idUser!, req.user.role); }
  @Post('tareas') createTarea(@Body() dto: CreateCrmTareaDto, @Req() req: { user: JwtPayload }) { return this.service.createTarea(dto, req.user.idUser!, req.user.role); }
  @Patch('tareas/:id') updateTarea(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCrmTareaDto, @Req() req: { user: JwtPayload }) { return this.service.updateTarea(id, dto, req.user.idUser!, req.user.role,req.user,false); }
  @Get('comunicaciones') comunicaciones(@Query('idCliente') idCliente?: string, @Query('idOportunidad') idOportunidad?: string) { return this.service.comunicaciones(idCliente ? Number(idCliente) : undefined, idOportunidad ? Number(idOportunidad) : undefined); }
  @Post('comunicaciones') createComunicacion(@Body() dto: CreateCrmComunicacionDto, @Req() req: { user: JwtPayload }) { return this.service.createComunicacion(dto, req.user.idUser!); }
}
