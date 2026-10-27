export interface IdempotencyRow {
  response: Record<string, unknown>;
  payload_hash: string;
}

export interface FacturaRow {
  id_factura: number;
  id_cliente: number;
  tipo_comprobante: string;
  estatus: string;
  serie: string;
  id_factura_global: number | null;
  saldo_pendiente: number | string;
  moneda: string;
}

export interface ProductoVentaRow {
  id: number;
  existencia: number | string;
  disponible?: number | string;
  pedido_reservado?: number | string;
  objeto_impuesto: string;
  tasa_iva: number | string;
  retiene_isr: boolean;
}

export interface LineaOrigenRow {
  id_producto: number;
  cantidad: number | string;
  neto: number | string;
  iva: number | string;
  retencion: number | string;
  devuelto: number | string;
}

export interface FolioRow {
  next_folio: number | string;
}

export interface FacturaIdRow {
  id_factura: number;
}

export interface GastoIdRow {
  id_gasto: number;
}

export interface CountRow {
  count: string | number;
}

export interface FiscalStatusRow {
  id_factura: number;
  estado_fiscal: string;
}

export interface PdfFiscalRow {
  ambiente: string;
  estado: string;
  uuid: string | null;
  fecha_timbrado: Date | string | null;
  no_certificado_cfdi: string | null;
  no_certificado_sat: string | null;
  sello_cfdi: string | null;
  sello_sat: string | null;
  cadena_original_sat: string | null;
}

export interface EmailFacturaRow {
  destinatario: string;
  asunto: string;
  cuerpo_mensaje: string;
  nombre_archivo: string;
}

export interface DevolucionIdRow {
  id_devolucion: number | string;
}

export interface TicketResumenRow {
  idFactura: number;
  subtotal: number | string;
  totalImpuestosTrasladados: number | string;
  totalImpuestosRetenidos: number | string;
  total: number | string;
  [key: string]: unknown;
}

export interface TicketGlobalRow {
  id_factura: number;
  subtotal: number | string;
  total_impuestos_trasladados: number | string;
  total_impuestos_retenidos: number | string;
  total: number | string;
  [key: string]: unknown;
}

export interface ClienteGenericoRow {
  IdCliente: number;
  RFC: string;
  RazonSocial: string;
  CodigoPostal: string;
  IdFormaPago: number | null;
  IdMetodoDePago: number | null;
}
