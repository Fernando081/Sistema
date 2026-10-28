import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ProductoService } from './producto.service';
import { CompraService } from './compra.service';
import { ProductoDb } from './producto-api.types';
import { environment } from '../../environments/environment';

describe('Contratos de productos y compras', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  const producto: ProductoDb = {
    IdProducto: 8, Codigo: 'ISX-8', Descripcion: 'Filtro', PrecioUnitario: '125.50',
    Marca: null, Ubicacion: null, IdUnidad: null, IdObjetoImpuesto: null,
    IdCategoria: 1, IdClaveProdOServ: null, IdClaveUnidad: null,
    ObjetoImpuesto: '02', TasaIVA: '0.16', AplicaRetencionISR: false,
    AplicaRetencionIVA: false, Existencia: '5', Reservada: '5', Disponible: '0',
    EquivalentesJSON: [9], imagenes: ['/uploads/filtro.webp'],
  };

  it('normaliza importes sin perder disponible cero, equivalentes ni imágenes', () => {
    TestBed.inject(ProductoService).getProductos(2, 10, '', '', 'ISX & 8').subscribe(page => {
      expect(page.total).toBe(11);
      expect(page.data[0]).toEqual(jasmine.objectContaining({
        idProducto: 8, precioUnitario: 125.5, disponible: 0, reservada: 5,
        imagenes: ['/uploads/filtro.webp'], equivalentesIds: [9], idUnidad: null,
      }));
    });
    const request = http.expectOne(`${environment.apiBaseUrl}/producto?page=2&limit=10&term=ISX%20%26%208`);
    request.flush({ data: [producto], total: 11, page: 2, totalPages: 2 });
  });

  it('el buscador usa el mismo mapeo que la lista paginada', () => {
    TestBed.inject(ProductoService).buscarProductos('ISX').subscribe(rows => {
      expect(rows[0].precioUnitario).toBe(125.5);
      expect(rows[0].imagenes).toEqual(['/uploads/filtro.webp']);
    });
    http.expectOne(`${environment.apiBaseUrl}/producto?page=1&limit=25&term=ISX`)
      .flush({ data: [producto], total: 1, page: 1, totalPages: 1 });
  });

  it('conserva requestId y devuelve la orden, recepción y factura de la compra directa (H02-b)', () => {
    const compra = {
      requestId: '18dc62cd-1f5c-4b8e-8e98-aa29842b3013', idProveedor: 4,
      esCredito: true, total: 290, conceptos: [{ idProducto: 8, descripcion: 'Filtro',
        codigo: 'ISX-8', cantidad: 2, costoUnitario: 125, importe: 250, tasaIva: 0.16 }],
    };
    TestBed.inject(CompraService).crearCompra(compra).subscribe(result => {
      expect(result.idOrden).toBe(6);
      expect(result.idFacturaProveedor).toBe(8);
      expect(result.idPago).toBeNull();
    });
    const request = http.expectOne(`${environment.apiBaseUrl}/compra`);
    expect(request.request.body).toEqual(compra);
    request.flush({ message: 'Registrada', idOrden: 6, folioOrden: '120', idRecepcion: 7, idFacturaProveedor: 8, idPago: null });
  });
});
