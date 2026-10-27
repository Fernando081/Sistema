import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ProveedorService } from './proveedor.service';
import { CategoriaService } from './categoria.service';
import { ProveedorDb } from './proveedor-api.types';
import { environment } from '../../environments/environment';

describe('Contratos de proveedores y categorías', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  const proveedor: ProveedorDb = {
    IdProveedor: 4, RFC: 'XAXX010101000', RazonSocial: 'Proveedor ISX', Pais: 'México',
    IdEstado: null, IdMunicipio: null, Ciudad: null, Colonia: null, Calle: null,
    CodigoPostal: '89000', NumeroExterior: null, NumeroInterior: null, Referencia: null,
    IdMetodoDePago: null, IdUsoCFDI: null, IdFormaPago: null, IdRegimenFiscal: 601,
  };

  it('lista y consulta individual producen el mismo proveedor y conservan IDs null', () => {
    const api = TestBed.inject(ProveedorService);
    api.getProveedores().subscribe(rows => expect(rows[0]).toEqual(jasmine.objectContaining({
      idProveedor: 4, razonSocial: 'Proveedor ISX', idEstado: null, ciudad: '',
    })));
    http.expectOne(`${environment.apiBaseUrl}/proveedores`).flush([proveedor]);
    api.getProveedorById(4).subscribe(row => expect(row.razonSocial).toBe('Proveedor ISX'));
    http.expectOne(`${environment.apiBaseUrl}/proveedores/4`).flush(proveedor);
  });

  it('alta y edición de categoría normalizan el resultado PascalCase de SQL', () => {
    const api = TestBed.inject(CategoriaService);
    api.createCategoria('Filtros').subscribe(row => expect(row).toEqual({ idCategoria: 3, descripcion: 'Filtros' }));
    const create = http.expectOne(`${environment.apiBaseUrl}/categoria`);
    expect(create.request.body).toEqual({ descripcion: 'Filtros' });
    create.flush({ IdCategoria: 3, Descripcion: 'Filtros' });
    api.updateCategoria(3, 'Filtros ISX').subscribe(row => expect(row.descripcion).toBe('Filtros ISX'));
    http.expectOne(`${environment.apiBaseUrl}/categoria/3`).flush({ IdCategoria: 3, Descripcion: 'Filtros ISX' });
  });
});
