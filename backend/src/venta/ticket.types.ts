export interface TicketConcepto {
  cantidad: number;
  clave_unidad: string;
  no_identificacion?: string;
  codigo?: string;
  descripcion: string;
  clave_prod_serv: string;
  precio: string | number;
  importe: string | number;
}

export interface TicketCliente {
  rfc: string;
  nombre?: string;
  regimen?: string;
  calle?: string;
  numero_exterior?: string;
  numero_interior?: string;
  colonia?: string;
  municipio?: string;
  ciudad?: string;
  estado?: string;
  cp?: string;
}

export interface DatosTicketFactura {
  total: string | number;
  moneda: string;
  fecha: string;
  folio: string;
  serie?: string;
  uso_cfdi?: string;
  cliente: TicketCliente;
  conceptos: TicketConcepto[];
  forma_pago: string;
  metodo_pago: string;
  subtotal: string | number;
  iva: string | number;
  retenciones: string | number;
}

export interface TicketQueryResult {
  datos: DatosTicketFactura;
}
