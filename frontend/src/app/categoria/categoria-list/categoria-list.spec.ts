// frontend/src/app/categoria/categoria-list/categoria-list.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CategoriaList } from './categoria-list';

describe('CategoriaList', () => {
  let component: CategoriaList;
  let fixture: ComponentFixture<CategoriaList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CategoriaList]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CategoriaList);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
