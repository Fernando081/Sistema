// frontend/src/app/services/cliente.service.ts

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { Cliente, CreateClienteDto, UpdateClienteDto } from '../cliente/cliente.interface';

// Backend returns PascalCase fields from PostgreSQL
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
  email: string | null; // lowercase per backend entity
}

@Injectable({
  providedIn: 'root'
})
export class ClienteService {

  private apiUrl = `${environment.apiBaseUrl}/cliente`;

  constructor(private http: HttpClient) { }

  // Transform API response (PascalCase) to domain model (camelCase)
  private mapApiResponseToCliente(apiResponse: ClienteApiResponse): Cliente {
    return {
      idCliente: apiResponse.IdCliente,
      rfc: apiResponse.RFC,
      razonSocial: apiResponse.RazonSocial,
      pais: apiResponse.Pais,
      idEstado: apiResponse.IdEstado ?? 0,
      idMunicipio: apiResponse.IdMunicipio ?? 0,
      ciudad: apiResponse.Ciudad ?? '',
      colonia: apiResponse.Colonia ?? '',
      calle: apiResponse.Calle ?? '',
      codigoPostal: apiResponse.CodigoPostal,
      numeroExterior: apiResponse.NumeroExterior ?? '',
      numeroInterior: apiResponse.NumeroInterior ?? '',
      referencia: apiResponse.Referencia ?? '',
      idMetodoDePago: apiResponse.IdMetodoDePago ?? 0,
      idUsoCFDI: apiResponse.IdUsoCFDI ?? 0,
      idFormaPago: apiResponse.IdFormaPago ?? 0,
      idRegimenFiscal: apiResponse.IdRegimenFiscal,
      email: apiResponse.email,
    };
  }

  getClientes(): Observable<Cliente[]> {
    return this.http.get<ClienteApiResponse[]>(this.apiUrl).pipe(
      map(responses => responses.map(r => this.mapApiResponseToCliente(r)))
    );
  }

  getClienteById(id: number): Observable<Cliente> {
    return this.http.get<ClienteApiResponse>(`${this.apiUrl}/${id}`).pipe(
      map(r => this.mapApiResponseToCliente(r))
    );
  }

  createCliente(cliente: CreateClienteDto): Observable<Cliente> {
    return this.http.post<ClienteApiResponse>(this.apiUrl, cliente).pipe(
      map(r => this.mapApiResponseToCliente(r))
    );
  }

  updateCliente(id: number, cliente: UpdateClienteDto): Observable<Cliente> {
    return this.http.put<ClienteApiResponse>(`${this.apiUrl}/${id}`, cliente).pipe(
      map(r => this.mapApiResponseToCliente(r))
    );
  }

  deleteCliente(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
