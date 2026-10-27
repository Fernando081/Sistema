import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { CompraDetalleComponent } from './compra-detalle.component';
import { CompraService } from '../../services/compra.service';

describe('Detalle de compra', () => {
  it('muestra descripción y código con los nombres que devuelve SQL', async () => {
    await TestBed.configureTestingModule({
      imports: [CompraDetalleComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { id_compra: 6, nombre_proveedor: 'Proveedor', total: 250 } },
        { provide: MatDialogRef, useValue: { close: () => {} } },
        { provide: CompraService, useValue: { getDetalleCompra: () => of([
          { cantidad: '2', costo_unitario: '125', importe: '250', descripcion: 'Filtro ISX', codigo: 'ISX-8' },
        ]) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(CompraDetalleComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('Filtro ISX');
    expect(text).toContain('ISX-8');
  });
});
