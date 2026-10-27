import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { WebCatalogQualityComponent } from './web-catalog-quality.component';
import { environment } from '../../environments/environment';
describe('Lista de calidad del catálogo', () => {
  let component: WebCatalogQualityComponent;
  let http: HttpTestingController;
  const url = `${environment.apiBaseUrl}/web-catalog/admin/products`;
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [WebCatalogQualityComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    component = TestBed.createComponent(WebCatalogQualityComponent).componentInstance;
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('restablece página y envía filtros acotados al servidor', () => {
    component.page = 3;
    component.term = '  ABC-42  ';
    component.estado = 'borrador';
    component.search();
    const req = http.expectOne((r) => r.url === url);
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('term')).toBe('ABC-42');
    expect(req.request.params.get('estado')).toBe('borrador');
    expect(req.request.params.get('limit')).toBe('25');
    req.flush({ data: [], total: 0 });
    expect(component.loading()).toBeFalse();
  });
  it('borra resultados anteriores si falla y permite reintentar', () => {
    component.total.set(20);
    component.load();
    http.expectOne((r) => r.url === url).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(component.total()).toBe(0);
    expect(component.error()).toContain('No se pudo');
    component.load();
    http.expectOne((r) => r.url === url).flush({ data: [], total: 0 });
    expect(component.error()).toBe('');
  });
});
