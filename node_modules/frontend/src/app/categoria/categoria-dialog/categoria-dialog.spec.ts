// frontend/src/app/categoria/categoria-dialog/categoria-dialog.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CategoriaDialog } from './categoria-dialog';

describe('CategoriaDialog', () => {
  let component: CategoriaDialog;
  let fixture: ComponentFixture<CategoriaDialog>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CategoriaDialog]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CategoriaDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
