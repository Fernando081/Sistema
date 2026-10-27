import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, of, throwError } from 'rxjs';
import { PedidoDetailDialogComponent } from './pedido-detail-dialog.component';
import { PedidoDetalle, PedidoService } from '../services/pedido.service';
import { ConfirmService } from '../shared/confirm.service';

describe('Operación y recarga del pedido', () => {
  const pedido = { partidas: [{ idDetalle: 1, cantidadReservada: 5, cantidadSurtida: 1 }] } as PedidoDetalle;
  function setup(service: Partial<PedidoService>) {
    TestBed.configureTestingModule({ providers: [
      { provide: PedidoService, useValue: service }, { provide: MAT_DIALOG_DATA, useValue: 4 },
      { provide: MatDialogRef, useValue: { close: () => {} } },
      { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(false) }) } },
      { provide: MatSnackBar, useValue: { open: () => {} } },
      { provide: ConfirmService, useValue: { ask: () => of(true) } },
    ] });
    return TestBed.runInInjectionContext(() => new PedidoDetailDialogComponent());
  }

  it('mantiene bloqueo durante la recarga y elimina cantidades de partidas anteriores', () => {
    const action = new Subject<PedidoDetalle>();
    const reload = new Subject<PedidoDetalle>();
    const component = setup({ getOne: jasmine.createSpy().and.returnValues(of(pedido), reload), confirm: () => action });
    expect(component.quantities.get(1)).toBe(4);
    component.confirm();
    action.next(pedido);
    action.complete();
    expect(component.busy()).toBeTrue();
    reload.next({ ...pedido, partidas: [] });
    reload.complete();
    expect(component.busy()).toBeFalse();
    expect(component.quantities.has(1)).toBeFalse();
  });

  it('muestra errores HTTP válidos sin asumir el tipo del payload', () => {
    const component = setup({ getOne: () => of(pedido), confirm: () => throwError(() =>
      new HttpErrorResponse({ status: 409, error: { message: 'Sin existencia disponible' } })) });
    component.confirm();
    expect(component.error()).toBe('Sin existencia disponible');
    expect(component.busy()).toBeFalse();
  });
});
