// frontend/src/app/services/producto.service.ts (REEMPLAZAR)
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Producto, CreateProductoDto, UpdateProductoDto } from '../producto/producto.interface';

@Injectable({
  providedIn: 'root'
})
export class ProductoService {
  // -------------------------------------------------
  // ¡RECUERDA! Reemplaza esto con tu URL pública de Codespaces (puerto 3000)
  // -------------------------------------------------
  private apiUrl = 'https://glorious-space-goggles-9rxj6pr5w5p3xp9g-3000.app.github.dev/api/v1/producto';

  constructor(private http: HttpClient) { }

  getProductos(): Observable<any[]> { // Devuelve any[] para el mapeo
    return this.http.get<any[]>(this.apiUrl);
  }
  
  getProductoById(id: number): Observable<any> { // Devuelve any para el mapeo
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

  getKardex(id: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/${id}/kardex`);
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
}