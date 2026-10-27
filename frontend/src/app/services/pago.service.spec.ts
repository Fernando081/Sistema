import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { PagoService } from './pago.service';
import { environment } from '../../environments/environment';

describe('Contrato de cancelación REP', () => {
  it('conserva el estado pendiente y el motivo fiscal en la petición', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const http = TestBed.inject(HttpTestingController);
    TestBed.inject(PagoService).cancelarRep(7, { motivo: '02' }).subscribe(result => {
      expect(result.cancelled).toBeFalse();
      expect(result.state).toBe('Cancelacion solicitada');
    });
    const request = http.expectOne(`${environment.apiBaseUrl}/pago/rep/7/cancelar`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ motivo: '02' });
    request.flush({ message: 'Pendiente de confirmación', fiscal: true, cancelled: false, state: 'Cancelacion solicitada' });
    http.verify();
  });
});
