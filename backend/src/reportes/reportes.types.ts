// backend/src/reportes/reportes.types.ts
export interface UtilidadProductoRaw {
  id_producto: number;
  codigo: string;
  descripcion: string;
  cantidad_vendida: string;
  ingresos_totales: string;
  costo_total: string;
  utilidad_neta: string;
  margen_porcentaje: string;
}

export interface UtilidadProductoResponse {
  idProducto: number;
  codigo: string;
  descripcion: string;
  cantidadVendida: number;
  ingresosTotales: number;
  costoTotal: number;
  utilidadNeta: number;
  margenPorcentaje: number;
}
