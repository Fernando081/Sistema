// frontend/src/app/venta/venta.interface.ts
export interface ConceptoVenta {
  // Identificadores
  idProducto: number;
  
  // Datos descriptivos (Snapshot)
  codigo: string;
  descripcion: string;
  unidadDescripcion: string;
  claveProdServ: string;
  claveUnidad: string;
  objetoImpuesto: string;

  // Matemáticas
  cantidad: number;
  valorUnitario: number; // Precio sin IVA
  importe: number;       // Cantidad * ValorUnitario
  descuento: number;

  // Impuestos
  baseIva: number;
  tasaIva: number;
  importeIva: number;

  baseRetIsr: number;
  tasaRetIsr: number;
  importeRetIsr: number; // Será 0 si el cliente es Física
}

export interface Venta {
  idCliente: number;
  rfcReceptor: string;
  nombreReceptor: string;
  cpReceptor: string;
  regimenReceptor: string;
  usoCfdi: string;

  idFormaPago: number;
  idMetodoPago: number;
  moneda: string;
  tipoCambio: number;

  subtotal: number;
  totalImpuestosTrasladados: number;
  totalImpuestosRetenidos: number;
  total: number;

  conceptos: ConceptoVenta[];
}

export interface FacturaResumen {
  id_factura: number;
  serie: string;
  folio: number;
  fecha_emision: string; // Viene como string ISO desde Postgres
  nombre_receptor: string;
  rfc_receptor: string;
  total: number;
  estatus: string; // 'Pendiente', 'Timbrada', etc.
  uuid?: string;
}