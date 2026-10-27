export interface FacturaPendiente {
 id_factura: number; id_cliente: number; serie: string; folio: number | string; fecha_emision: string; total: number | string; saldo_pendiente: number | string; cliente_nombre: string;
}
export interface RepHistorial {
 id_rep: number; id_cliente: number; fecha_pago: string; fecha_emision: string; forma_pago: string; moneda: string; monto_total: number | string; estado: string; uuid: string | null; cliente_nombre: string; estado_fiscal: string; tiene_xml_fiscal: boolean; tiene_acuse: boolean; error_fiscal: string | null;
}
export interface PagoRegistrado { message: string; idPago: number; }
export interface RepRegistrado { message: string; idRep: number; }
export interface RepCancelacion { message: string; idRep?: number; fiscal: boolean; cancelled: boolean; state: string; }
