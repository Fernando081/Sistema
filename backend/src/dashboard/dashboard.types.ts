export interface CategoriaVenta {
  categoria: string;
  ventas: number;
}

export interface HoraDiaVenta {
  dia: string;
  hora: number;
  ventas: number;
}

// 1. View: mv_ventas_facturacion
export interface MvVentasFacturacion {
  ingresos_brutos: string | number;
  ingresos_netos: string | number;
  ticket_promedio: string | number;
  margen_utilidad_bruta: string | number;
  descuento_promedio_otorgado: string | number;
  ventas_por_categoria: CategoriaVenta[];
  comportamiento_hora_dia: HoraDiaVenta[];
}

export interface LentoMovimiento {
  codigo: string;
  descripcion: string;
  dias_sin_ventas: number;
  existencia: number;
}

export interface HistoricoDato {
  mes: string;
  valor: number;
}

// 2. View: mv_inventario_almacen
export interface MvInventarioAlmacen {
  valor_total_inventario: string | number;
  merma_shrinkage: string | number;
  tasa_rotacion_inventario: string | number;
  indice_quiebre_stock: string | number;
  dias_inventario: string | number;
  costo_aterrizado: string | number;
  retorno_inversion_inventario: string | number;
  mercancia_lento_movimiento: LentoMovimiento[];
  shrinkage_historico_json: HistoricoDato[];
}

export interface AgingReport {
  rango: string;
  monto: string | number;
}

// 3. View: mv_clientes_cobranza
export interface MvClientesCobranza {
  tasa_retencion_clientes: string | number;
  valor_tiempo_vida: string | number;
  dias_cuentas_por_pagar: string | number;
  cuentas_por_cobrar: AgingReport[];
}

export interface RentabilidadProveedor {
  proveedor: string;
  marca: string;
  rentabilidad: string | number;
}

// 4. View: mv_operaciones_avanzadas
export interface MvOperacionesAvanzadas {
  tasa_conversion_cotizaciones: string | number;
  tasa_devoluciones: string | number;
  tasa_cumplimiento: string | number;
  indice_ventas_cruzadas: string | number;
  rentabilidad_proveedor_marca: RentabilidadProveedor[];
  tasa_de_devoluciones_historico: HistoricoDato[];
}
