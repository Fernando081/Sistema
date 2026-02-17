// frontend/src/app/services/cliente.service.ts

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { Cliente, CreateClienteDto, UpdateClienteDto } from '../cliente/cliente.interface';

// Explicit type matching the PascalCase keys returned by the API
export interface ClienteApiResponse {
  IdCliente: number;
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
  email?: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class ClienteService {

  private apiUrl = `${environment.apiBaseUrl}/cliente`;

  constructor(private http: HttpClient) { }

  // Fetch clientes and map from PascalCase API response to camelCase Cliente interface
  getClientes(): Observable<Cliente[]> {
    return this.http.get<ClienteApiResponse[]>(this.apiUrl).pipe(
      map(response => response.map(this.mapApiResponseToCliente))
    );
  }

  // Map PascalCase API response to camelCase Cliente
  private mapApiResponseToCliente(apiCliente: ClienteApiResponse): Cliente {
    return {
      idCliente: apiCliente.IdCliente,
      rfc: apiCliente.RFC,
      razonSocial: apiCliente.RazonSocial,
      pais: apiCliente.Pais,
      idEstado: apiCliente.IdEstado ?? 0,
      idMunicipio: apiCliente.IdMunicipio ?? 0,
      ciudad: apiCliente.Ciudad ?? '',
      colonia: apiCliente.Colonia ?? '',
      calle: apiCliente.Calle ?? '',
      codigoPostal: apiCliente.CodigoPostal,
      numeroExterior: apiCliente.NumeroExterior ?? '',
      numeroInterior: apiCliente.NumeroInterior ?? '',
      referencia: apiCliente.Referencia ?? '',
      idMetodoDePago: apiCliente.IdMetodoDePago ?? 0,
      idUsoCFDI: apiCliente.IdUsoCFDI ?? 0,
      idFormaPago: apiCliente.IdFormaPago ?? 0,
      idRegimenFiscal: apiCliente.IdRegimenFiscal,
      email: apiCliente.email
    };
  }

  getClienteById(id: number): Observable<Cliente> {
    return this.http.get<Cliente>(`${this.apiUrl}/${id}`);
  }

  createCliente(cliente: CreateClienteDto): Observable<Cliente> {
    return this.http.post<Cliente>(this.apiUrl, cliente);
  }

  updateCliente(id: number, cliente: UpdateClienteDto): Observable<Cliente> {
    return this.http.put<Cliente>(`${this.apiUrl}/${id}`, cliente);
  }

  deleteCliente(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
