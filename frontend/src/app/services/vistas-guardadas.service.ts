import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';

/** U02.2 · Listados cuyos filtros viven en la URL y pueden guardarse como vista. */
export type RutaVista = '/cliente' | '/proveedor' | '/producto' | '/facturas' | '/cotizacion/historial' | '/compra/historial';

export interface VistaGuardada {
  idVista: number;
  ruta: RutaVista;
  nombre: string;
  /** Query string sin "?" ya limpiada por el servidor (sin página). */
  consulta: string;
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class VistasGuardadasService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiBaseUrl}/vistas-guardadas`;

  list(ruta: RutaVista) {
    return this.http.get<VistaGuardada[]>(this.api, { params: { ruta } });
  }

  save(ruta: RutaVista, nombre: string, consulta: string) {
    return this.http.post<VistaGuardada>(this.api, { ruta, nombre, consulta });
  }

  remove(idVista: number) {
    return this.http.delete<{ message: string }>(`${this.api}/${idVista}`);
  }
}

/** Misma limpieza que el servidor, para marcar la vista activa: sin página, vacíos ni parámetros ajenos. */
const PARAMETROS = ['q', 'limit', 'sort', 'order', 'tipo', 'estado', 'desde', 'hasta'];
export function consultaDeVista(query: string): string {
  const entrada = new URLSearchParams(query.replace(/^\?/, ''));
  const salida = new URLSearchParams();
  for (const clave of PARAMETROS) {
    const valor = entrada.get(clave)?.trim();
    if (valor) salida.set(clave, valor.slice(0, 200));
  }
  return salida.toString();
}
