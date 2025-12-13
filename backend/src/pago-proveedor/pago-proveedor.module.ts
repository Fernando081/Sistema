// backend/src/pago-proveedor/pago-proveedor.module.ts
import { Module } from '@nestjs/common';
import { PagoProveedorService } from './pago-proveedor.service';
import { PagoProveedorController } from './pago-proveedor.controller';

@Module({
  providers: [PagoProveedorService],
  controllers: [PagoProveedorController]
})
export class PagoProveedorModule {}