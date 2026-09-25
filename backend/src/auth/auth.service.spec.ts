import { BadRequestException, ConflictException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { AuthUser } from './auth-user.entity';
import { RolUsuario } from '../common/enums/app.enums';

describe('AuthService', () => {
  let service: AuthService;
  let loggerErrorSpy: jest.SpyInstance;
  let loggerLogSpy: jest.SpyInstance;

  const repoMock = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  } as unknown as Repository<AuthUser>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_USERNAME = RolUsuario.ADMIN;
    process.env.AUTH_PASSWORD = 'admin123';
    process.env.JWT_SECRET = 'test-secret';
    process.env.ALLOW_ENV_AUTH = 'true';
    repoMock.findOne = jest.fn().mockResolvedValue(null);
    repoMock.create = jest.fn((entity?: any) => entity as any) as any;
    repoMock.save = jest.fn((entity?: any) =>
      Promise.resolve({ idUser: 1, ...entity } as any),
    ) as any;
    service = new AuthService(repoMock);
    loggerErrorSpy = jest.spyOn(service['logger'], 'error');
    loggerLogSpy = jest.spyOn(service['logger'], 'log');
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
    loggerLogSpy.mockRestore();
  });

  it('genera token válido con credenciales fallback correctas', async () => {
    const response = await service.login(RolUsuario.ADMIN, 'admin123');
    expect(response.access_token).toBeTruthy();
    const payload = service.verify(response.access_token);
    expect(payload.sub).toBe(RolUsuario.ADMIN);
  });

  it('rechaza credenciales inválidas', async () => {
    await expect(
      service.login(RolUsuario.ADMIN, 'mal-password'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('registra usuario con password hasheado con bcrypt', async () => {
    const result = await service.register(
      'nuevo-admin',
      'password123',
      RolUsuario.ADMIN,
    );

    expect(repoMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'nuevo-admin',
        role: RolUsuario.ADMIN,
        isActive: true,
      }),
    );

    const createCalls = (repoMock.create as jest.Mock).mock.calls as Array<
      [Partial<AuthUser>]
    >;
    const createdUser = createCalls[0]?.[0];

    expect(createdUser?.passwordHash).toContain('$2b$10$');
    expect(createdUser?.passwordHash).not.toContain('password123');
    expect(result).toEqual({
      idUser: 1,
      username: 'nuevo-admin',
      role: RolUsuario.ADMIN,
    });
  });

  it('usa rol por defecto cuando no se proporciona', async () => {
    const result = await service.register('nuevo-por-defecto', 'password456');

    expect(repoMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'nuevo-por-defecto',
        role: RolUsuario.USER,
        isActive: true,
      }),
    );

    const createCalls = (repoMock.create as jest.Mock).mock.calls as Array<
      [Partial<AuthUser>]
    >;
    const createdUser = createCalls[createCalls.length - 1]?.[0];

    expect(createdUser?.passwordHash).toContain('$2b$10$');
    expect(createdUser?.passwordHash).not.toContain('password456');
    expect(result).toEqual({
      idUser: 1,
      username: 'nuevo-por-defecto',
      role: RolUsuario.USER,
    });
  });
  
  it('impide registrar usuario duplicado', async () => {
    repoMock.findOne = jest
      .fn()
      .mockResolvedValue({ idUser: 99, username: 'repetido' });

    await expect(
      service.register('repetido', 'password123', RolUsuario.ADMIN),
    ).rejects.toThrow(ConflictException);
  });

  it('registra exitosamente y registra evento de auditoría', async () => {
    const result = await service.register(
      'usuario-con-log',
      'password789',
      RolUsuario.USER,
    );

    expect(result).toEqual({
      idUser: 1,
      username: 'usuario-con-log',
      role: RolUsuario.USER,
    });

    expect(loggerLogSpy).toHaveBeenCalledWith(
      'User registered successfully: username=usuario-con-log, role=user, idUser=1',
    );
  });

  it('maneja condición de carrera con violación de constraint único', async () => {
    const uniqueViolationError = Object.assign(new Error('duplicate key'), {
      code: '23505',
    });

    repoMock.save = jest.fn().mockRejectedValue(uniqueViolationError);

    await expect(
      service.register('usuario-duplicado', 'password123', RolUsuario.ADMIN),
    ).rejects.toThrow(ConflictException);

    await expect(
      service.register('usuario-duplicado', 'password123', RolUsuario.ADMIN),
    ).rejects.toThrow('El usuario ya existe');
  });

  it('valida usuario desde BD con hash', async () => {
    const passwordHash = await AuthService.hashPassword('secreto');
    repoMock.findOne = jest.fn().mockResolvedValue({
      username: 'fer',
      role: RolUsuario.ADMIN,
      passwordHash,
      isActive: true,
    });

    const response = await service.login('fer', 'secreto');
    expect(response.access_token).toBeTruthy();
  });

  it('rechaza hash nulo o inválido', async () => {
    repoMock.findOne = jest.fn().mockResolvedValue({
      username: 'fer',
      role: RolUsuario.ADMIN,
      passwordHash: null,
      isActive: true,
    });

    await expect(service.login('fer', 'cualquier-password')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Invalid password hash: storedHash is null, undefined, empty, or not a string',
    );
  });

  it('no permite fallback para un usuario desactivado', async () => {
    repoMock.findOne = jest.fn().mockResolvedValue({
      username: RolUsuario.ADMIN,
      role: RolUsuario.USER,
      passwordHash: await AuthService.hashPassword('otra-clave'),
      isActive: false,
    });

    await expect(
      service.login(RolUsuario.ADMIN, 'admin123'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('no permite fallback si la base de datos falla', async () => {
    repoMock.findOne = jest.fn().mockRejectedValue(new Error('database unavailable'));
    await expect(service.login('admin', 'admin123')).rejects.toThrow(ServiceUnavailableException);
  });

  it('rechaza segmentos JWT extra y claims nulos sin devolver errores internos', async () => {
    const { access_token } = await service.login('admin', 'admin123');
    expect(() => service.verify(access_token + '.extra')).toThrow(UnauthorizedException);
    expect(() => service.verify('bnVsbA.bnVsbA.c2ln')).toThrow(UnauthorizedException);
  });

  it('rechaza tokens firmados con audiencia, fechas o versión inválidas', async () => {
    const { access_token } = await service.login('admin', 'admin123');
    const valid = service.verify(access_token);
    for (const changes of [{ aud: 'otra-api' }, { iat: valid.exp }, { exp: valid.iat - 1 }, { version: -1 }, { idUser: -4 }]) {
      const token = service['sign']({ ...valid, ...changes } as any);
      expect(() => service.verify(token)).toThrow(UnauthorizedException);
    }
  });

  it('revoca inmediatamente el token de un usuario desactivado o con versión nueva', async () => {
    const user = { idUser: 7, username: 'fer', role: 'user', isActive: true, tokenVersion: 2, passwordHash: await AuthService.hashPassword('password123') };
    repoMock.findOne = jest.fn().mockResolvedValue(user);
    const { access_token } = await service.login('fer', 'password123');
    await expect(service.authenticate(access_token)).resolves.toMatchObject({ idUser: 7, version: 2 });
    repoMock.findOne = jest.fn().mockResolvedValue({ ...user, isActive: false });
    await expect(service.authenticate(access_token)).rejects.toThrow(UnauthorizedException);
    repoMock.findOne = jest.fn().mockResolvedValue({ ...user, tokenVersion: 3 });
    await expect(service.authenticate(access_token)).rejects.toThrow(UnauthorizedException);
    repoMock.findOne = jest.fn().mockResolvedValue({ ...user, role: 'admin' });
    await expect(service.authenticate(access_token)).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza contraseñas multibyte que bcrypt truncaría a 72 bytes', async () => {
    await expect(service.register('usuario', 'ñ'.repeat(37))).rejects.toThrow(BadRequestException);
  });

  it('no permite retirar al último administrador ni desactivar la propia cuenta', async () => {
    const txRepo = { findOne: jest.fn().mockResolvedValue({ idUser: 2, role: 'admin', isActive: true, tokenVersion: 0 }), countBy: jest.fn().mockResolvedValue(1), save: jest.fn() };
    Object.assign(repoMock, { manager: { transaction: jest.fn((fn) => fn({ query: jest.fn(), getRepository: () => txRepo })) } });
    await expect(service.updateUser(2, { isActive: false }, { idUser: 1 } as any)).rejects.toThrow('Debe permanecer');
    await expect(service.updateUser(2, { isActive: false }, { idUser: 2 } as any)).rejects.toThrow('tu propia cuenta');
    expect(txRepo.save).not.toHaveBeenCalled();
  });
});
