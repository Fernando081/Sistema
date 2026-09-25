import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { FacturaGlobalComponent, PendingTicket } from './factura-global.component';
import { VentaService } from '../../services/venta.service';

describe('Factura global selection', () => {
  it('updates totals when individual tickets are selected and cleared', () => {
    TestBed.configureTestingModule({ providers: [FormBuilder, { provide: VentaService, useValue: {getTicketsPendientesGlobal: () => of({tickets: []})} }, {provide: MatSnackBar, useValue: {open: () => {}}}] });
    const component = TestBed.runInInjectionContext(() => new FacturaGlobalComponent(TestBed.inject(FormBuilder), TestBed.inject(VentaService), TestBed.inject(MatSnackBar)));
    component.ngOnInit();
    const ticket = {idFactura: 1, subtotal: 100, totalImpuestosTrasladados: 16, total: 116} as PendingTicket;
    expect(component.selectedTotal()).toBe(0);
    component.selection.select(ticket);
    expect(component.selectedTotal()).toBe(116);
    expect(component.selectedIva()).toBe(16);
    component.selection.clear();
    expect(component.selectedTotal()).toBe(0);
  });
});
