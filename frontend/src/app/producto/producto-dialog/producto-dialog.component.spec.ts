import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { ProductoDialogComponent } from './producto-dialog.component';
import { ProductoService } from '../../services/producto.service';
import { CategoriaService } from '../../services/categoria.service';
import { CatalogosService } from '../../services/catalogos.service';
import { ConfirmService } from '../../shared/confirm.service';

describe('Ficha de producto', () => {
  it('muestra nombre y precio de la cotización con el contrato del proveedor', async () => {
    await TestBed.configureTestingModule({
      imports: [ProductoDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { idProducto: 8, descripcion: 'Filtro' } },
        { provide: MatDialogRef, useValue: { close: () => {} } },
        { provide: MatSnackBar, useValue: { open: () => {} } },
        { provide: ConfirmService, useValue: { ask: () => of(false) } },
        { provide: CategoriaService, useValue: { getCategorias: () => of([]) } },
        { provide: CatalogosService, useValue: {
          getUnidades: () => of([]), getObjetosImpuesto: () => of([]),
        } },
        { provide: ProductoService, useValue: {
          getHistorialPrecios: () => of([]), getEquivalentes: () => of([]),
          getNumerosParte: () => of([]), getAplicaciones: () => of([]), getKardex: () => of([]),
          getCotizacionesProveedor: () => of([{ id_cotizacion_prov: 2, proveedor_nombre: 'Proveedor ISX',
            precio_cotizado: '185.00', dias_entrega: 3, fecha_registro: '2026-09-30T12:00:00Z' }]),
        } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProductoDialogComponent);
    fixture.detectChanges();
    const tabs = fixture.nativeElement.querySelectorAll('[role="tab"]') as NodeListOf<HTMLElement>;
    const tab = Array.from(tabs).find(item => item.textContent?.includes('Stock y proveedores'));
    expect(tab).toBeDefined();
    tab?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('Proveedor ISX');
    expect(text).toContain('185.00');
  });
});
