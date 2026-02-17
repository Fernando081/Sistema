import { UnauthorizedException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { AuthUser } from './auth-user.entity';

describe('AuthService', () => {
  let service: AuthService;

  const repoMock = {
    findOne: jest.fn(),
  } as unknown as Repository<AuthUser>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_USERNAME = 'admin';
    process.env.AUTH_PASSWORD = 'admin123';
    process.env.JWT_SECRET = 'test-secret';
    repoMock.findOne = jest.fn().mockResolvedValue(null);
    service = new AuthService(repoMock);
  });

  it('genera token válido con credenciales fallback correctas', async () => {
    const response = await service.login('admin', 'admin123');
    expect(response.access_token).toBeTruthy();
    const payload = service.verify(response.access_token);
    expect(payload.sub).toBe('admin');
  });

  it('rechaza credenciales inválidas', async () => {
    await expect(service.login('admin', 'mal-password')).rejects.toThrow(UnauthorizedException);
  });

  it('valida usuario desde BD con hash', async () => {
    const passwordHash = AuthService.hashPassword('secreto');
    repoMock.findOne = jest.fn().mockResolvedValue({ username: 'fer', role: 'admin', passwordHash, isActive: true });

    const response = await service.login('fer', 'secreto');
    expect(response.access_token).toBeTruthy();
  });
});
