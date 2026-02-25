// frontend/src/app/compra/compra-list/compra-list.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CompraList } from './compra-list';

describe('CompraList', () => {
  let component: CompraList;
  let fixture: ComponentFixture<CompraList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CompraList]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CompraList);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
