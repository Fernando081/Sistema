// frontend/src/app/services/categoria.service.ts (REEMPLAZAR)

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Categoria } from '../categoria/categoria.interface';
import { map } from 'rxjs/operators';

interface CategoriaDb { IdCategoria: number; Descripcion: string; }
const mapCategoria = (row: CategoriaDb): Categoria => ({ idCategoria: row.IdCategoria, descripcion: row.Descripcion });

@Injectable({
  providedIn: 'root'
})
export class CategoriaService {
  private apiUrl = `${environment.apiBaseUrl}/categoria`;

  constructor(private http: HttpClient) { }

  getCategorias(): Observable<Categoria[]> {
    // Mapeamos de PascalCase (DB) a camelCase (Angular)
    return this.http.get<CategoriaDb[]>(this.apiUrl).pipe(
      map(data => data.map(mapCategoria))
    );
  }

  // --- ¡NUEVAS FUNCIONES CRUD! ---

  createCategoria(descripcion: string): Observable<Categoria> {
    return this.http.post<CategoriaDb>(this.apiUrl, { descripcion }).pipe(map(mapCategoria));
  }

  updateCategoria(id: number, descripcion: string): Observable<Categoria> {
    return this.http.put<CategoriaDb>(`${this.apiUrl}/${id}`, { descripcion }).pipe(map(mapCategoria));
  }

  deleteCategoria(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}