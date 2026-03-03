// frontend/src/app/compra/compra.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateCompraDto } from './compra.dto';

@Injectable()
export class CompraService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async create(createCompraDto: CreateCompraDto) {
    const conceptosJson = JSON.stringify(createCompraDto.conceptos);
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const result = await queryRunner.query(
        // Llamamos a la función con 6 parámetros ($1 a $6)
        `SELECT fn_crear_compra($1, $2, $3, $4, $5, $6) as id_compra`,
        [
          createCompraDto.idProveedor,
          createCompraDto.folioFactura || '',
          createCompraDto.esCredito, // <--- Nuevo
          createCompraDto.total,
          createCompraDto.observaciones || '',
          conceptosJson,
        ],
      );

      await queryRunner.commitTransaction();

      return {
        message: 'Compra registrada con éxito. Inventario actualizado.',
        idCompra: result[0].id_compra,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async findAll(page: number = 1, limit: number = 10) {
    const offset = (page - 1) * limit;

    const [totalResult, dataResult] = await Promise.all([
      this.dataSource.query('SELECT COUNT(*) as count FROM fn_get_compras()'),
      this.dataSource.query(
        'SELECT * FROM fn_get_compras() LIMIT $1 OFFSET $2',
        [limit, offset]
      ),
    ]);

    const total = parseInt(totalResult[0].count, 10);
    const totalPages = Math.ceil(total / limit);

    return {
      data: dataResult,
      total,
      page,
      totalPages,
    };
  }

  async findDetalle(idCompra: number) {
    return this.dataSource.query('SELECT * FROM fn_get_detalle_compra($1)', [
      idCompra,
    ]);
  }
}
