// frontend/src/app/venta/venta.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Venta } from './venta';

describe('Venta', () => {
  let component: Venta;
  let fixture: ComponentFixture<Venta>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Venta]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Venta);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
