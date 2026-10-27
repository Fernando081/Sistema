// frontend/src/app/services/producto.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { Producto, CreateProductoDto, UpdateProductoDto, KardexItem, SmartRestockItem, PrediccionDemandaItem, ProductoAlternativa } from '../producto/producto.interface';

import { ProductoDb, ProductoPagina, HistorialPrecio, ProductoEquivalente, NumeroParte, NumeroParteInput, AplicacionProducto, AplicacionInput, CotizacionProveedor, CotizacionProveedorInput, MensajeProducto } from './producto-api.types';

@Injectable({
  providedIn: 'root'
})
export class ProductoService {
  
  private apiUrl = `${environment.apiBaseUrl}/producto`;
  private uploadUrl = `${environment.apiBaseUrl}/upload`;

  constructor(private http: HttpClient) { }

  // --- CRUD BÁSICO ---

  getProductos(page: number = 1, limit: number = 10, sort: string = '', order: string = '', term: string = ''): Observable<ProductoPagina> {
    let url = `${this.apiUrl}?page=${page}&limit=${limit}`;
    if (sort) url += `&sort=${sort}`;
    if (order) url += `&order=${order}`;
    if (term) url += `&term=${encodeURIComponent(term)}`;
    return this.http.get<ProductoPagina<ProductoDb>>(url).pipe(map(page => ({ ...page, data: page.data.map(p => this.mapProducto(p)) })));
  }

  buscarProductos(term: string, limit = 25): Observable<Producto[]> {
    return this.getProductos(1, limit, '', '', term).pipe(
      map((response) => response.data),
    );
  }

