import { Module } from '@nestjs/common';
import { CuentasProveedorController } from './cuentas-proveedor.controller';
import { CuentasProveedorService } from './cuentas-proveedor.service';

import { FacturasProveedorService } from './facturas-proveedor.service';
import { PagosProveedorService } from './pagos-proveedor.service';
import { SaldosProveedorService } from './saldos-proveedor.service';
import { ConsultasProveedorService } from './consultas-proveedor.service';
@Module({
  controllers: [CuentasProveedorController],
  providers: [
    CuentasProveedorService,
    FacturasProveedorService,
    PagosProveedorService,
    SaldosProveedorService,
    ConsultasProveedorService,
  ],
  exports: [CuentasProveedorService, FacturasProveedorService, PagosProveedorService],
})
export class CuentasProveedorModule {}
