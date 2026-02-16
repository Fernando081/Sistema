// frontend/src/app/services/catalogos.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

// URL de tu Backend en Codespaces
const API_URL = `${environment.apiBaseUrl}/catalogos`;

// --- 1. TODAS LAS INTERFACES (Antiguas y Nuevas) ---

// Interfaces para Proveedor/Cliente (Las que faltaban)
export interface RegimenFiscal { idRegimenFiscal: number; clave: string; nombre: string; }
export interface FormaPago { idFormaPago: number; clave: string; nombre: string; }
export interface MetodoPago { idMetodoDePago: number; clave: string; nombre: string; }
export interface UsoCFDI { idUsoCFDI: number; clave: string; nombre: string; }
export interface Estado { idEstado: number; clave: string; nombre: string; }
export interface Municipio { idMunicipio: number; clave: string; nombre: string; claveEstado: string; }

// Interfaces para Producto (Las nuevas)
export interface Unidad { idUnidad: number; descripcion: string; clave?: string; }
export interface ObjetoImpuesto { idObjetoImpuesto: number; clave: string; descripcion: string; }
export interface ClaveProdServ { idClaveProdOServ: number; clave: string; descripcion: string; }
export interface ClaveUnidad { idClaveUnidad: number; clave: string; descripcion: string; }

@Injectable({
  providedIn: 'root'
})
export class CatalogosService {

  constructor(private http: HttpClient) { }

  // --- 2. MÉTODOS PARA PROVEEDORES/CLIENTES (Los que se borraron) ---

  getRegimenesFiscales(): Observable<RegimenFiscal[]> {
    return this.http.get<any[]>(`${API_URL}/regimen-fiscal`).pipe(
      map(data => data.map(item => ({
        idRegimenFiscal: item.IdRegimenFiscal,
        clave: item.Clave,
        nombre: item.Nombre
      })))
    );
  }

  getFormasPago(): Observable<FormaPago[]> {
    return this.http.get<any[]>(`${API_URL}/forma-pago`).pipe(
      map(data => data.map(item => ({
        idFormaPago: item.IdFormaPago,
        clave: item.Clave,
        nombre: item.Nombre
      })))
    );
  }

  getMetodosPago(): Observable<MetodoPago[]> {
    return this.http.get<any[]>(`${API_URL}/metodo-pago`).pipe(
      map(data => data.map(item => ({
        idMetodoDePago: item.IdMetodoDePago,
        clave: item.Clave,
        nombre: item.Nombre
      })))
    );
  }

  getUsosCFDI(): Observable<UsoCFDI[]> {
    return this.http.get<any[]>(`${API_URL}/uso-cfdi`).pipe(
      map(data => data.map(item => ({
        idUsoCFDI: item.IdUsoCFDI,
        clave: item.Clave,
        nombre: item.Nombre
      })))
    );
  }

  getEstados(): Observable<Estado[]> {
    return this.http.get<any[]>(`${API_URL}/estado`).pipe(
      map(data => data.map(item => ({
        idEstado: item.IdEstado,
        clave: item.Clave,
        nombre: item.Nombre
      })))
    );
  }

  // --- 3. MÉTODOS PARA PRODUCTOS (Los nuevos) ---

  getUnidades(): Observable<Unidad[]> {
    return this.http.get<any[]>(`${API_URL}/unidad`).pipe(
      map(data => data.map(item => ({
        // CORRECCIÓN: TypeORM devuelve 'idUnidad' (minúscula), no 'IdUnidad'
        idUnidad: item.idUnidad, 
        
        // CORRECCIÓN: TypeORM devuelve 'clave' y 'descripcion' (minúsculas)
        clave: item.clave || '', 
        descripcion: item.descripcion // <--- Aquí estaba el error, antes decía item.Descripcion
      })))
    );
  }

  getObjetosImpuesto(): Observable<ObjetoImpuesto[]> {
    return this.http.get<any[]>(`${API_URL}/objeto-impuesto`).pipe(
      map(data => data.map(item => ({
        // CORRECCIÓN: Todo en minúsculas (camelCase)
        idObjetoImpuesto: item.idObjetoImpuesto,
        clave: item.clave,
        descripcion: item.descripcion // <--- Antes decía item.Descripcion
      })))
    );
  }

  // --- 4. AUTOCOMPLETADO ---

  buscarClaveProdServ(termino: string): Observable<ClaveProdServ[]> {
    if (!termino || termino.trim().length < 3) return of([]);
    
    return this.http.get<any[]>(`${API_URL}/clave-prod-serv/buscar?q=${termino}`).pipe(
        map(data => data.map(item => ({
            idClaveProdOServ: item.IdClaveProdOServ,
            clave: item.Clave,
            descripcion: item.Descripcion
        })))
    );
  }
  
  buscarClaveUnidad(termino: string): Observable<ClaveUnidad[]> {
    if (!termino || termino.trim().length < 2) return of([]);

    return this.http.get<any[]>(`${API_URL}/clave-unidad/buscar?q=${termino}`).pipe(
        map(data => data.map(item => ({
            idClaveUnidad: item.IdClaveUnidad,
            clave: item.Clave,
            descripcion: item.Descripcion
        })))
    );
  }

  // NUEVO: Obtener municipios filtrados por la clave del estado (ej. 'TAM')
  getMunicipiosPorEstado(claveEstado: string): Observable<Municipio[]> {
    return this.http.get<any[]>(`${API_URL}/municipio/por-estado/${claveEstado}`).pipe(
      map(data => data.map(item => ({
        idMunicipio: item.IdMunicipio,
        clave: item.Clave,
        nombre: item.Nombre,
        claveEstado: item.ClaveEstado
      })))
    );
  }

}