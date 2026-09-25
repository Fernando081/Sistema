// backend/src/reportes/reportes.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UtilidadProductoRaw, UtilidadProductoResponse } from './reportes.types';

@Injectable()
export class ReportesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getUtilidadProductos(): Promise<UtilidadProductoResponse[]> {
    const rawResult: UtilidadProductoRaw[] = await this.dataSource.query(
      'SELECT * FROM fn_get_margen_productos()'
    );

    return rawResult.map((row) => ({
      idProducto: row.id_producto,
      codigo: row.codigo,
      descripcion: row.descripcion,
      cantidadVendida: parseFloat(row.cantidad_vendida) || 0,
      ingresosTotales: parseFloat(row.ingresos_totales) || 0,
      costoTotal: row.costo_total === null ? null : Number(row.costo_total),
      utilidadBruta: row.utilidad_bruta === null ? null : Number(row.utilidad_bruta),
      margenPorcentaje: row.margen_porcentaje === null ? null : Number(row.margen_porcentaje),
      costoConocido: row.costo_conocido,
    }));
  }
}
