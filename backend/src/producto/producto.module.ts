// backend/src/producto/producto.module.ts (REEMPLAZAR)
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Producto } from './producto.entity';
import { ProductoService } from './producto.service';
import { ProductoController } from './producto.controller';
import { ProductoLoteService } from './producto-lote.service';

@Module({
  imports: [TypeOrmModule.forFeature([Producto])],
  providers: [ProductoService, ProductoLoteService],
  controllers: [ProductoController],
})
export class ProductoModule {}
