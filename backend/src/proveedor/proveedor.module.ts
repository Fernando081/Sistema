// backend/src/proveedor/proveedor.module.ts (REEMPLAZAR)

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Proveedor } from './proveedor.entity';
import { ProveedorService } from './proveedor.service';
import { ProveedorController } from './proveedor.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Proveedor])],
  providers: [ProveedorService],
  controllers: [ProveedorController],
})
export class ProveedorModule {}
