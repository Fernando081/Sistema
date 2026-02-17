import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    process.env.AUTH_USERNAME = 'admin';
    process.env.AUTH_PASSWORD = 'admin123';
    process.env.JWT_SECRET = 'test-secret';
    service = new AuthService();
  });

  it('genera token válido con credenciales correctas', () => {
    const response = service.login('admin', 'admin123');
    expect(response.access_token).toBeTruthy();
    const payload = service.verify(response.access_token);
    expect(payload.sub).toBe('admin');
  });

  it('rechaza credenciales inválidas', () => {
    expect(() => service.login('admin', 'mal-password')).toThrow(UnauthorizedException);
  });
});
