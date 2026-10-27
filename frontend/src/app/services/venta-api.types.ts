import { FacturaResumen } from '../venta/venta.interface';
export interface ComisionSemanas {
  semana: string;
  id_vendedor: number;
  vendedor_nombre: string;
  ventas_realizadas: number;
  total_ventas_brutas: string;
  comisiones_acumuladas: string;
}
export interface PendingTicket {
  idFactura: number;
  serie: string;
  folio: number;
  fechaEmision: string;
  rfcReceptor: string;
  nombreReceptor: string;
  subtotal: number;
  totalImpuestosTrasladados: number;
  totalImpuestosRetenidos: number;
  total: number;
}
export interface VentaResultado { message: string; idFactura: number; }
export interface MensajeResultado { message: string; }
export interface FacturaPagina { data: FacturaResumen[]; total: number; page: number; totalPages: number; }
export interface CancelacionVenta { message: string; fiscal: boolean; cancelled: boolean; state: string; }
export interface TicketsGlobales { tickets: PendingTicket[]; totales: { subtotal: number; totalImpuestosTrasladados: number; totalImpuestosRetenidos: number; total: number; }; }
