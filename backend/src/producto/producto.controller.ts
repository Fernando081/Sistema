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
import { CreateProductoDto, UpdateProductoDto } from './producto.dto';

@Controller('producto') // Endpoint: /api/v1/producto
export class ProductoController {
  constructor(private readonly productoService: ProductoService) {}

  @Post()
  create(@Body() createProductoDto: CreateProductoDto) {
    return this.productoService.create(createProductoDto);
  }

  @Get()
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
  ) {
    return this.productoService.findAll(page, limit, sort, order);
  }

  @Get('smart-restock')
  getSmartRestock() {
    return this.productoService.getSmartRestock();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.productoService.findOne(id);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateProductoDto: UpdateProductoDto,
  ) {
    return this.productoService.update(id, updateProductoDto);
  }

  @Delete(':id')
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
  agregarEquivalente(
    @Param('id', ParseIntPipe) id: number,
    @Param('idEq', ParseIntPipe) idEq: number,
  ) {
    return this.productoService.agregarEquivalente(id, idEq);
  }

  @Delete(':id/equivalentes/:idEq')
  eliminarEquivalente(
    @Param('id', ParseIntPipe) id: number,
    @Param('idEq', ParseIntPipe) idEq: number,
  ) {
    return this.productoService.eliminarEquivalente(id, idEq);
  }
}
