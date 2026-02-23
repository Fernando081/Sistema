// backend/src/categoria/categoria.module.ts (REEMPLAZAR)
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Categoria } from './categoria.entity';
import { CategoriaService } from './categoria.service';
import { CategoriaController } from './categoria.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Categoria])],
  providers: [CategoriaService],
  controllers: [CategoriaController],
})
export class CategoriaModule {}
