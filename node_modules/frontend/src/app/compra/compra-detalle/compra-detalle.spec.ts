// frontend/src/app/compra/compra-detalle/compra-detalle.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CompraDetalle } from './compra-detalle';

describe('CompraDetalle', () => {
  let component: CompraDetalle;
  let fixture: ComponentFixture<CompraDetalle>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CompraDetalle]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CompraDetalle);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
