import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type EtapaOportunidad = 'Prospecto' | 'Contactado' | 'Cotizando' | 'Negociacion' | 'Ganada' | 'Perdida';
export const ETAPAS_CRM: EtapaOportunidad[] = ['Prospecto', 'Contactado', 'Cotizando', 'Negociacion', 'Ganada', 'Perdida'];
export const MOTIVOS_CRM = ['Sin existencia', 'Precio', 'Entrega', 'Compatibilidad', 'Otro'];
export interface CrmPage<T> { data: T[]; total: number; page: number; limit: number; }
export interface Oportunidad {
  idOportunidad: number;
  idCliente?: number | null;
  empresa: string;
  contacto?: string | null;
  telefono?: string | null;
  email?: string | null;
  tipoCliente: string;
  etapa: EtapaOportunidad;
  montoEstimado: number;
  siguienteAccion?: string | null;
  fechaSiguienteAccion?: string | null;
  motivoPerdida?: string | null;
  responsable?: string;
  version: number;
  updatedAt: string;
}
export type OportunidadDto = Pick<Oportunidad, 'idCliente' | 'empresa' | 'contacto' | 'telefono' | 'email' | 'tipoCliente' | 'etapa' | 'montoEstimado' | 'siguienteAccion' | 'fechaSiguienteAccion' | 'motivoPerdida'>;
export interface Seguimiento { idSeguimiento: number; tipo: string; detalle: string; username?: string; createdAt: string; }
export interface SeguimientoDto { tipo: string; detalle: string; completarAccion?: boolean; expectedVersion: number; }
export interface VentaPerdidaDto { descripcionBuscada: string; cantidad: number; motivo: string; notas?: string; idOportunidad?: number; idProducto?: number; }
export interface VentaPerdida extends VentaPerdidaDto { idVentaPerdida: number; createdAt: string; empresa?: string; responsable?: string; codigoProducto?: string; }
export interface CrmResumen { abiertas: number; montoAbierto: number; vencidas: number; ganadas: number; perdidas: number; ventasPerdidas30Dias: number; }
export interface GlobalSearchItem { id: number; titulo: string; codigo?: string; subtitulo?: string; existencia?: number; precio?: number; cliente?: string; }
export interface GlobalSearchResult { productos: GlobalSearchItem[]; clientes: GlobalSearchItem[]; unidades: GlobalSearchItem[]; }
export interface UnidadCliente {
  idUnidad: number;
  idCliente?: number | null;
  idOportunidad?: number | null;
  vin?: string | null;
  esn?: string | null;
  numeroEconomico?: string | null;
  marca?: string | null;
  modelo?: string | null;
  anio?: number | null;
  motor?: string | null;
  notas?: string | null;
  createdAt: string;
  updatedAt: string;
}
export type UnidadClienteDto = Omit<UnidadCliente, 'idUnidad' | 'idCliente' | 'idOportunidad' | 'createdAt' | 'updatedAt'>;
export interface CrmSegmento { idSegmento:number;nombre:string;descripcion?:string;tipoCliente?:string;diasInactivo?:number;clientes:number; }
export interface CrmPlantilla { idPlantilla:number;nombre:string;canal:string;asunto?:string;contenido:string; }
export interface CrmCampana { idCampana:number;nombre:string;estado:string;fechaInicio?:string;fechaFin?:string;objetivo?:string;segmento?:string;plantilla?:string;canal?:string; }
export interface CrmEncuesta { idEncuesta:number;calificacion:number;comentario?:string;createdAt:string;cliente?:string;empresa?:string; }
export interface CrmMeta { idMeta:number;idUser:number;username:string;fechaInicio:string;fechaFin:string;montoObjetivo:number;oportunidadesObjetivo:number;montoLogrado:number;oportunidadesLogradas:number; }
export type CrmTaskStatus = 'Pendiente'|'En progreso'|'Completada'|'Cancelada';
export interface CrmTarea { idTarea:number;idSecuencia?:string|null;estadoSecuencia?:string|null;pasoSecuencia?:number|null;titulo:string;descripcion?:string;prioridad:'Baja'|'Media'|'Alta'|'Urgente';estado:CrmTaskStatus;fechaVencimiento:string;idResponsable:number;responsable:string;idCliente?:number;cliente?:string;idOportunidad?:number;empresa?:string;idUnidad?:number;vin?:string;esn?:string;idCotizacion?:number;idPedido?:number;version:number;createdAt:string; }
export interface CrmComunicacion { idComunicacion:number;canal:string;direccion:string;resumen:string;fecha:string;idCliente?:number;cliente?:string;idOportunidad?:number;empresa?:string;username?:string; }

@Injectable({ providedIn: 'root' })
export class CrmService {
  private readonly api = `${environment.apiBaseUrl}/crm`;
  constructor(private readonly http: HttpClient) {}

