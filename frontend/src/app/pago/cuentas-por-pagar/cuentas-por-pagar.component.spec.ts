import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { throwError } from 'rxjs';
import { CuentasPorPagarComponent } from './cuentas-por-pagar.component';
import {
  CuentasProveedorService,
  SupplierInvoiceDetail,
} from '../../services/cuentas-proveedor.service';
import { AbastecimientoService } from '../../services/abastecimiento.service';
import { ProveedorService } from '../../services/proveedor.service';
import { PagoProveedorService } from '../../services/pago-proveedor.service';
import { NotificationService } from '../../shared/notification.service';
import { ConfirmService } from '../../shared/confirm.service';

describe('Cuentas por pagar: reintentos del consumidor', () => {
  function setup(status: number) {
    spyOn(CuentasPorPagarComponent.prototype, 'load').and.stub();
    const api = {
      pay: jasmine
        .createSpy('pay')
        .and.returnValue(throwError(() => new HttpErrorResponse({ status }))),
      advance: jasmine
        .createSpy('advance')
        .and.returnValue(throwError(() => new HttpErrorResponse({ status }))),
      credit: jasmine
        .createSpy('credit')
        .and.returnValue(throwError(() => new HttpErrorResponse({ status }))),
    };
    const notice = { show: jasmine.createSpy('show') };
    TestBed.configureTestingModule({
      providers: [
        FormBuilder,
        { provide: CuentasProveedorService, useValue: api },
        { provide: NotificationService, useValue: notice },
        ...[AbastecimientoService, ProveedorService, PagoProveedorService, ConfirmService].map(
          (provide) => ({ provide, useValue: {} }),
        ),
      ],
    });
    const component = TestBed.runInInjectionContext(() => new CuentasPorPagarComponent());
    return { component, api, notice };
  }
  it('reuses a payment UUID after an uncertain result and blocks changed amounts', () => {
    const { component, api } = setup(503);
    component.selectedInvoice.set({ idFacturaProveedor: 1 } as SupplierInvoiceDetail);
    component.paymentForm.patchValue({ monto: 10 });
    component.pay();
    const key = api.pay.calls.mostRecent().args[1].requestId;
    component.pay();
    expect(api.pay.calls.mostRecent().args[1].requestId).toBe(key);
    component.paymentForm.patchValue({ monto: 11 });
    component.pay();
    expect(api.pay).toHaveBeenCalledTimes(2);
    expect(component.saving()).toBeFalse();
  });
  it('allows an advance correction after definitive validation', () => {
    const { component, api } = setup(400);
    component.advanceForm.patchValue({ idProveedor: 1, monto: 10 });
    component.createAdvance();
    const key = api.advance.calls.mostRecent().args[0].requestId;
    component.advanceForm.patchValue({ monto: 11 });
    component.createAdvance();
    expect(api.advance.calls.mostRecent().args[0].requestId).not.toBe(key);
  });
  it('keeps the credit UUID after an uncertain result', () => {
    const { component, api } = setup(0);
    component.creditForm.patchValue({ idProveedor: 1, folio: 'TEST', total: 10 });
    component.createCredit();
    const key = api.credit.calls.mostRecent().args[0].requestId;
    component.createCredit();
    expect(api.credit.calls.mostRecent().args[0].requestId).toBe(key);
  });
});
