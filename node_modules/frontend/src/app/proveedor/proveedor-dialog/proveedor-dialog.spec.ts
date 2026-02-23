// frontend/src/app/proveedor/proveedor-dialog/proveedor-dialog.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProveedorDialog } from './proveedor-dialog';

describe('ProveedorDialog', () => {
  let component: ProveedorDialog;
  let fixture: ComponentFixture<ProveedorDialog>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProveedorDialog]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ProveedorDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
