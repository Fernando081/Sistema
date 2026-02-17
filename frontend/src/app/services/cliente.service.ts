// frontend/src/app/services/cliente.service.ts

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { Cliente, CreateClienteDto, UpdateClienteDto } from '../cliente/cliente.interface';

// Tipo explícito para la respuesta de la API con campos en PascalCase
export interface ClienteApiResponseRaw {
  IdCliente: number;
  RFC: string;
  RazonSocial: string;
  Pais: string;
  IdEstado: number;
  IdMunicipio: number;
  Ciudad: string;
  Colonia: string;
  Calle: string;
  CodigoPostal: string;
  NumeroExterior: string;
  NumeroInterior: string;
  Referencia: string;
  IdMetodoDePago: number;
  IdUsoCFDI: number;
  IdFormaPago: number;
  IdRegimenFiscal: number;
  Email?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ClienteService {

  private apiUrl = `${environment.apiBaseUrl}/cliente`;

  constructor(private http: HttpClient) { }

  // La API entrega campos en PascalCase; convertimos a camelCase aquí para type-safety
  getClientes(): Observable<Cliente[]> {
    return this.http.get<ClienteApiResponseRaw[]>(this.apiUrl).pipe(
      map(data => data.map(c => ({
        idCliente: c.IdCliente,
        rfc: c.RFC,
        razonSocial: c.RazonSocial,
        pais: c.Pais,
        idEstado: c.IdEstado,
        idMunicipio: c.IdMunicipio,
        ciudad: c.Ciudad,
        colonia: c.Colonia,
        calle: c.Calle,
        codigoPostal: c.CodigoPostal,
        numeroExterior: c.NumeroExterior,
        numeroInterior: c.NumeroInterior,
        referencia: c.Referencia,
        idMetodoDePago: c.IdMetodoDePago,
        idUsoCFDI: c.IdUsoCFDI,
        idFormaPago: c.IdFormaPago,
        idRegimenFiscal: c.IdRegimenFiscal,
        email: c.Email
      })))
    );
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
