export interface FacturaSaldoRow {
  saldo_pendiente: number | string;
  estatus: string;
}

export interface PagoIdRow {
  id_pago: number;
}

export interface RepIdRow {
  id_rep: number;
}

export interface FacturaRepRow {
  saldo_pendiente: number | string;
  id_cliente: number;
  estatus: string;
  moneda: string;
  metodo_clave: string;
  nueva_parcialidad: number | string;
}

export interface RepEstadoRow {
  estado: string;
}

export interface FacturaPagadaRow {
  id_factura: number;
  monto_pagado: number | string;
  estatus: string;
  saldo_pendiente: number | string;
  total: number | string;
  tiene_devolucion: boolean;
  tiene_nota: boolean;
}

export interface RepInfoRow {
  id_rep: number;
  uuid: string | null;
  no_certificado_emisor: string | null;
  no_serie_certificado: string | null;
  fecha_emision: string | Date;
  fecha_pago: string | Date;
  forma_pago: string;
  moneda: string;
  cuenta_beneficiario: string | null;
  monto_total: number | string;
  cliente_nombre: string;
  cliente_rfc: string;
  cliente_cp: string | null;
  cadena_original: string | null;
  sello_sat: string | null;
  sello_cfdi: string | null;
  lugar_emision: string | null;
}

export interface RepFacturaRow {
  uuid_factura: string | null;
  serie: string;
  folio: string | number;
  num_parcialidad: number;
  saldo_anterior: number | string;
  monto_pagado: number | string;
  saldo_insoluto: number | string;
  total_factura: number | string;
  subtotal_factura: number | string;
  iva_factura: number | string;
  isr_factura: number | string;
}

export interface RepFiscalPdfRow {
  ambiente: string;
  estado: string;
  fecha_timbrado: Date | string | null;
}
