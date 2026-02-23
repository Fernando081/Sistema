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
    // Fake token: header.payload.signature (base64url-encoded payload)
    // payload = {"sub":"testuser","role":"admin","iat":1000,"exp":9999999999}
    const fakeToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
      '.eyJzdWIiOiJ0ZXN0dXNlciIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTAwMCwiZXhwIjo5OTk5OTk5OTk5fQ' +
      '.fakesignature';

    it('devuelve null cuando no hay token', () => {
      expect(service.getDecodedToken()).toBeNull();
    });

    it('decodifica correctamente el payload del token', () => {
      localStorage.setItem('access_token', fakeToken);

      const result = service.getDecodedToken();

      expect(result).not.toBeNull();
      expect(result?.sub).toBe('testuser');
      expect(result?.role).toBe('admin');
    });

    it('devuelve null y emite advertencia con token malformado', () => {
      localStorage.setItem('access_token', 'not.a.valid.jwt.token');
      const warnSpy = spyOn(console, 'warn');

      const result = service.getDecodedToken();

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    });
  });
});
