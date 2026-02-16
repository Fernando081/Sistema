// frontend/src/app/services/categoria.service.ts (REEMPLAZAR)

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Categoria } from '../categoria/categoria.interface';
import { map } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class CategoriaService {
  // Endpoint base configurado en environment.apiBaseUrl (ver src/environments/*)
  // Ajusta allí la URL pública de tu backend (por ejemplo, Codespaces puerto 3000)
  private apiUrl = `${environment.apiBaseUrl}/categoria`;

  constructor(private http: HttpClient) { }

  getCategorias(): Observable<Categoria[]> {
    // Mapeamos de PascalCase (DB) a camelCase (Angular)
    return this.http.get<any[]>(this.apiUrl).pipe(
      map(data => data.map(item => ({
        idCategoria: item['IdCategoria'],
        descripcion: item['Descripcion']
      })))
    );
  }

  // --- ¡NUEVAS FUNCIONES CRUD! ---

  createCategoria(descripcion: string): Observable<Categoria> {
    return this.http.post<Categoria>(this.apiUrl, { descripcion });
  }

  updateCategoria(id: number, descripcion: string): Observable<Categoria> {
    return this.http.put<Categoria>(`${this.apiUrl}/${id}`, { descripcion });
  }

  deleteCategoria(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}