  exportCsv(term: string, sort = '', order = ''): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/exportar`, { params: { term, sort, order }, responseType: 'blob' });
  }

  private mapProducto(p: ProductoDb): Producto {
    return {
      idProducto: p['IdProducto'],
      codigo: p['Codigo'] ?? '',
      descripcion: p['Descripcion'],
      precioUnitario: Number(p['PrecioUnitario']),
      marca: p['Marca'] ?? '',
      ubicacion: p['Ubicacion'] ?? '',
      idUnidad: p['IdUnidad'],
      idObjetoImpuesto: p['IdObjetoImpuesto'],
      idCategoria: p['IdCategoria'],
      idClaveProdOServ: p['IdClaveProdOServ'],
      idClaveUnidad: p['IdClaveUnidad'],
      categoriaNombre: p['CategoriaNombre'] ?? undefined,
      claveProdServ: p['ClaveProdServ'] ?? undefined,
      descripcionProdServ: p['DescripcionProdServ'] ?? undefined,
      claveUnidadSat: p['ClaveUnidadSat'] ?? undefined,
      descripcionUnidadSat: p['DescripcionUnidadSat'] ?? undefined,
      objetoImpuestoSat: p['ObjetoImpuesto'],
      tasaIva: Number(p['TasaIVA']),
      aplicaRetencionIsr: Boolean(p['AplicaRetencionISR']),
      aplicaRetencionIva: Boolean(p['AplicaRetencionIVA']),
      existencia: Number(p['Existencia'] ?? 0),
      reservada: Number(p['Reservada'] || 0),
      disponible: Number(p['Disponible'] ?? p['Existencia'] ?? 0),
      equivalentesIds: p['EquivalentesJSON'] || [],
      imagenes: p['imagenes'] || [],
    };
  }
  
  getProductoById(id: number): Observable<Producto> {
    return this.http.get<ProductoDb>(`${this.apiUrl}/${id}`).pipe(map(producto => this.mapProducto(producto)));
  }

  createProducto(producto: CreateProductoDto): Observable<Producto> {
    return this.http.post<ProductoDb>(this.apiUrl, producto).pipe(map(p => this.mapProducto(p)));
  }

  updateProducto(id: number, producto: UpdateProductoDto): Observable<Producto> {
    return this.http.put<ProductoDb>(`${this.apiUrl}/${id}`, producto).pipe(map(p => this.mapProducto(p)));
  }

  deleteProducto(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  // --- MÉTODOS AVANZADOS (KARDEX, PRECIOS, EQUIVALENTES) ---

  getKardex(idProducto: number): Observable<KardexItem[]> {
    return this.http.get<KardexItem[]>(`${this.apiUrl}/${idProducto}/kardex`);
  }

  getHistorialPrecios(id: number): Observable<HistorialPrecio[]> {
    return this.http.get<HistorialPrecio[]>(`${this.apiUrl}/${id}/historial-precios`);
  }

  getEquivalentes(id: number): Observable<ProductoEquivalente[]> {
    return this.http.get<ProductoEquivalente[]>(`${this.apiUrl}/${id}/equivalentes`);
  }

  agregarEquivalente(id: number, idEq: number): Observable<MensajeProducto> {
    return this.http.post<MensajeProducto>(`${this.apiUrl}/${id}/equivalentes/${idEq}`, {});
  }

  eliminarEquivalente(id: number, idEq: number): Observable<MensajeProducto> {
    return this.http.delete<MensajeProducto>(`${this.apiUrl}/${id}/equivalentes/${idEq}`);
  }

  getNumerosParte(id: number): Observable<NumeroParte[]> {
    return this.http.get<NumeroParte[]>(`${this.apiUrl}/${id}/numeros-parte`);
  }
  addNumeroParte(id: number, dto: NumeroParteInput): Observable<{ idNumero: number }> {
    return this.http.post<{ idNumero: number }>(`${this.apiUrl}/${id}/numeros-parte`, dto);
  }
  deleteNumeroParte(id: number, idNumero: number): Observable<MensajeProducto> {
    return this.http.delete<MensajeProducto>(`${this.apiUrl}/${id}/numeros-parte/${idNumero}`);
  }
  getAplicaciones(id: number): Observable<AplicacionProducto[]> {
    return this.http.get<AplicacionProducto[]>(`${this.apiUrl}/${id}/aplicaciones`);
  }
  addAplicacion(id: number, dto: AplicacionInput): Observable<{ idAplicacion: number }> {
    return this.http.post<{ idAplicacion: number }>(`${this.apiUrl}/${id}/aplicaciones`, dto);
  }
  deleteAplicacion(id: number, idAplicacion: number): Observable<MensajeProducto> {
    return this.http.delete<MensajeProducto>(`${this.apiUrl}/${id}/aplicaciones/${idAplicacion}`);
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

  // --- COTIZACIONES PROVEEDOR ---
  getCotizacionesProveedor(idProducto: number): Observable<CotizacionProveedor[]> {
    return this.http.get<CotizacionProveedor[]>(`${this.apiUrl}/${idProducto}/cotizacion-prov`);
  }

  addCotizacionProveedor(idProducto: number, dto: CotizacionProveedorInput): Observable<{ message: string; idCotizacionProv: number }> {
    return this.http.post<{ message: string; idCotizacionProv: number }>(`${this.apiUrl}/${idProducto}/cotizacion-prov`, dto);
  }

  // --- ALTERNATIVAS (CRUCES) ---
  getAlternativas(idProducto: number): Observable<ProductoAlternativa[]> {
    return this.http.get<{
      id_producto: number; codigo: string | null; descripcion: string;
      marca: string | null; precio: number | string; stock: number | string;
    }[]>(`${this.apiUrl}/${idProducto}/alternativas`).pipe(map(rows => rows.map(row => ({
      ...row, codigo: row.codigo ?? '', marca: row.marca ?? '',
      precio: Number(row.precio), stock: Number(row.stock),
    }))));
  }

  ajustarInventario(idProducto: number, cantidad: number, tipo: 'ENTRADA POR AJUSTE' | 'SALIDA POR MERMA/AJUSTE', motivo: string): Observable<{ message: string; existencia: number }> {
    return this.http.post<{ message: string; existencia: number }>(`${this.apiUrl}/${idProducto}/ajustar-inventario`, { cantidad, tipo, motivo });
  }
}
