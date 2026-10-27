import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { VentaService } from './venta.service';
import { CotizacionService } from './cotizacion.service';
import { environment } from '../../environments/environment';

describe('Contratos de ventas y cotizaciones', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('preserva partidas aceptadas/rechazadas y medios de pago al convertir', () => {
    const payload = { idFormaPago: 1, idMetodoPago: 2, articulosAceptados: [{ idConcepto: 8, precioCierre: 125 }], articulosRechazados: [{ idConcepto: 9, motivoRechazo: 'Precio' }] };
    TestBed.inject(CotizacionService).convertirCRM(4, payload).subscribe(result => expect(result.idFactura).toBe(7));
    const request = http.expectOne(`${environment.apiBaseUrl}/cotizacion/4/convertir`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(payload);
    request.flush({ message: 'Cotización procesada', idFactura: 7 });
  });

  it('conserva periodo y selección de tickets al generar una global', () => {
    TestBed.inject(VentaService).generarFacturaGlobal('2026-09-01', '2026-09-30', [3, 9]).subscribe(result => expect(result.idFactura).toBe(12));
    const request = http.expectOne(`${environment.apiBaseUrl}/factura/global/generar`);
    expect(request.request.body).toEqual({ fechaInicio: '2026-09-01', fechaFin: '2026-09-30', idsTickets: [3, 9] });
    request.flush({ message: 'Factura Global generada con éxito', idFactura: 12 });
  });
});