  getOportunidades(filters: Record<string, string | number> = {}): Observable<CrmPage<Oportunidad>> {
    return this.http.get<CrmPage<Oportunidad>>(`${this.api}/oportunidades`, { params: this.params(filters) });
  }
  getOportunidad(id: number) { return this.http.get<Oportunidad>(`${this.api}/oportunidades/${id}`); }
  getConsultaWeb(id: number) { return this.http.get<{ requestId: string; piezas: {code:string;brand?:string;quantity:number;application?:string}[] } | null>(`${this.api}/oportunidades/${id}/consulta-web`); }
  getResumen() { return this.http.get<CrmResumen>(`${this.api}/resumen`); }
  buscarGlobal(q: string) { return this.http.get<GlobalSearchResult>(`${this.api}/busqueda`, { params: { q } }); }
  crearOportunidad(dto: OportunidadDto) {
    return this.http.post<{ idOportunidad: number }>(`${this.api}/oportunidades`, dto);
  }
  actualizarOportunidad(id: number, dto: Partial<OportunidadDto> & { expectedVersion: number }) {
    return this.http.patch<{ version: number }>(`${this.api}/oportunidades/${id}`, dto);
  }
  agregarSeguimiento(id: number, dto: SeguimientoDto) {
    return this.http.post(`${this.api}/oportunidades/${id}/seguimientos`, dto);
  }
  getSeguimientos(id: number, page = 1) {
    return this.http.get<CrmPage<Seguimiento>>(`${this.api}/oportunidades/${id}/seguimientos`, { params: { page, limit: 10 } });
  }
  getVentasPerdidas(filters: Record<string, string | number> = {}) {
    return this.http.get<CrmPage<VentaPerdida>>(`${this.api}/ventas-perdidas`, { params: this.params(filters) });
  }
  registrarVentaPerdida(dto: VentaPerdidaDto) { return this.http.post(`${this.api}/ventas-perdidas`, dto); }
  getUnidades(idOportunidad: number) {
    return this.http.get<UnidadCliente[]>(`${this.api}/oportunidades/${idOportunidad}/unidades`);
  }
  getUnidadesCliente(idCliente: number) {
    return this.http.get<UnidadCliente[]>(`${this.api}/clientes/${idCliente}/unidades`);
  }
  crearUnidadCliente(idCliente: number, dto: UnidadClienteDto) {
    return this.http.post<{ idUnidad: number }>(`${this.api}/clientes/${idCliente}/unidades`, dto);
  }
  crearUnidad(idOportunidad: number, dto: UnidadClienteDto) {
    return this.http.post<{ idUnidad: number }>(`${this.api}/oportunidades/${idOportunidad}/unidades`, dto);
  }
  actualizarUnidad(idUnidad: number, dto: UnidadClienteDto) {
    return this.http.patch(`${this.api}/unidades/${idUnidad}`, dto);
  }
  eliminarUnidad(idUnidad: number) { return this.http.delete(`${this.api}/unidades/${idUnidad}`); }
  segmentos() { return this.http.get<CrmSegmento[]>(`${this.api}/segmentos`); }
  crearSegmento(dto:unknown) { return this.http.post(`${this.api}/segmentos`,dto); }
  plantillas() { return this.http.get<CrmPlantilla[]>(`${this.api}/plantillas`); }
  crearPlantilla(dto:unknown) { return this.http.post(`${this.api}/plantillas`,dto); }
  campanas() { return this.http.get<CrmCampana[]>(`${this.api}/campanas`); }
  crearCampana(dto:unknown) { return this.http.post(`${this.api}/campanas`,dto); }
  encuestas() { return this.http.get<CrmEncuesta[]>(`${this.api}/encuestas`); }
  crearEncuesta(dto:unknown) { return this.http.post(`${this.api}/encuestas`,dto); }
  metas() { return this.http.get<CrmMeta[]>(`${this.api}/metas`); }
  crearMeta(dto:unknown) { return this.http.post(`${this.api}/metas`,dto); }
  tareas(filters:Record<string,string|number>={}) { return this.http.get<CrmTarea[]>(`${this.api}/tareas`,{params:this.params(filters)}); }
  crearTarea(dto:unknown) { return this.http.post(`${this.api}/tareas`,dto); }
  actualizarTarea(id:number,dto:unknown) { return this.http.patch(`${this.api}/tareas/${id}`,dto); }
  comunicaciones(filters:{idCliente?:number;idOportunidad?:number}) { return this.http.get<CrmComunicacion[]>(`${this.api}/comunicaciones`,{params:this.params(filters as Record<string,number>)}); }
  crearComunicacion(dto:unknown) { return this.http.post(`${this.api}/comunicaciones`,dto); }
  private params(filters: Record<string, string | number>): HttpParams {
    let result = new HttpParams();
    for (const [name, value] of Object.entries(filters)) {
      if (value !== '') result = result.set(name, value);
    }
    return result;
  }
}
