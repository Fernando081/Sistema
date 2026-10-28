// frontend/src/app/compra/compra.interface.ts
export interface DetalleCompra {
  idProducto: number;
  descripcion: string;
  codigo: string;
  cantidad: number;
  costoUnitario: number;
  importe: number;
  /** Tasa de IVA del renglón: 0.16, 0.08 o 0 (exento/0 %). El costo se captura sin IVA. */
  tasaIva: number;
}

export interface CreateCompra {
  requestId?: string;
  idProveedor: number;
  folioFactura?: string;
  esCredito: boolean; // <--- Nuevo campo
  formaPago?: string;
  total: number;
  observaciones?: string;
  conceptos: DetalleCompra[];
}

export interface CompraResumen {
  id_compra: number;
  fecha_compra: string;
  folio_factura: string;
  total: number | string;
  estatus: string;
  nombre_proveedor: string;
  rfc_proveedor: string;
  /** H02-b: 'compra' = registro anterior; 'orden' = compra directa registrada como orden, recepción y factura. */
  fuente?: 'compra' | 'orden';
}

export interface DetalleCompraDb {
  cantidad: number | string;
  descripcion: string;
  codigo: string;
  costo_unitario: number | string;
  importe: number | string;
}
