import { CompraResumen } from '../compra/compra.interface';

/** H02-b: "Nueva compra" registra orden, recepción, factura de proveedor aprobada y, si es de contado, el pago. */
export interface CompraResultado {
  message: string;
  idOrden: number;
  folioOrden: string;
  idRecepcion: number;
  idFacturaProveedor: number;
  idPago: number | null;
}

export interface CompraPagina {
  data: CompraResumen[];
  total: number;
  page: number;
  totalPages: number;
}
