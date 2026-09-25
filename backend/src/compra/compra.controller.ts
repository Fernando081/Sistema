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
    @Query('term') term?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    return this.compraService.findAll(page, limit, term, sortBy, sortOrder);
  }

  @Get(':id/detalle')
  findDetalle(@Param('id', ParseIntPipe) id: number) {
    return this.compraService.findDetalle(id);
  }
}
