export interface IdRow {
  id: number;
}

export interface OrderRow {
  idProveedor: number;
  estado: string;
  moneda: string;
  tipoCambio: number | string;
}

export interface OrderLineRow {
  idDetalle: number;
  idProducto: number;
  cantidad: number | string;
  costo: number | string;
  tasaIva: number | string;
}

export interface InvoiceRow {
  idFactura: number;
  idProveedor: number;
  saldo: number | string;
  total: number | string;
  estado: string;
  tipoCambio: number | string;
}

export interface ReceiptAvailableRow {
  idRecepcionDetalle: number;
  disponible: number | string;
}
