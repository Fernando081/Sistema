// frontend/src/app/services/cliente.service.ts

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Cliente, CreateClienteDto, UpdateClienteDto } from '../cliente/cliente.interface';

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
  Email?: string | null;
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

  getClienteById(id: number): Observable<Cliente> {
    return this.http.get<ClienteApiResponse>(`${this.apiUrl}/${id}`).pipe(
      map((cliente) => this.toCliente(cliente)),
    );
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
      email: apiCliente.Email ?? null,
    };
  }
}
