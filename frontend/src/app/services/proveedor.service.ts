// frontend/src/app/services/proveedor.service.ts (REEMPLAZAR)

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Proveedor, CreateProveedorDto, UpdateProveedorDto } from '../proveedor/proveedor.interface';

@Injectable({
  providedIn: 'root'
})
export class ProveedorService {
  // -------------------------------------------------
  // ¡URL DE PRODUCCIÓN!
  // Reemplaza esto con tu URL pública de Codespaces (puerto 3000)
  // si aún estás en desarrollo.
  // -------------------------------------------------
  private apiUrl = `${environment.apiBaseUrl}/proveedores`;

  constructor(private http: HttpClient) { }

  getProveedores(): Observable<any[]> { // Devuelve any[] para el mapeo
    return this.http.get<any[]>(this.apiUrl);
  }
  
  getProveedorById(id: number): Observable<Proveedor> {
    return this.http.get<Proveedor>(`${this.apiUrl}/${id}`);
  }

  createProveedor(proveedor: CreateProveedorDto): Observable<Proveedor> {
    return this.http.post<Proveedor>(this.apiUrl, proveedor);
  }

  updateProveedor(id: number, proveedor: UpdateProveedorDto): Observable<Proveedor> {
    return this.http.put<Proveedor>(`${this.apiUrl}/${id}`, proveedor);
  }

  deleteProveedor(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}