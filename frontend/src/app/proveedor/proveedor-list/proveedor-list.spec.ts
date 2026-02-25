// frontend/src/app/proveedor/proveedor-list/proveedor-list.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProveedorList } from './proveedor-list';

describe('ProveedorList', () => {
  let component: ProveedorList;
  let fixture: ComponentFixture<ProveedorList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProveedorList]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ProveedorList);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
