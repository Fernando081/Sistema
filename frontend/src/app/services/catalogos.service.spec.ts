import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CatalogosService } from './catalogos.service';
import { environment } from '../../environments/environment';

describe('Contratos de catálogos SQL', () => {
  let service: CatalogosService;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(CatalogosService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('conserva el identificador SAT y normaliza un estado sin clave', () => {
    service.getEstados().subscribe(rows => expect(rows).toEqual([{ idEstado: 28, nombre: 'Tamaulipas', clave: '' }]));
    http.expectOne(`${environment.apiBaseUrl}/catalogos/estado`).flush([{ IdEstado: 28, Nombre: 'Tamaulipas', Clave: null }]);
  });
  it('preserva municipio y estado cuando las claves SQL admiten NULL', () => {
    service.getMunicipiosPorEstado('TAM').subscribe(rows => expect(rows).toEqual([
      { idMunicipio: 1, nombre: 'Tampico', clave: '', claveEstado: 'TAM' },
    ]));
    http.expectOne(`${environment.apiBaseUrl}/catalogos/municipio/por-estado/TAM`).flush([
      { IdMunicipio: 1, Nombre: 'Tampico', Clave: null, ClaveEstado: null },
    ]);
  });
});
