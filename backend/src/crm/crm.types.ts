export interface OportunidadDbRow {
  id_oportunidad: number;
  id_cliente: number | null;
  empresa: string;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  tipo_cliente: string;
  etapa: string;
  monto_estimado: string | number;
  siguiente_accion: string | null;
  fecha_siguiente_accion: string | null;
  motivo_perdida: string | null;
  version: number;
}

export interface TotalRow {
  total: number;
}

export interface IdOportunidadRow {
  idOportunidad: number;
}

export interface IdSeguimientoRow {
  idSeguimiento: number;
}

export interface IdVentaPerdidaRow {
  idVentaPerdida: number;
}

export interface IdUnidadRow {
  idUnidad: number;
}

export interface UnidadDbRow {
  id_unidad: number;
  id_cliente: number | null;
  id_oportunidad: number | null;
  vin: string | null;
  esn: string | null;
  numero_economico: string | null;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  motor: string | null;
  notas: string | null;
}
