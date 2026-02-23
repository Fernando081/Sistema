// frontend/src/app/compra/compra.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Compra } from './compra';

describe('Compra', () => {
  let component: Compra;
  let fixture: ComponentFixture<Compra>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Compra]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Compra);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
