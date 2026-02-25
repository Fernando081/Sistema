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

    const result = await this.dataSource.query(
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

    return {
      message: 'Compra registrada con éxito. Inventario actualizado.',
      idCompra: result[0].id_compra,
    };
  }

  async findAll() {
    return this.dataSource.query('SELECT * FROM fn_get_compras()');
  }

  async findDetalle(idCompra: number) {
    return this.dataSource.query('SELECT * FROM fn_get_detalle_compra($1)', [
      idCompra,
    ]);
  }
}
