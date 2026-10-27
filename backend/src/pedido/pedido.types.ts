export interface ProductRow {
  id: number;
  descripcion: string;
  existencia: string | number;
  tasa: string | number;
  objeto: string;
}

export interface DetailRow {
  idDetalle: number;
  idProducto: number;
  cantidad: string | number;
  reservada: string | number;
  surtida: string | number;
  descripcion: string;
}

export interface OrderRow {
  idPedido: number;
  estado: string;
  version: number;
}

export interface QuoteRow {
  idCliente: number;
  folio: string | number;
  estado: string;
}

export interface QuoteDetailRow {
  idProducto: number;
  descripcion: string;
  cantidad: string | number;
  valorUnitario: string | number;
  tasa: string | number;
  objeto: string;
}

export interface InvoiceOrderRow {
  id_pedido: number;
  estado: string;
  id_cliente: number;
  rfc: string;
  nombre: string;
  cp: string;
  idFormaPago: number | null;
  idMetodoPago: number | null;
  regimen: string;
  uso: string | null;
}

export interface InvoiceLineRow {
  idProducto: number;
  cantidad: string | number;
  valorUnitario: string | number;
  descripcion: string;
  codigo: string;
  objeto: string;
  tasa: string | number;
  retiene: boolean;
  claveProdServ: string | null;
  claveUnidad: string | null;
  unidad: string | null;
}

export interface ExpiredReservationRow {
  idReserva: number;
  idPedido: number;
  idDetalle: number;
  cantidadPendiente: string | number;
}
