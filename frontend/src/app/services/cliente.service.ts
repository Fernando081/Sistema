// frontend/src/app/services/cliente.service.ts

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { Cliente, CreateClienteDto, UpdateClienteDto } from '../cliente/cliente.interface';

import type { DirectoryQuery, DirectoryPage } from '../shared/remote-directory';

export interface ClienteContacto { idContacto: number; nombre: string; cargo?: string | null; telefono?: string | null; email?: string | null; canalPreferido: string; esPrincipal: boolean; notas?: string | null; }
export interface ClienteUnidad360 { idUnidad: number; vin?: string | null; esn?: string | null; numeroEconomico?: string | null; marca?: string | null; modelo?: string | null; anio?: number | null; motor?: string | null; transmision?: string | null; diferencial?: string | null; placas?: string | null; notas?: string | null; }
export interface ClienteCotizacion360 { idCotizacion: number; folio: number; estatus: string; total: number; idUnidad?: number | null; }
export interface ClientePedido360 { idPedido: number; folio: number; estado: string; total: number; idUnidad?: number | null; createdAt: string; }
export interface ClienteFactura360 { idFactura: number; serie: string; folio: number; fechaEmision: string; estatus: string; total: number; saldoPendiente: number; idUnidad?: number | null; }
export interface ClienteGarantia360 { idGarantia: number; estado: string; motivo: string; cantidad: number; createdAt: string; factura: string; producto: string; }
export interface ClienteOportunidad360 { idOportunidad: number; empresa: string; etapa: string; montoEstimado: number; siguienteAccion?: string | null; fechaSiguienteAccion?: string | null; }
export interface Cliente360 {
  cliente: Cliente;
  resumen: { saldoPendiente: number; ventasAcumuladas: number; unidades: number; pedidosAbiertos: number; garantiasAbiertas: number };
  contactos: ClienteContacto[];
  unidades: ClienteUnidad360[];
  cotizaciones: ClienteCotizacion360[];
  pedidos: ClientePedido360[];
  facturas: ClienteFactura360[];
  garantias: ClienteGarantia360[];
  oportunidades: ClienteOportunidad360[];
}

interface ClienteApiResponse {
  IdCliente?: number;
  RFC?: string;
  RazonSocial?: string;
  Pais?: string;
  IdEstado?: number;
  IdMunicipio?: number;
  Ciudad?: string;
  Colonia?: string;
  Calle?: string;
  CodigoPostal?: string;
  NumeroExterior?: string;
  NumeroInterior?: string;
  Referencia?: string;
  IdMetodoDePago?: number;
  IdUsoCFDI?: number;
  IdFormaPago?: number;
  IdRegimenFiscal?: number;
  email?: string | null;
  saldo_a_favor?: string | number;
}

@Injectable({
  providedIn: 'root'
})
export class ClienteService {

  private apiUrl = `${environment.apiBaseUrl}/cliente`;

  constructor(private http: HttpClient) { }

  getClientes(): Observable<Cliente[]> {
    return this.http.get<ClienteApiResponse[]>(this.apiUrl).pipe(
      map((clientes) => clientes.map((cliente) => this.toCliente(cliente))),
    );
  }

  getPage(query: DirectoryQuery): Observable<DirectoryPage<Cliente>> {
    return this.http.get<DirectoryPage<ClienteApiResponse>>(`${this.apiUrl}/pagina`, { params: { ...query } }).pipe(
      map(page => ({ ...page, data: page.data.map(row => this.toCliente(row)) })),
    );
  }
  exportCsv(query: DirectoryQuery): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/exportar`, { params: { ...query }, responseType: 'blob' });
  }
  getClienteById(id: number): Observable<Cliente> {
    return this.http.get<ClienteApiResponse>(`${this.apiUrl}/${id}`).pipe(
      map((cliente) => this.toCliente(cliente)),
    );
  }

  getCliente360(id: number): Observable<Cliente360> {
    return this.http.get<Omit<Cliente360, 'cliente'> & { cliente: ClienteApiResponse }>(`${this.apiUrl}/${id}/360`).pipe(
      map((result) => ({ ...result, cliente: this.toCliente(result.cliente) })),
    );
  }

  addContacto(id: number, contacto: Omit<ClienteContacto, 'idContacto'>) {
    return this.http.post<{ idContacto: number }>(`${this.apiUrl}/${id}/contactos`, contacto);
  }

  deleteContacto(id: number, idContacto: number) {
    return this.http.delete(`${this.apiUrl}/${id}/contactos/${idContacto}`);
  }

  createCliente(cliente: CreateClienteDto): Observable<Cliente> {
    return this.http.post<ClienteApiResponse>(this.apiUrl, cliente).pipe(
      map((result) => this.toCliente(result)),
    );
  }

  updateCliente(id: number, cliente: UpdateClienteDto): Observable<Cliente> {
    return this.http.put<ClienteApiResponse>(`${this.apiUrl}/${id}`, cliente).pipe(
      map((result) => this.toCliente(result)),
    );
  }

  deleteCliente(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  private toCliente(apiCliente: ClienteApiResponse): Cliente {
    return {
      idCliente: Number(apiCliente.IdCliente || 0),
      rfc: apiCliente.RFC || '',
      razonSocial: apiCliente.RazonSocial || '',
      pais: apiCliente.Pais || '',
      idEstado: Number(apiCliente.IdEstado || 0),
      idMunicipio: Number(apiCliente.IdMunicipio || 0),
      ciudad: apiCliente.Ciudad || '',
      colonia: apiCliente.Colonia || '',
      calle: apiCliente.Calle || '',
      codigoPostal: apiCliente.CodigoPostal || '',
      numeroExterior: apiCliente.NumeroExterior || '',
      numeroInterior: apiCliente.NumeroInterior || '',
      referencia: apiCliente.Referencia || '',
      idMetodoDePago: Number(apiCliente.IdMetodoDePago || 0),
      idUsoCFDI: Number(apiCliente.IdUsoCFDI || 0),
      idFormaPago: Number(apiCliente.IdFormaPago || 0),
      idRegimenFiscal: Number(apiCliente.IdRegimenFiscal || 0),
      email: apiCliente.email ?? null,
      saldoAFavor: Number(apiCliente.saldo_a_favor || 0),
    };
  }
}
