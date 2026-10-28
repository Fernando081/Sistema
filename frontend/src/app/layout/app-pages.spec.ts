import { Route } from '@angular/router';
import { APP_PAGES, pageAllowed, pageForPath, searchPages, sectionForPath } from './app-pages';
import { consultaDeVista } from '../services/vistas-guardadas.service';

describe('Navegación rápida (U02.1)', () => {
  it('encuentra pantallas sin acentos, por varias palabras y por ruta, priorizando el título', () => {
    expect(searchPages('contabilidad', APP_PAGES).map((p) => p.route)).toEqual(['/contabilidad']);
    expect(searchPages('cotizacion', APP_PAGES)[0].title).toBe('Cotizaciones');
    expect(searchPages('historial cotiz', APP_PAGES).map((p) => p.route)).toContain('/cotizacion/historial');
    expect(searchPages('proveedores pagar', APP_PAGES).map((p) => p.route)).toEqual(['/cuentas-por-pagar']);
    expect(searchPages('   ', APP_PAGES)).toEqual([]);
    expect(searchPages('a', APP_PAGES).length).toBeLessThanOrEqual(6);
  });

  it('respeta los roles de la ruta y resuelve el encabezado de la página', () => {
    const routes: Route[] = [{ path: 'contabilidad', data: { roles: ['admin'] } }, { path: 'cobranza' }];
    const conta = APP_PAGES.find((p) => p.route === '/contabilidad')!;
    const cobranza = APP_PAGES.find((p) => p.route === '/cobranza')!;
    expect(pageAllowed(conta, 'user', routes)).toBeFalse();
    expect(pageAllowed(conta, 'admin', routes)).toBeTrue();
    expect(pageAllowed(cobranza, 'user', routes)).toBeTrue();
    expect(pageForPath('/cotizacion/historial')?.title).toBe('Cotizaciones');
    expect(pageForPath('/cotizacion/15/versiones')?.title).toBe('Revisiones de cotización');
    expect(sectionForPath('/cuentas-por-pagar')).toBe('Finanzas y análisis');
  });

  it('la consulta de una vista ignora página, vacíos y parámetros ajenos (igual que el servidor)', () => {
    expect(consultaDeVista('?page=3&estado=Pagada&origen=x&q=%20Diesel%20&tipo=')).toBe('q=Diesel&estado=Pagada');
  });
});
