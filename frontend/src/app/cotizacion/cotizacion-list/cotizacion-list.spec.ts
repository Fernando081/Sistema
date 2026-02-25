// frontend/src/app/cotizacion/cotizacion-list/cotizacion-list.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CotizacionList } from './cotizacion-list';

describe('CotizacionList', () => {
  let component: CotizacionList;
  let fixture: ComponentFixture<CotizacionList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CotizacionList]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CotizacionList);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
