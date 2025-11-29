// frontend/src/app/services/proveedor.spec.ts
import { TestBed } from '@angular/core/testing';

import { Proveedor } from './proveedor';

describe('Proveedor', () => {
  let service: Proveedor;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Proveedor);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
