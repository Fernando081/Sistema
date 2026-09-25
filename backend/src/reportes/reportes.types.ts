// backend/src/reportes/reportes.types.ts
export interface UtilidadProductoRaw {
  id_producto: number;
  codigo: string;
  descripcion: string;
  cantidad_vendida: string;
  ingresos_totales: string;
  costo_total: string | null;
  utilidad_bruta: string | null;
  margen_porcentaje: string | null;
  costo_conocido: boolean;
}

export interface UtilidadProductoResponse {
  idProducto: number;
  codigo: string;
  descripcion: string;
  cantidadVendida: number;
  ingresosTotales: number;
  costoTotal: number | null;
  utilidadBruta: number | null;
  margenPorcentaje: number | null;
  costoConocido: boolean;
}
