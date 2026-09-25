// frontend/src/app/services/producto.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
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

  getProductos(page: number = 1, limit: number = 10, sort: string = '', order: string = '', term: string = ''): Observable<any> {
    let url = `${this.apiUrl}?page=${page}&limit=${limit}`;
    if (sort) url += `&sort=${sort}`;
    if (order) url += `&order=${order}`;
    if (term) url += `&term=${encodeURIComponent(term)}`;
    return this.http.get<any>(url);
  }

  buscarProductos(term: string, limit = 25): Observable<Producto[]> {
    return this.getProductos(1, limit, '', '', term).pipe(
      map((response) => (response.data || response).map((p: any) => this.mapProducto(p))),
    );
  }

  private mapProducto(p: any): Producto {
    return {
      idProducto: p['IdProducto'],
      codigo: p['Codigo'],
      descripcion: p['Descripcion'],
      precioUnitario: Number(p['PrecioUnitario']),
      marca: p['Marca'],
      ubicacion: p['Ubicacion'],
      idUnidad: p['IdUnidad'],
      idObjetoImpuesto: p['IdObjetoImpuesto'],
      idCategoria: p['IdCategoria'],
      idClaveProdOServ: p['IdClaveProdOServ'],
      idClaveUnidad: p['IdClaveUnidad'],
      categoriaNombre: p['CategoriaNombre'],
      claveProdServ: p['ClaveProdServ'],
      descripcionProdServ: p['DescripcionProdServ'],
      claveUnidadSat: p['ClaveUnidadSat'],
      descripcionUnidadSat: p['DescripcionUnidadSat'],
      objetoImpuestoSat: p['ObjetoImpuesto'],
      tasaIva: Number(p['TasaIVA']),
      aplicaRetencionIsr: Boolean(p['AplicaRetencionISR']),
      aplicaRetencionIva: Boolean(p['AplicaRetencionIVA']),
      existencia: Number(p['Existencia']),
      reservada: Number(p['Reservada'] || 0),
      disponible: Number(p['Disponible'] ?? p['Existencia']),
      equivalentesIds: p['EquivalentesJSON'] || [],
      imagenes: p['imagenes'] || [],
    } as Producto;
  }
  
  getProductoById(id: number): Observable<Producto> {
    return this.http.get<any>(`${this.apiUrl}/${id}`).pipe(map(producto => this.mapProducto(producto)));
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

  getNumerosParte(id: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/${id}/numeros-parte`);
  }
  addNumeroParte(id: number, dto: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/${id}/numeros-parte`, dto);
  }
  deleteNumeroParte(id: number, idNumero: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/${id}/numeros-parte/${idNumero}`);
  }
  getAplicaciones(id: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/${id}/aplicaciones`);
  }
  addAplicacion(id: number, dto: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/${id}/aplicaciones`, dto);
  }
  deleteAplicacion(id: number, idAplicacion: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/${id}/aplicaciones/${idAplicacion}`);
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
  getCotizacionesProveedor(idProducto: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/${idProducto}/cotizacion-prov`);
  }

  addCotizacionProveedor(idProducto: number, dto: any): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/${idProducto}/cotizacion-prov`, dto);
  }

  // --- ALTERNATIVAS (CRUCES) ---
  getAlternativas(idProducto: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/${idProducto}/alternativas`);
  }

  ajustarInventario(idProducto: number, cantidad: number, tipo: string, motivo: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/${idProducto}/ajustar-inventario`, { cantidad, tipo, motivo });
  }
}
