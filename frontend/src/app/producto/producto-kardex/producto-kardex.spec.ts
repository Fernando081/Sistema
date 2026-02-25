// frontend/src/app/producto/producto-kardex/producto-kardex.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProductoKardex } from './producto-kardex';

describe('ProductoKardex', () => {
  let component: ProductoKardex;
  let fixture: ComponentFixture<ProductoKardex>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductoKardex]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ProductoKardex);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
