// backend/src/producto/producto.controller.ts (REEMPLAZAR)
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  Put,
  Delete,
  Query,
  DefaultValuePipe,
} from '@nestjs/common';
import { ProductoService } from './producto.service';
import { AjustarInventarioDto, CreateAplicacionDto, CreateNumeroParteDto, CreateProductoDto, UpdateProductoDto, CreateCotizacionProvDto } from './producto.dto';
import { Roles } from '../auth/roles.decorator';
import { RolUsuario } from '../common/enums/app.enums';
@Controller('producto') // Endpoint: /api/v1/producto
export class ProductoController {
  constructor(private readonly productoService: ProductoService) {}

  @Post()
  @Roles(RolUsuario.ADMIN)
  create(@Body() createProductoDto: CreateProductoDto) {
    return this.productoService.create(createProductoDto);
  }

  @Get()
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('term') term?: string,
  ) {
    return this.productoService.findAll(page, limit, sort, order, term);
  }

  @Get('smart-restock')
  getSmartRestock() {
    return this.productoService.getSmartRestock();
  }

  @Get('prediccion-compras')
  getPrediccionDemanda() {
    return this.productoService.getPrediccionDemanda();
  }

  @Post('prediccion-compras/refresh')
  @Roles(RolUsuario.ADMIN)
  refreshPrediccion() {
    return this.productoService.refreshPrediccion();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.productoService.findOne(id);
  }

  @Put(':id')
  @Roles(RolUsuario.ADMIN)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateProductoDto: UpdateProductoDto,
  ) {
    return this.productoService.update(id, updateProductoDto);
  }

  @Delete(':id')
  @Roles(RolUsuario.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.productoService.remove(id);
  }

  @Get(':id/kardex')
  async obtenerKardex(@Param('id', ParseIntPipe) id: number) {
    return this.productoService.getKardex(id);
  }

  @Get(':id/historial-precios')
  getHistorialPrecios(@Param('id', ParseIntPipe) id: number) {
    return this.productoService.getHistorialPrecios(id);
  }

  @Get(':id/equivalentes')
  getEquivalentes(@Param('id', ParseIntPipe) id: number) {
    return this.productoService.getEquivalentes(id);
  }

  @Post(':id/equivalentes/:idEq')
  @Roles(RolUsuario.ADMIN)
  agregarEquivalente(
    @Param('id', ParseIntPipe) id: number,
    @Param('idEq', ParseIntPipe) idEq: number,
  ) {
    return this.productoService.agregarEquivalente(id, idEq);
  }

  @Delete(':id/equivalentes/:idEq')
  @Roles(RolUsuario.ADMIN)
  eliminarEquivalente(
    @Param('id', ParseIntPipe) id: number,
    @Param('idEq', ParseIntPipe) idEq: number,
  ) {
    return this.productoService.eliminarEquivalente(id, idEq);
  }

  // --- CRUCES Y ALTERNATIVAS ---
  @Get(':id/alternativas')
  getAlternativas(@Param('id', ParseIntPipe) id: number) {
    return this.productoService.getAlternativas(id);
  }

  // --- COTIZACIONES PROVEEDORES ---
  @Get(':id/cotizacion-prov')
  getCotizacionesProveedor(@Param('id', ParseIntPipe) id: number) {
    return this.productoService.getCotizacionesProveedor(id);
  }

  @Post(':id/cotizacion-prov')
  @Roles(RolUsuario.ADMIN)
  addCotizacionProveedor(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCotizacionProvDto,
  ) {
    return this.productoService.addCotizacionProveedor(id, dto);
  }

  @Post(':id/ajustar-inventario')
  @Roles(RolUsuario.ADMIN)
  ajustarInventario(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AjustarInventarioDto,
  ) {
    return this.productoService.ajustarInventario(id, body.cantidad, body.tipo, body.motivo);
  }

  @Get(':id/numeros-parte')
  getNumerosParte(@Param('id', ParseIntPipe) id: number) { return this.productoService.getNumerosParte(id); }

  @Post(':id/numeros-parte')
  @Roles(RolUsuario.ADMIN)
  addNumeroParte(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateNumeroParteDto) {
    return this.productoService.addNumeroParte(id, dto);
  }

  @Delete(':id/numeros-parte/:idNumero')
  @Roles(RolUsuario.ADMIN)
  deleteNumeroParte(@Param('id', ParseIntPipe) id: number, @Param('idNumero', ParseIntPipe) idNumero: number) {
    return this.productoService.deleteNumeroParte(id, idNumero);
  }

  @Get(':id/aplicaciones')
  getAplicaciones(@Param('id', ParseIntPipe) id: number) { return this.productoService.getAplicaciones(id); }

  @Post(':id/aplicaciones')
  @Roles(RolUsuario.ADMIN)
  addAplicacion(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateAplicacionDto) {
    return this.productoService.addAplicacion(id, dto);
  }

  @Delete(':id/aplicaciones/:idAplicacion')
  @Roles(RolUsuario.ADMIN)
  deleteAplicacion(@Param('id', ParseIntPipe) id: number, @Param('idAplicacion', ParseIntPipe) idAplicacion: number) {
    return this.productoService.deleteAplicacion(id, idAplicacion);
  }
}
