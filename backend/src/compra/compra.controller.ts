import { Body, Controller, Post, Get, Param, Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { CompraService } from './compra.service';
import { CreateCompraDto } from './compra.dto';

@Controller('compra')
export class CompraController {
  constructor(private readonly compraService: CompraService) {}

  @Post()
  create(@Body() createCompraDto: CreateCompraDto) {
    return this.compraService.create(createCompraDto);
  }

  @Get()
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.compraService.findAll(page, limit);
  }

  @Get(':id/detalle')
  findDetalle(@Param('id') id: number) {
    return this.compraService.findDetalle(id);
  }
}
