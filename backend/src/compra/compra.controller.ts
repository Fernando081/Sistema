import { CompraQueryDto } from './compra-query';
import { Body, Controller, Post, Get, Param, Query, StreamableFile, ParseIntPipe } from '@nestjs/common';
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
  findAll(@Query() query: CompraQueryDto) {
    return this.compraService.findAll(query.page, query.limit, query.term, query.sortBy, query.sortOrder, query.estado, query.desde, query.hasta);
  }
  @Get('exportar')
  async exportCsv(@Query() query: CompraQueryDto) {
    return new StreamableFile(Buffer.from(await this.compraService.exportCsv(query), 'utf8'), {
      type: 'text/csv; charset=utf-8', disposition: 'attachment; filename="compras.csv"',
    });
  }

  @Get(':id/detalle')
  findDetalle(@Param('id', ParseIntPipe) id: number) {
    return this.compraService.findDetalle(id);
  }
}
