import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [AuthService, provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('guarda token al hacer login', () => {
    service.login({ username: 'admin', password: 'admin123' }).subscribe();

    const req = httpMock.expectOne(`${environment.apiBaseUrl}/auth/login`);
    req.flush({ access_token: 'abc', token_type: 'Bearer', expires_in: 3600 });

    expect(localStorage.getItem('access_token')).toBe('abc');
  });

  describe('getDecodedToken', () => {
    it('retorna null cuando no hay token almacenado', () => {
      expect(service.getDecodedToken()).toBeNull();
    });

    it('retorna null para un token con menos de 3 segmentos', () => {
      // token with only header and no payload
      localStorage.setItem('access_token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(service.getDecodedToken()).toBeNull();
    });

    it('retorna null para un payload que no es JSON válido', () => {
      // second segment decodes to non-JSON text
      const badPayload = btoa('not-json').replace(/=/g, '');
      localStorage.setItem('access_token', `header.${badPayload}.sig`);
      expect(service.getDecodedToken()).toBeNull();
    });

    it('decodifica un token con payload ASCII', () => {
      // payload: {"sub":"admin","role":"ADMIN"}
      localStorage.setItem(
        'access_token',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJBRE1JTiJ9.fakesig',
      );
      const result = service.getDecodedToken();
      expect(result).toEqual(jasmine.objectContaining({ sub: 'admin', role: 'ADMIN' }));
    });

    it('decodifica correctamente un payload con caracteres no-ASCII (acentos)', () => {
      // payload: {"sub":"José García","role":"USER"}
      localStorage.setItem(
        'access_token',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJKb3PDqSBHYXJjw61hIiwicm9sZSI6IlVTRVIifQ.fakesig',
      );
      const result = service.getDecodedToken();
      expect(result).toEqual(jasmine.objectContaining({ sub: 'José García', role: 'USER' }));
    });
  });
});
