import { fakeAsync, tick } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { DirectoryPage, DirectoryQuery, RemoteDirectory } from './remote-directory';

describe('Estado del directorio remoto', () => {
  it('rango conserva filtros y texto pendiente; invalido no cambia consulta', fakeAsync(() => {
    const fetch = jasmine.createSpy().and.returnValue(of({ data: ['dato'], total: 100, page: 1, totalPages: 10 }));
    const notice = jasmine.createSpy();
    const directory = new RemoteDirectory<string>(fetch, notice);
    directory.start(); directory.setEstado('Pagada');
    directory.page({ pageIndex: 2, pageSize: 25, length: 100 });
    directory.setTerm('Diesel'); directory.setDates('2026-09-30', '2026-10-01'); tick(301);
    expect(directory.query()).toEqual({ page: 1, limit: 25, term: 'Diesel', sortBy: 'id', sortOrder: 'desc', estado: 'Pagada', desde: '2026-09-30', hasta: '2026-10-01' });
    const count = fetch.calls.count();
    directory.setDates('2026-10-02', '2026-10-01');
    expect(fetch.calls.count()).toBe(count); expect(notice).toHaveBeenCalled();
    directory.setDates('', ''); expect(directory.query().estado).toBe('Pagada');
    directory.dispose(); tick(301);
  }));
  it('estado comercial conserva tipo/orden y reinicia página con término pendiente', fakeAsync(() => {
    const fetch = jasmine.createSpy().and.returnValue(of({ data: ['dato'], total: 100, page: 1, totalPages: 10 }));
    const directory = new RemoteDirectory(fetch, () => {}, ['total']);
    directory.start(); directory.setTipo('E'); directory.sort({ active: 'total', direction: 'asc' });
    directory.page({ pageIndex: 2, pageSize: 25, length: 100 });
    directory.setTerm('NC101'); directory.setEstado('Cancelada'); tick(301);
    expect(directory.query()).toEqual({ page: 1, limit: 25, term: 'NC101', sortBy: 'total', sortOrder: 'asc', tipo: 'E', estado: 'Cancelada' });
    expect(fetch.calls.count()).toBe(5); directory.dispose();
  }));
  it('cambiar tipo conserva el término visible y cancela el filtro pendiente', fakeAsync(() => {
    const fetch = jasmine.createSpy().and.returnValue(of({ data: ['dato'], total: 100, page: 1, totalPages: 10 }));
    const directory = new RemoteDirectory(fetch, () => {});
    directory.start(); directory.page({ pageIndex: 2, pageSize: 25, length: 100 });
    directory.setTerm('NC101'); directory.setTipo('E'); tick(301);
    expect(directory.query()).toEqual({ page: 1, limit: 25, term: 'NC101', sortBy: 'id', sortOrder: 'desc', tipo: 'E' });
    expect(fetch.calls.count()).toBe(3); directory.dispose();
  }));
  it('descarta la respuesta anterior al cambiar la búsqueda', () => {
    const oldRequest = new Subject<DirectoryPage<string>>();
    const newRequest = new Subject<DirectoryPage<string>>();
    const fetch = jasmine.createSpy().and.returnValues(oldRequest, newRequest);
    const directory = new RemoteDirectory<string>(fetch, () => {});
    directory.start(); directory.setTerm('VIN', true);
    oldRequest.next({ data: ['antiguo'], total: 1, page: 1, totalPages: 1 });
    expect(directory.loading()).toBeTrue();
    newRequest.next({ data: ['correcto'], total: 1, page: 1, totalPages: 1 });
    expect(directory.dataSource.data).toEqual(['correcto']);
    directory.dispose();
  });

  it('reinicia página al ordenar y conserva término/tamaño', () => {
    const fetch = jasmine.createSpy().and.returnValue(of({ data: ['dato'], total: 80, page: 1, totalPages: 4 }));
    const directory = new RemoteDirectory<string>(fetch, () => {});
    directory.start(); directory.setTerm('Diesel', true);
    directory.page({ pageIndex: 2, pageSize: 25, length: 80 });
    directory.sort({ active: 'razonSocial', direction: 'asc' });
    expect(directory.query()).toEqual({ page: 1, limit: 25, term: 'Diesel', sortBy: 'razonSocial', sortOrder: 'asc' });
    directory.dispose();
  });

  it('corrige la última página después de eliminar su último registro', () => {
    const fetch = (query: DirectoryQuery) => of({ data: query.page === 3 ? [] : ['dato'], total: 11, page: query.page, totalPages: 2 });
    const directory = new RemoteDirectory(fetch, () => {});
    directory.start(); directory.page({ pageIndex: 2, pageSize: 10, length: 21 });
    expect(directory.query().page).toBe(2);
    expect(directory.dataSource.data).toEqual(['dato']);
    expect(directory.loading()).toBeFalse();
    directory.dispose();
  });

  it('una búsqueda pendiente no sobrescribe un nuevo filtro recibido por URL', fakeAsync(() => {
    const fetch = jasmine.createSpy().and.returnValue(of({ data: [], total: 0, page: 1, totalPages: 0 }));
    const directory = new RemoteDirectory(fetch, () => {});
    directory.start(); directory.setTerm('anterior'); directory.setTerm('nuevo VIN', true);
    tick(301);
    expect(directory.query().term).toBe('nuevo VIN');
    expect(fetch.calls.count()).toBe(2);
    directory.dispose();
  }));
});
