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
      'SELECT * FROM fn_get_utilidad_productos()'
    );

    return rawResult.map((row) => ({
      idProducto: row.id_producto,
      codigo: row.codigo,
      descripcion: row.descripcion,
      cantidadVendida: parseFloat(row.cantidad_vendida) || 0,
      ingresosTotales: parseFloat(row.ingresos_totales) || 0,
      costoTotal: parseFloat(row.costo_total) || 0,
      utilidadNeta: parseFloat(row.utilidad_neta) || 0,
      margenPorcentaje: parseFloat(row.margen_porcentaje) || 0,
    }));
  }
}
