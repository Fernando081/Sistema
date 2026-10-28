// backend/src/compra/compra.module.ts
import { Module } from '@nestjs/common';
import { CompraService } from './compra.service';
import { CompraController } from './compra.controller';
import { AbastecimientoModule } from '../abastecimiento/abastecimiento.module';
import { CuentasProveedorModule } from '../cuentas-proveedor/cuentas-proveedor.module';

@Module({
  imports: [AbastecimientoModule, CuentasProveedorModule],
  providers: [CompraService],
  controllers: [CompraController],
})
export class CompraModule {}
