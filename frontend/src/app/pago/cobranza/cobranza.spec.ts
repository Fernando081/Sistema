// frontend/src/app/pago/cobranza/cobranza.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Cobranza } from './cobranza';

describe('Cobranza', () => {
  let component: Cobranza;
  let fixture: ComponentFixture<Cobranza>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Cobranza]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Cobranza);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
