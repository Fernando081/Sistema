import { Proveedor } from '../proveedor/proveedor.interface';

export interface ProveedorDb {
  IdProveedor: number;
  RFC: string;
  RazonSocial: string;
  Pais: string;
  IdEstado: number | null;
  IdMunicipio: number | null;
  Ciudad: string | null;
  Colonia: string | null;
  Calle: string | null;
  CodigoPostal: string;
  NumeroExterior: string | null;
  NumeroInterior: string | null;
  Referencia: string | null;
  IdMetodoDePago: number | null;
  IdUsoCFDI: number | null;
  IdFormaPago: number | null;
  IdRegimenFiscal: number;
  DiasCredito?: number | null;
}

export function mapProveedor(row: ProveedorDb): Proveedor {
  return {
    idProveedor: row.IdProveedor, rfc: row.RFC, razonSocial: row.RazonSocial,
    pais: row.Pais, idEstado: row.IdEstado, idMunicipio: row.IdMunicipio,
    ciudad: row.Ciudad ?? '', colonia: row.Colonia ?? '', calle: row.Calle ?? '',
    codigoPostal: row.CodigoPostal, numeroExterior: row.NumeroExterior ?? '',
    numeroInterior: row.NumeroInterior ?? '', referencia: row.Referencia ?? '',
    idMetodoDePago: row.IdMetodoDePago, idUsoCFDI: row.IdUsoCFDI,
    idFormaPago: row.IdFormaPago, idRegimenFiscal: row.IdRegimenFiscal,
    diasCredito: row.DiasCredito ?? 30,
  };
}
