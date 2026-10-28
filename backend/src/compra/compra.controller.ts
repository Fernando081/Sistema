import { CompraQueryDto } from './compra-query';
import { Body, Controller, Post, Get, Param, Query, StreamableFile, ParseIntPipe, Req } from '@nestjs/common';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolUsuario } from '../common/enums/app.enums';
import { JwtPayload } from '../auth/auth.types';
import { CompraService } from './compra.service';
import { CreateCompraDto } from './compra.dto';

@Controller('compra')
export class CompraController {
  constructor(private readonly compraService: CompraService) {}

  // H02-b · Compra directa: orden + recepción + factura aprobada (y pago si es de contado).
  // Aprueba la cuenta por pagar, por eso exige lo mismo que Cuentas por pagar: ADMIN + compras.pagar.
  @Post()
  @Roles(RolUsuario.ADMIN)
  @Permissions('compras.recibir', 'compras.pagar')
  create(@Body() createCompraDto: CreateCompraDto, @Req() req: { user: JwtPayload }) {
    return this.compraService.create(createCompraDto, req.user?.idUser);
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
  findDetalle(@Param('id', ParseIntPipe) id: number, @Query('fuente') fuente?: string) {
    return this.compraService.findDetalle(id, fuente === 'orden' ? 'orden' : 'compra');
  }
}
