// backend/src/pago-proveedor/pago-proveedor.controller.ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PagoProveedorService } from './pago-proveedor.service';
import { RegistrarPagoProveedorDto } from './pago-proveedor.dto';

@Controller('pago-proveedor')
export class PagoProveedorController {
  constructor(private readonly pagoService: PagoProveedorService) {}

  @Post()
  registrar(@Body() dto: RegistrarPagoProveedorDto) {
    return this.pagoService.registrarPago(dto);
  }

  @Get('compra/:id')
  getPagos(@Param('id') id: number) {
    return this.pagoService.getPagosPorCompra(id);
  }

  @Get('deuda/:idProveedor')
  getDeuda(@Param('idProveedor') id: number) {
    return this.pagoService.getDeudaPorProveedor(id);
  }
}