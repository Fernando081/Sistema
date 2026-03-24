import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DevolucionList } from './devolucion-list';

describe('DevolucionList', () => {
  let component: DevolucionList;
  let fixture: ComponentFixture<DevolucionList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DevolucionList],
    }).compileComponents();

    fixture = TestBed.createComponent(DevolucionList);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
