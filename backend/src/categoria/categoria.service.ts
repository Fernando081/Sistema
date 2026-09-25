// backend/src/categoria/categoria.service.ts (REEMPLAZAR)

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Categoria } from './categoria.entity';
import { CreateCategoriaDto, UpdateCategoriaDto } from './categoria.dto';
import { queryRows } from '../common/database/typed-query';

@Injectable()
export class CategoriaService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async findAll(): Promise<Categoria[]> {
    return queryRows<Categoria>(this.dataSource, 'SELECT * FROM fn_get_categorias()');
  }

  async findOne(idCategoria: number): Promise<Categoria> {
    const result = await queryRows<Categoria>(this.dataSource,
      'SELECT * FROM fn_get_categoria_by_id($1) WHERE "IdCategoria" IS NOT NULL',
      [idCategoria],
    );
    if (!result || result.length === 0) {
      throw new NotFoundException(
        `Categoría con ID ${idCategoria} no encontrada.`,
      );
    }
    return result[0];
  }

  async create(createCategoriaDto: CreateCategoriaDto): Promise<Categoria> {
    const result = await queryRows<Categoria>(this.dataSource,
      'SELECT * FROM fn_create_categoria($1)',
      [createCategoriaDto.descripcion],
    );
    return result[0];
  }

  async update(
    idCategoria: number,
    updateCategoriaDto: UpdateCategoriaDto,
  ): Promise<Categoria> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await queryRows<{ Descripcion: string }>(manager, 'SELECT * FROM categoria WHERE "IdCategoria"=$1 FOR UPDATE', [idCategoria]);
      if (!rows.length) throw new NotFoundException(`Categoría con ID ${idCategoria} no encontrada.`);
      const result = await queryRows<Categoria>(manager, 'SELECT * FROM fn_update_categoria($1, $2)',
        [idCategoria, updateCategoriaDto.descripcion ?? rows[0].Descripcion]);
      return result[0];
    });
  }

  async remove(idCategoria: number): Promise<void> {
    const result = await queryRows<Categoria>(this.dataSource,
      'SELECT * FROM fn_delete_categoria($1) WHERE "IdCategoria" IS NOT NULL',
      [idCategoria],
    );
    if (!result || result.length === 0) {
      throw new NotFoundException(
        `Categoría con ID ${idCategoria} no encontrada.`,
      );
    }
  }
}
