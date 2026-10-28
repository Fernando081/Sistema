// backend/src/pago-proveedor/pago-proveedor.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import { PagoProveedorService } from './pago-proveedor.service';
import { RegistrarPagoProveedorDto } from './pago-proveedor.dto';
import { Roles } from '../auth/roles.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { RolUsuario } from '../common/enums/app.enums';
import { JwtPayload } from '../auth/auth.types';

@Controller('pago-proveedor')
export class PagoProveedorController {
  constructor(private readonly pagoService: PagoProveedorService) {}

  // Mismo control que los pagos de cuentas-proveedor: registra salida de dinero.
  @Post()
  @Roles(RolUsuario.ADMIN)
  @Permissions('compras.pagar')
  registrar(
    @Body() dto: RegistrarPagoProveedorDto,
    @Req() req: { user: JwtPayload },
  ) {
    return this.pagoService.registrarPago(dto, req.user?.idUser);
  }

  @Get('compra/:id')
  getPagos(@Param('id', ParseIntPipe) id: number) {
    return this.pagoService.getPagosPorCompra(id);
  }

  @Get('deuda')
  getAllDeuda() {
    return this.pagoService.getAllDeuda();
  }

  @Get('deuda/:idProveedor')
  getDeuda(@Param('idProveedor', ParseIntPipe) id: number) {
    return this.pagoService.getDeudaPorProveedor(id);
  }
}
