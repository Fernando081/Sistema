import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { throwError } from 'rxjs';
import { RepCreateComponent } from './rep-create.component';
import { ClienteService } from '../../services/cliente.service';
import { PagoService } from '../../services/pago.service';
import { FiscalService } from '../../services/fiscal.service';

describe('REP con respuesta incierta', () => {
  function setup(status: number) {
    const registrarRep = jasmine.createSpy('registrarRep').and.callFake(() => throwError(() => new HttpErrorResponse({ status })));
    TestBed.configureTestingModule({providers: [FormBuilder,
      {provide: ClienteService,useValue:{}}, {provide: PagoService,useValue:{registrarRep}},
      {provide: MatSnackBar,useValue:{open:jasmine.createSpy('open')}},
      {provide: FiscalService,useValue:{}},{provide: MatDialog,useValue:{}},
      {provide: ChangeDetectorRef,useValue:{detectChanges:()=>{}}}]});
    const c=TestBed.runInInjectionContext(()=>new RepCreateComponent(TestBed.inject(FormBuilder),TestBed.inject(ClienteService),TestBed.inject(PagoService),TestBed.inject(MatSnackBar),TestBed.inject(ChangeDetectorRef),TestBed.inject(FiscalService),TestBed.inject(MatDialog)));
    c.clienteSeleccionado={idCliente:1} as NonNullable<typeof c.clienteSeleccionado>;
    c.facturasPendientes=[{id_factura:1,montoSaldado:10}] as typeof c.facturasPendientes;
    c.totalRep=10;
    return {c,registrarRep};
  }
  it('conserva la clave ante pérdida de respuesta y bloquea cambios de contenido',()=>{
    const {c,registrarRep}=setup(0);
    c.generarRep(); const key=registrarRep.calls.mostRecent().args[0].requestId;
    expect(key).toBeTruthy();expect(c.repPendingConfirmation).toBeTrue();
    c.generarRep();expect(registrarRep.calls.mostRecent().args[0].requestId).toBe(key);
    c.repForm.controls.formaPago.setValue('Efectivo');c.generarRep();expect(registrarRep.calls.count()).toBe(2);
  });
  it('permite corregir una petición rechazada por validación',()=>{
    const {c,registrarRep}=setup(400);c.generarRep();
    const key=registrarRep.calls.mostRecent().args[0].requestId;
    expect(c.repPendingConfirmation).toBeFalse();
    c.repForm.controls.formaPago.setValue('Efectivo');c.generarRep();
    expect(registrarRep.calls.count()).toBe(2);expect(registrarRep.calls.mostRecent().args[0].requestId).not.toBe(key);
  });
});
