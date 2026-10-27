import { CompraResumen } from '../compra/compra.interface';

export interface CompraResultado {
  message: string;
  idCompra: number;
  backordersAsignados: number;
}

export interface CompraPagina {
  data: CompraResumen[];
  total: number;
  page: number;
  totalPages: number;
}
