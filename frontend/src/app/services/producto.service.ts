// frontend/src/app/services/producto.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Producto, CreateProductoDto, UpdateProductoDto, KardexItem, SmartRestockItem, PrediccionDemandaItem } from '../producto/producto.interface';

@Injectable({
  providedIn: 'root'
})
export class ProductoService {
  
  private apiUrl = `${environment.apiBaseUrl}/producto`;
  private uploadUrl = `${environment.apiBaseUrl}/upload`;

  constructor(private http: HttpClient) { }

  // --- CRUD BÁSICO ---

  getProductos(page: number = 1, limit: number = 10, sort: string = '', order: string = ''): Observable<any> {
    let url = `${this.apiUrl}?page=${page}&limit=${limit}`;
    if (sort) url += `&sort=${sort}`;
    if (order) url += `&order=${order}`;
    return this.http.get<any>(url);
  }
  
  getProductoById(id: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/${id}`);
  }

  createProducto(producto: CreateProductoDto): Observable<Producto> {
    return this.http.post<Producto>(this.apiUrl, producto);
  }

  updateProducto(id: number, producto: UpdateProductoDto): Observable<Producto> {
    return this.http.put<Producto>(`${this.apiUrl}/${id}`, producto);
  }

  deleteProducto(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  // --- MÉTODOS AVANZADOS (KARDEX, PRECIOS, EQUIVALENTES) ---

  getKardex(idProducto: number): Observable<KardexItem[]> {
    return this.http.get<KardexItem[]>(`${this.apiUrl}/${idProducto}/kardex`);
  }

  getHistorialPrecios(id: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/${id}/historial-precios`);
  }

  getEquivalentes(id: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/${id}/equivalentes`);
  }

  agregarEquivalente(id: number, idEq: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/${id}/equivalentes/${idEq}`, {});
  }

  eliminarEquivalente(id: number, idEq: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/${id}/equivalentes/${idEq}`);
  }

  getSmartRestock(): Observable<SmartRestockItem[]> {
    return this.http.get<SmartRestockItem[]>(`${this.apiUrl}/smart-restock`);
  }

  // --- PREDICCIÓN DE DEMANDA (AI Smart Restock) ---
  getPrediccionDemanda(): Observable<PrediccionDemandaItem[]> {
    return this.http.get<PrediccionDemandaItem[]>(`${this.apiUrl}/prediccion-compras`);
  }

  refreshPrediccion(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/prediccion-compras/refresh`, {});
  }

  uploadImages(files: File[]): Observable<{ urls: string[]; message: string }> {
    const formData = new FormData();
    for (const file of files) {
      formData.append('images', file);
    }
    return this.http.post<{ urls: string[]; message: string }>(this.uploadUrl, formData);
  }
}