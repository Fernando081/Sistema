// Contratos SQL de los catálogos; conservan nombres de columnas de la API existente.
export interface ClaveProdServRow {
  IdClaveProdOServ: number;
  Clave: string;
  Descripcion: string;
}

export interface ClaveUnidadRow {
  IdClaveUnidad: number;
  Clave: string;
  Descripcion: string;
}

export interface EstadoRow {
  IdEstado: number;
  Nombre: string;
  Clave: string | null;
}

export interface FormaPagoRow {
  IdFormaPago: number;
  Clave: string;
  Nombre: string;
}

export interface MetodoPagoRow {
  IdMetodoDePago: number;
  Clave: string;
  Nombre: string;
}

export interface MunicipioRow {
  IdMunicipio: number;
  Nombre: string;
  Clave: string | null;
  ClaveEstado: string | null;
}

export interface RegimenFiscalRow {
  IdRegimenFiscal: number;
  Clave: string;
  Nombre: string;
}

export interface UsoCfdiRow {
  IdUsoCFDI: number;
  Clave: string;
  Nombre: string;
}
