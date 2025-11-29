// frontend/src/app/venta/factura-detalle/factura-detalle.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FacturaDetalle } from './factura-detalle';

describe('FacturaDetalle', () => {
  let component: FacturaDetalle;
  let fixture: ComponentFixture<FacturaDetalle>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FacturaDetalle]
    })
    .compileComponents();

    fixture = TestBed.createComponent(FacturaDetalle);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
