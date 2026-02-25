// frontend/src/app/compra/compra.interface.ts
export interface DetalleCompra {
  idProducto: number;
  descripcion: string;
  codigo: string;
  cantidad: number;
  costoUnitario: number;
  importe: number;
}

export interface CreateCompra {
  idProveedor: number;
  folioFactura?: string;
  esCredito: boolean; // <--- Nuevo campo
  total: number;
  observaciones?: string;
  conceptos: DetalleCompra[];
}

export interface CompraResumen {
  id_compra: number;
  fecha_compra: string;
  folio_factura: string;
  total: number;
  estatus: string;
  nombre_proveedor: string;
  rfc_proveedor: string;
}