import { Module } from '@nestjs/common';
import { CuentasProveedorController } from './cuentas-proveedor.controller';
import { CuentasProveedorService } from './cuentas-proveedor.service';

@Module({ controllers: [CuentasProveedorController], providers: [CuentasProveedorService], exports: [CuentasProveedorService] })
export class CuentasProveedorModule {}
