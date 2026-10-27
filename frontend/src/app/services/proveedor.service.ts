// frontend/src/app/services/proveedor.service.ts (REEMPLAZAR)

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { ProveedorDb, mapProveedor } from './proveedor-api.types';
import { environment } from '../../environments/environment';
import { Proveedor, CreateProveedorDto, UpdateProveedorDto } from '../proveedor/proveedor.interface';

import type { DirectoryQuery, DirectoryPage } from '../shared/remote-directory';

@Injectable({
  providedIn: 'root'
})
export class ProveedorService {
  // La URL base se configura a través de environment.apiBaseUrl
  private apiUrl = `${environment.apiBaseUrl}/proveedores`;

  constructor(private http: HttpClient) { }

  getProveedores(): Observable<Proveedor[]> {
    return this.http.get<ProveedorDb[]>(this.apiUrl).pipe(map(rows => rows.map(mapProveedor)));
  }
  
  getPage(query: DirectoryQuery): Observable<DirectoryPage<Proveedor>> {
    return this.http.get<DirectoryPage<ProveedorDb>>(`${this.apiUrl}/pagina`, { params: { ...query } }).pipe(
      map(page => ({ ...page, data: page.data.map(mapProveedor) })),
    );
  }
  exportCsv(query: DirectoryQuery): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/exportar`, { params: { ...query }, responseType: 'blob' });
  }
  getProveedorById(id: number): Observable<Proveedor> {
    return this.http.get<ProveedorDb>(`${this.apiUrl}/${id}`).pipe(map(mapProveedor));
  }

  createProveedor(proveedor: CreateProveedorDto): Observable<Proveedor> {
    return this.http.post<ProveedorDb>(this.apiUrl, proveedor).pipe(map(mapProveedor));
  }

  updateProveedor(id: number, proveedor: UpdateProveedorDto): Observable<Proveedor> {
    return this.http.put<ProveedorDb>(`${this.apiUrl}/${id}`, proveedor).pipe(map(mapProveedor));
  }

  deleteProveedor(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}