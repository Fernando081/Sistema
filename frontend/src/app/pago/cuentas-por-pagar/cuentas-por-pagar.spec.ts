// frontend/src/app/pago/cuentas-por-pagar/cuentas-por-pagar.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CuentasPorPagar } from './cuentas-por-pagar';

describe('CuentasPorPagar', () => {
  let component: CuentasPorPagar;
  let fixture: ComponentFixture<CuentasPorPagar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CuentasPorPagar]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CuentasPorPagar);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
