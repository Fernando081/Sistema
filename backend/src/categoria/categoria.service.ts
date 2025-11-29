// backend/src/categoria/categoria.service.ts (REEMPLAZAR)

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Categoria } from './categoria.entity';
import { CreateCategoriaDto, UpdateCategoriaDto } from './categoria.dto';

@Injectable()
export class CategoriaService {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
  ) {}

  async findAll(): Promise<Categoria[]> {
    return this.dataSource.query('SELECT * FROM fn_get_categorias()');
  }

  async findOne(idCategoria: number): Promise<Categoria> {
    const result = await this.dataSource.query('SELECT * FROM fn_get_categoria_by_id($1)', [idCategoria]);
    if (!result || result.length === 0) {
      throw new NotFoundException(`Categoría con ID ${idCategoria} no encontrada.`);
    }
    return result[0];
  }

  async create(createCategoriaDto: CreateCategoriaDto): Promise<Categoria> {
    const result = await this.dataSource.query(
      'SELECT * FROM fn_create_categoria($1)',
      [createCategoriaDto.descripcion]
    );
    return result[0];
  }

  async update(idCategoria: number, updateCategoriaDto: UpdateCategoriaDto): Promise<Categoria> {
    // Obtenemos la categoría actual para fusionar datos
    const categoriaActual = await this.findOne(idCategoria);
    if (!categoriaActual) {
      throw new NotFoundException(`Categoría con ID ${idCategoria} no encontrada.`);
    }
    
    // Fusionamos (en este caso, solo hay 'descripcion')
    const datosAActualizar = { ...categoriaActual, ...updateCategoriaDto };

    const result = await this.dataSource.query(
      'SELECT * FROM fn_update_categoria($1, $2)',
      [idCategoria, datosAActualizar.descripcion]
    );
    return result[0];
  }

  async remove(idCategoria: number): Promise<void> {
    const result = await this.dataSource.query('SELECT * FROM fn_delete_categoria($1)', [idCategoria]);
    if (!result || result.length === 0) {
      throw new NotFoundException(`Categoría con ID ${idCategoria} no encontrada.`);
    }
  }
}